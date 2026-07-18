import Anthropic from '@anthropic-ai/sdk'
import { google } from 'googleapis'
import { getGoogleAuth, GSC_SCOPES } from './google'

const BASE = 'https://api.dataforseo.com/v3'

function getAuth() {
  const login = process.env.DATAFORSEO_LOGIN
  const password = process.env.DATAFORSEO_PASSWORD
  if (!login || !password) throw new Error('DATAFORSEO_LOGIN and DATAFORSEO_PASSWORD are required')
  return 'Basic ' + Buffer.from(`${login}:${password}`).toString('base64')
}

export type KeywordVolume = {
  keyword: string
  searchVolume: number
  competition: 'LOW' | 'MEDIUM' | 'HIGH' | 'UNKNOWN'
  cpc: number
  estimated?: boolean
}

export type KeywordIdea = {
  keyword: string
  searchVolume: number
  difficulty: number
  cpc: number
  estimated?: boolean
}

// ── Fallback providers (used when DataForSEO is unavailable) ─────────────────
// GSC = real data for our own domains; Custom Search = real SERPs;
// Autocomplete = real suggestion data; Claude = volume/difficulty estimates.

function getAnthropic() {
  return new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })
}

/** Estimate US monthly search volume + difficulty with Claude. Estimates, not measurements. */
async function estimateKeywordMetrics(keywords: string[]): Promise<KeywordIdea[]> {
  if (!keywords.length) return []
  const capped = keywords.slice(0, 60)
  const res = await getAnthropic().messages.create({
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 2000,
    messages: [{
      role: 'user',
      content: `Estimate realistic US monthly Google search volume and ranking difficulty (0-100) for each keyword. Be conservative: most long-tail keywords are under 1000/month. Return ONLY a JSON array, same order, no commentary:
[{"keyword":"...","volume":123,"difficulty":25}, ...]

Keywords:
${capped.map(k => `- ${k}`).join('\n')}`,
    }],
  })
  const text = res.content[0].type === 'text' ? res.content[0].text : '[]'
  const parsed: Array<{ keyword: string; volume: number; difficulty: number }> =
    JSON.parse(text.match(/\[[\s\S]*\]/)?.[0] ?? '[]')
  return parsed.map(p => ({
    keyword: p.keyword,
    searchVolume: p.volume ?? 0,
    difficulty: p.difficulty ?? 0,
    cpc: 0,
    estimated: true,
  }))
}

/** Free Google Autocomplete suggestions for a query. */
async function getAutocompleteSuggestions(query: string): Promise<string[]> {
  try {
    const res = await fetch(
      `https://suggestqueries.google.com/complete/search?client=firefox&hl=en&q=${encodeURIComponent(query)}`,
      { headers: { 'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)' }, signal: AbortSignal.timeout(5000) }
    )
    const data = await res.json()
    return Array.isArray(data?.[1]) ? data[1] : []
  } catch {
    return []
  }
}

/** Google Custom Search API top results (same key as the citation checker). */
async function googleTopResults(keyword: string): Promise<Array<{ title: string; url: string; type: string }>> {
  const apiKey = process.env.GOOGLE_SEARCH_API_KEY
  const engineId = process.env.GOOGLE_SEARCH_ENGINE_ID
  if (!apiKey || !engineId) throw new Error('Google Search API not configured')
  const res = await fetch(
    `https://www.googleapis.com/customsearch/v1?key=${apiKey}&cx=${engineId}&q=${encodeURIComponent(keyword)}&num=10&gl=us`,
    { signal: AbortSignal.timeout(10000) }
  )
  if (!res.ok) throw new Error(`Google Search API error: ${res.status}`)
  const data = await res.json()
  const items: Array<{ title: string; link: string }> = data.items ?? []
  return items.map(i => ({ title: i.title, url: i.link, type: 'organic' }))
}

// ── Search volumes ───────────────────────────────────────────────────────────

