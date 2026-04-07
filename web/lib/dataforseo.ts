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
}

export type KeywordIdea = {
  keyword: string
  searchVolume: number
  difficulty: number
  cpc: number
}

/**
 * Get search volume + competition for a list of exact keywords (Google Ads data).
 * Cost: ~$0.0001 per keyword
 */
export async function getSearchVolumes(
  keywords: string[],
  locationCode = 2840 // United States
): Promise<KeywordVolume[]> {
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
}

/**
 * Get keyword ideas + difficulty scores for seed keywords.
 * Cost: ~$0.0015 per result item
 */
export async function getKeywordIdeas(
  seeds: string[],
  locationCode = 2840,
  limit = 30
): Promise<KeywordIdea[]> {
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
}

export type SerpIntent = {
  format: 'listicle' | 'guide' | 'comparison' | 'product' | 'mixed'
  topResults: Array<{ title: string; url: string; type: string }>
  recommendation: string
}

/**
 * Analyze SERP for a keyword to determine winning content format.
 * Cost: ~$0.002 per request
 */
export async function analyzeSerpIntent(
  keyword: string,
  locationCode = 2840
): Promise<SerpIntent> {
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
  const items: Array<{ title: string; url: string; type: string }> =
    data.tasks?.[0]?.result?.[0]?.items
      ?.filter((i: { type: string }) => i.type === 'organic')
      ?.slice(0, 10)
      ?.map((i: { title: string; url: string; type: string }) => ({
        title: i.title,
        url: i.url,
        type: i.type,
      })) ?? []

  // Classify format from titles
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

  const formatAdvice: Record<SerpIntent['format'], string> = {
    listicle: 'Top results are listicles. Use a numbered list format (e.g. "X Best Ways to..."). Each item needs a subheading and 2–3 paragraphs.',
    guide: 'Top results are comprehensive guides. Write a thorough how-to or explainer with H2 sections covering each subtopic in depth.',
    comparison: 'Top results are comparison posts. Structure as a head-to-head with a clear recommendation and comparison table.',
    product: 'Top results are product/commercial pages. Include pricing, features, and a strong CTA. Less editorial, more transactional.',
    mixed: 'Mixed SERP. Write a comprehensive guide that covers both informational and commercial angles.',
  }

  return {
    format,
    topResults: items,
    recommendation: formatAdvice[format],
  }
}

/**
 * Pick the best keyword from a list based on volume and difficulty.
 * Scores keywords by volume/difficulty ratio, filtered by min volume and max difficulty.
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
      // Score = volume / (difficulty + 1) — rewards high volume, low difficulty
      const scoreA = a.searchVolume / (a.difficulty + 1)
      const scoreB = b.searchVolume / (b.difficulty + 1)
      return scoreB - scoreA
    })
  return candidates[0] ?? null
}