/**
 * Get search volume + competition for a list of exact keywords.
 * Primary: DataForSEO Google Ads data. Fallback: Claude estimates (estimated: true).
 */
export async function getSearchVolumes(
  keywords: string[],
  locationCode = 2840 // United States
): Promise<KeywordVolume[]> {
  try {
    const res = await fetch(`${BASE}/keywords_data/google_ads/search_volume/live`, {
      method: 'POST',
      headers: { Authorization: getAuth(), 'Content-Type': 'application/json' },
      body: JSON.stringify([{ keywords, location_code: locationCode, language_code: 'en' }]),
    })
    const data = await res.json()
    if (data.status_code !== 20000 && data.tasks?.[0]?.status_code !== 20000) {
      throw new Error(`DataForSEO error: ${data.status_message ?? data.tasks?.[0]?.status_message}`)
    }
    const items: Array<{
      keyword: string
      search_volume: number
      competition_level: string
      cpc: number
    }> = data.tasks?.[0]?.result ?? []

    return items.map(item => ({
      keyword: item.keyword,
      searchVolume: item.search_volume ?? 0,
      competition: (item.competition_level as KeywordVolume['competition']) ?? 'UNKNOWN',
      cpc: item.cpc ?? 0,
    }))
  } catch (err) {
    console.warn('DataForSEO volumes unavailable, falling back to Claude estimates:', err)
    const estimates = await estimateKeywordMetrics(keywords)
    return estimates.map(e => ({
      keyword: e.keyword,
      searchVolume: e.searchVolume,
      competition: 'UNKNOWN' as const,
      cpc: 0,
      estimated: true,
    }))
  }
}

// ── Keyword ideas ────────────────────────────────────────────────────────────

/**
 * Get keyword ideas + difficulty scores for seed keywords.
 * Primary: DataForSEO Labs. Fallback: Google Autocomplete expansion + Claude estimates.
 */
export async function getKeywordIdeas(
  seeds: string[],
  locationCode = 2840,
  limit = 30
): Promise<KeywordIdea[]> {
  try {
    const res = await fetch(`${BASE}/dataforseo_labs/google/keyword_ideas/live`, {
      method: 'POST',
      headers: { Authorization: getAuth(), 'Content-Type': 'application/json' },
      body: JSON.stringify([{
        keywords: seeds,
        location_code: locationCode,
        language_code: 'en',
        limit,
        order_by: ['keyword_info.search_volume,desc'],
      }]),
    })
    const data = await res.json()
    if (data.status_code !== 20000 && data.tasks?.[0]?.status_code !== 20000) {
      throw new Error(`DataForSEO error: ${data.status_message ?? data.tasks?.[0]?.status_message}`)
    }
    const items: Array<{
      keyword: string
      keyword_info: { search_volume: number; cpc: number }
      keyword_properties: { keyword_difficulty: number }
    }> = data.tasks?.[0]?.result?.[0]?.items ?? []

    return items.map(item => ({
      keyword: item.keyword,
      searchVolume: item.keyword_info?.search_volume ?? 0,
      difficulty: item.keyword_properties?.keyword_difficulty ?? 0,
      cpc: item.keyword_info?.cpc ?? 0,
    }))
  } catch (err) {
    console.warn('DataForSEO ideas unavailable, falling back to Autocomplete + Claude:', err)
    // Expand each seed through real Google Autocomplete data (may be blocked from datacenter IPs)
    const querySet = seeds.slice(0, 4).flatMap(s => [s, `best ${s}`, `how to ${s}`, `${s} for`])
    const suggestionLists = await Promise.all(querySet.map(getAutocompleteSuggestions))
    const suggestions = Array.from(new Set(suggestionLists.flat().map(s => s.toLowerCase().trim()))).filter(Boolean)

    // Claude expands the seed list (works even when Autocomplete is unreachable) and estimates metrics
    const res = await getAnthropic().messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 3000,
      messages: [{
        role: 'user',
        content: `Seed keywords: ${seeds.join(', ')}
${suggestions.length ? `\nReal Google Autocomplete suggestions for these seeds:\n${suggestions.slice(0, 40).join('\n')}\n` : ''}
Produce up to ${limit} long-tail keyword ideas closely related to the seed keywords. Include the relevant autocomplete suggestions verbatim, plus your own related ideas. For each, estimate realistic US monthly Google search volume (be conservative: most long-tail keywords are under 1000/month) and ranking difficulty 0-100.
Return ONLY a JSON array, no commentary:
[{"keyword":"...","volume":123,"difficulty":25}, ...]`,
      }],
    })
    const text = res.content[0].type === 'text' ? res.content[0].text : '[]'
    const parsed: Array<{ keyword: string; volume: number; difficulty: number }> =
      JSON.parse(text.match(/\[[\s\S]*\]/)?.[0] ?? '[]')
    return parsed.slice(0, limit).map(p => ({
      keyword: p.keyword.toLowerCase().trim(),
      searchVolume: p.volume ?? 0,
      difficulty: p.difficulty ?? 0,
      cpc: 0,
      estimated: true,
    }))
  }
}

// ── Ranked keywords ──────────────────────────────────────────────────────────

export type RankedKeyword = {
  keyword: string
  searchVolume: number
  difficulty: number
  rank: number
  url: string
  estimated?: boolean
}

/**
 * Fetch keywords a domain already ranks for.
 * Primary: DataForSEO Labs (market-wide, top 100).
 * Fallback: Google Search Console — real queries, positions, and impressions for
 * our own verified domains (searchVolume becomes 28-day impressions, a proxy).
 */
export async function getRankedKeywords(
  domain: string,
  locationCode = 2840,
  limit = 200
): Promise<RankedKeyword[]> {
  try {
    const res = await fetch(`${BASE}/dataforseo_labs/google/ranked_keywords/live`, {
      method: 'POST',
      headers: { Authorization: getAuth(), 'Content-Type': 'application/json' },
      body: JSON.stringify([{
        target: domain,
        location_code: locationCode,
        language_code: 'en',
        limit,
        order_by: ['ranked_serp_element.serp_item.rank_absolute,asc'],
        filters: [
          ['ranked_serp_element.serp_item.rank_absolute', '<=', 100],
          'and',
          ['keyword_data.keyword_info.search_volume', '>', 10],
        ],
      }]),
    })
    const data = await res.json()
    if (data.status_code !== 20000 && data.tasks?.[0]?.status_code !== 20000) {
      throw new Error(`DataForSEO error: ${data.status_message ?? data.tasks?.[0]?.status_message}`)
    }
    const items: Array<{
      keyword_data: {
        keyword: string
        keyword_info: { search_volume: number }
        keyword_properties: { keyword_difficulty: number }
      }
      ranked_serp_element: {
        serp_item: { rank_absolute: number; url: string }
      }
    }> = data.tasks?.[0]?.result?.[0]?.items ?? []

    return items.map(item => ({
      keyword: item.keyword_data.keyword,
      searchVolume: item.keyword_data.keyword_info?.search_volume ?? 0,
      difficulty: item.keyword_data.keyword_properties?.keyword_difficulty ?? 0,
      rank: item.ranked_serp_element.serp_item.rank_absolute,
      url: item.ranked_serp_element.serp_item.url ?? '',
    }))
  } catch (err) {
    console.warn('DataForSEO ranked keywords unavailable, falling back to Search Console:', err)
    const authClient = await getGoogleAuth(GSC_SCOPES).getClient()
    const searchConsole = google.searchconsole({ version: 'v1', auth: authClient as never })
    const endDate = new Date().toISOString().slice(0, 10)
    const startDate = new Date(Date.now() - 28 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10)
    const gscRes = await searchConsole.searchanalytics.query({
      siteUrl: `sc-domain:${domain}`,
      requestBody: {
        startDate,
        endDate,
        dimensions: ['query', 'page'],
        rowLimit: Math.min(limit * 2, 1000),
      },
    })
    const rows = gscRes.data.rows ?? []
    // Dedupe by query, keeping the row with the most impressions
    const byQuery = new Map<string, { keys?: string[] | null; impressions?: number | null; position?: number | null }>()
    for (const row of rows) {
      const q = row.keys?.[0] ?? ''
      const prev = byQuery.get(q)
      if (!prev || (row.impressions ?? 0) > (prev.impressions ?? 0)) byQuery.set(q, row)
    }
    return Array.from(byQuery.entries())
      .filter(([, row]) => (row.impressions ?? 0) >= 2 && Math.round(row.position ?? 999) <= 100)
      .map(([q, row]) => ({
        keyword: q,
        searchVolume: row.impressions ?? 0,
        difficulty: 0,
        rank: Math.round(row.position ?? 0),
        url: row.keys?.[1] ?? '',
        estimated: true,
      }))
      .sort((a, b) => a.rank - b.rank)
      .slice(0, limit)
  }
}

// ── SERP intent ──────────────────────────────────────────────────────────────

export type SerpIntent = {
  format: 'listicle' | 'guide' | 'comparison' | 'product' | 'mixed'
  topResults: Array<{ title: string; url: string; type: string }>
  recommendation: string
}

const FORMAT_ADVICE: Record<SerpIntent['format'], string> = {
  listicle: 'Top results are listicles. Use a numbered list format (e.g. "X Best Ways to..."). Each item needs a subheading and 2–3 paragraphs.',
  guide: 'Top results are comprehensive guides. Write a thorough how-to or explainer with H2 sections covering each subtopic in depth.',
  comparison: 'Top results are comparison posts. Structure as a head-to-head with a clear recommendation and comparison table.',
  product: 'Top results are product/commercial pages. Include pricing, features, and a strong CTA. Less editorial, more transactional.',
  mixed: 'Mixed SERP. Write a comprehensive guide that covers both informational and commercial angles.',
}

/** Classify winning content format from a set of top-ranking titles. */
function classifySerpFormat(items: Array<{ title: string; url: string; type: string }>): SerpIntent {
  const titles = items.map(i => i.title.toLowerCase()).join(' ')
  let format: SerpIntent['format'] = 'guide'
  if (/\b(\d+\s+(best|top|ways|tips|reasons|ideas)|(best|top)\s+\d+)\b/.test(titles)) {
    format = 'listicle'
  } else if (/\bvs\.?\b|\bversus\b|\bcompare\b|\bcomparison\b/.test(titles)) {
    format = 'comparison'
  } else if (/\bbuy\b|\bshop\b|\bprice\b|\bcost\b|\breview\b/.test(titles)) {
    format = 'product'
  } else if (/\bhow to\b|\bguide\b|\btutorial\b|\bstep[s]?\b/.test(titles)) {
    format = 'guide'
  } else {
    format = 'mixed'
  }

  return { format, topResults: items, recommendation: FORMAT_ADVICE[format] }
}

/**
 * Analyze SERP for a keyword to determine winning content format.
 * Primary: DataForSEO live SERP. Fallback: Google Custom Search API top 10.
 */
export async function analyzeSerpIntent(
  keyword: string,
  locationCode = 2840
): Promise<SerpIntent> {
  try {
    const res = await fetch(`${BASE}/serp/google/organic/live/regular`, {
      method: 'POST',
      headers: { Authorization: getAuth(), 'Content-Type': 'application/json' },
      body: JSON.stringify([{
        keyword,
        location_code: locationCode,
        language_code: 'en',
        depth: 10,
      }]),
    })
    const data = await res.json()
    if (data.status_code !== 20000 && data.tasks?.[0]?.status_code !== 20000) {
      throw new Error(`DataForSEO error: ${data.status_message ?? data.tasks?.[0]?.status_message}`)
    }
    const items: Array<{ title: string; url: string; type: string }> =
      data.tasks?.[0]?.result?.[0]?.items
        ?.filter((i: { type: string }) => i.type === 'organic')
        ?.slice(0, 10)
        ?.map((i: { title: string; url: string; type: string }) => ({
          title: i.title,
          url: i.url,
          type: i.type,
        })) ?? []
    return classifySerpFormat(items)
  } catch (err) {
    console.warn('DataForSEO SERP unavailable, falling back to Google Custom Search:', err)
    try {
      return classifySerpFormat(await googleTopResults(keyword))
    } catch (err2) {
      console.warn('Google Custom Search unavailable, falling back to Claude format prediction:', err2)
      return predictSerpFormat(keyword)
    }
  }
}

/** Last-resort SERP intent: Claude predicts the dominant content format (no live SERP data). */
async function predictSerpFormat(keyword: string): Promise<SerpIntent> {
  const res = await getAnthropic().messages.create({
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 10,
    messages: [{
      role: 'user',
      content: `For the Google search "${keyword}", which content format most likely dominates page 1? Answer with exactly one word: listicle, guide, comparison, product, or mixed.`,
    }],
  })
  const text = (res.content[0].type === 'text' ? res.content[0].text : '').toLowerCase().trim()
  const format = (['listicle', 'guide', 'comparison', 'product', 'mixed'] as const).find(f => text.includes(f)) ?? 'mixed'
  return { format, topResults: [], recommendation: FORMAT_ADVICE[format] }
}

export type SearchIntent = 'informational' | 'commercial' | 'transactional' | 'navigational'

/**
 * Classify keyword search intent from the keyword text.
 * Transactional/commercial keywords are prioritized for revenue-focused businesses.
 */
export function classifyIntent(keyword: string): SearchIntent {
  const kw = keyword.toLowerCase()

  // Navigational — brand/site lookups
  if (/\b(login|sign in|website|official|contact|near me)\b/.test(kw)) return 'navigational'

  // Transactional — ready to buy
  if (/\b(buy|book|hire|rent|charter|enroll|sign up|register|get|purchase|order|schedule|reserve|pricing|cost|price|fee|quote)\b/.test(kw)) return 'transactional'

  // Commercial investigation — comparing before buying
  if (/\b(best|top|vs|versus|compare|review|reviews|worth it|alternative|alternatives|recommend|cheapest|affordable)\b/.test(kw)) return 'commercial'

  // Default to informational
  return 'informational'
}

/**
 * Intent multipliers — how much to boost a keyword's score based on intent.
 * Adjust per business type: luxury/service businesses want transactional/commercial traffic.
 */
const INTENT_MULTIPLIERS: Record<SearchIntent, number> = {
  transactional: 2.5,
  commercial: 2.0,
  informational: 1.0,
  navigational: 0.3,
}

/**
 * Pick the best keyword from a list based on volume, difficulty, and search intent.
 * Scores keywords by (volume / (difficulty + 1)) × intent multiplier.
 */
export function selectBestKeyword(
  keywords: KeywordIdea[],
  existingKeywords: string[],
  minVolume = 50,
  maxDifficulty = 65
): KeywordIdea | null {
  const existing = new Set(existingKeywords.map(k => k.toLowerCase()))
  const candidates = keywords
    .filter(k =>
      k.searchVolume >= minVolume &&
      (k.difficulty === 0 || k.difficulty <= maxDifficulty) &&
      !existing.has(k.keyword.toLowerCase())
    )
    .sort((a, b) => {
      const intentA = classifyIntent(a.keyword)
      const intentB = classifyIntent(b.keyword)
      const scoreA = (a.searchVolume / (a.difficulty + 1)) * INTENT_MULTIPLIERS[intentA]
      const scoreB = (b.searchVolume / (b.difficulty + 1)) * INTENT_MULTIPLIERS[intentB]
      return scoreB - scoreA
    })
  return candidates[0] ?? null
}
