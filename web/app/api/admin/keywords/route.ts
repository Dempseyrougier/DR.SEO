import { NextRequest, NextResponse } from 'next/server'
import { getSupabaseAdmin } from '../../../../lib/supabase'
import { getRankedKeywords, getKeywordIdeas, RankedKeyword } from '../../../../lib/dataforseo'
import Anthropic from '@anthropic-ai/sdk'

export const maxDuration = 60

function auth(req: NextRequest) {
  return req.headers.get('x-admin-key') === process.env.ADMIN_KEY
}

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

export async function GET(req: NextRequest) {
  if (!auth(req)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const companyId = req.nextUrl.searchParams.get('company_id')
  const supabase = getSupabaseAdmin()
  let query = supabase.from('keywords').select('*').order('search_volume', { ascending: false })
  if (companyId) query = query.eq('company_id', companyId)
  const { data, error } = await query
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ keywords: data ?? [] })
}

// Clear all keywords for a company
export async function DELETE(req: NextRequest) {
  if (!auth(req)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const companyId = req.nextUrl.searchParams.get('company_id')
  if (!companyId) return NextResponse.json({ error: 'company_id required' }, { status: 400 })
  const supabase = getSupabaseAdmin()
  const { error } = await supabase.from('keywords').delete().eq('company_id', companyId)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}

/**
 * Use Claude Haiku to filter a raw keyword list down to only those
 * genuinely relevant to the business — removing branded queries,
 * navigational terms, and accidental/irrelevant rankings.
 */
async function filterKeywordsWithAI(
  keywords: RankedKeyword[],
  company: { name: string; domain: string; industry: string; target_keywords: string[] | null }
): Promise<Set<string>> {
  if (keywords.length === 0) return new Set()

  const kwList = keywords.map(k => k.keyword).join('\n')

  const res = await anthropic.messages.create({
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 1024,
    messages: [{
      role: 'user',
      content: `You are a keyword relevance filter for an SEO system.

Business: ${company.name}
Domain: ${company.domain}
Industry: ${company.industry}
Core topics: ${company.target_keywords?.join(', ') || 'not specified'}

Below are keywords this domain ranks for in Google. Keep ONLY keywords that:
1. Relate directly to services, activities, or topics this business covers
2. Would make sense as a blog post topic for this business
3. Have clear informational, commercial, or transactional intent for this business

Exclude:
- Branded queries (company name, domain name variations)
- Navigational queries ("login", "contact", "website")
- Keywords from other industries entirely unrelated to this business
- Overly generic single-word terms with no clear topical fit

Keywords to evaluate:
${kwList}

Return ONLY a JSON array of the keyword strings to KEEP. No explanation.
Example: ["sailing tours hawaii", "catamaran oahu sunset"]`,
    }],
  })

  const text = res.content[0].type === 'text' ? res.content[0].text : '[]'
  const match = text.match(/\[[\s\S]*\]/)
  try {
    const kept: string[] = JSON.parse(match?.[0] ?? '[]')
    return new Set(kept.map(k => k.toLowerCase()))
  } catch {
    // If Claude response is unparseable, keep all keywords
    return new Set(keywords.map(k => k.keyword.toLowerCase()))
  }
}

// Research new keyword opportunities for a company
export async function POST(req: NextRequest) {
  if (!auth(req)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { company_id } = await req.json()
  const supabase = getSupabaseAdmin()

  const { data: company, error: companyError } = await supabase
    .from('companies')
    .select('name, domain, industry, target_keywords, voice_guidelines, location_code')
    .eq('id', company_id)
    .single()

  if (companyError) return NextResponse.json({ error: `DB error: ${companyError.message}` }, { status: 500 })
  if (!company) return NextResponse.json({ error: 'Company not found' }, { status: 404 })

  const { data: existingKeywords } = await supabase
    .from('keywords')
    .select('id, keyword')
    .eq('company_id', company_id)

  const covered = new Set((existingKeywords ?? []).map(k => k.keyword.toLowerCase()))
  const locationCode = (company as { location_code?: number }).location_code ?? 2840

  try {
    // Phase 1: fetch all keywords the domain already ranks for
    const ranked = await getRankedKeywords(company.domain, locationCode, 200)
    const freshRanked = ranked.filter(k => !covered.has(k.keyword.toLowerCase()))

    // Phase 2: AI relevance filter — only keep keywords that fit the business
    const relevantSet = await filterKeywordsWithAI(freshRanked, company)
    const relevant = freshRanked.filter(k => relevantSet.has(k.keyword.toLowerCase()))
    const filtered = freshRanked.length - relevant.length

    // Phase 3: save relevant ranked keywords (with live positions)
    // Deduplicate within the batch (DataForSEO can return the same keyword twice)
    const deduped = Array.from(new Map(relevant.map(k => [k.keyword.toLowerCase(), k])).values())
    if (deduped.length > 0) {
      const { error: insertError } = await supabase.from('keywords').upsert(
        deduped.map(k => ({
          company_id,
          keyword: k.keyword,
          search_volume: k.searchVolume,
          difficulty: k.difficulty,
          current_rank: k.rank,
          status: 'tracking',
        })),
        { onConflict: 'company_id,keyword' }
      )
      if (insertError) return NextResponse.json({ error: `Failed to save keywords: ${insertError.message}` }, { status: 500 })

      // Write initial rank history snapshot
      const rankHistoryRows = relevant.map(k => {
        const existing = existingKeywords?.find(e => e.keyword.toLowerCase() === k.keyword.toLowerCase())
        return existing ? { keyword_id: existing.id, company_id, rank: k.rank, checked_at: new Date().toISOString() } : null
      }).filter(Boolean)
      if (rankHistoryRows.length > 0) {
        try { await supabase.from('keyword_rank_history').insert(rankHistoryRows) } catch { /* best-effort */ }
      }
    }

    // Phase 4: if fewer than 10 relevant keywords found, supplement with ideas from target keywords
    let ideaCount = 0
    if (relevant.length < 10 && company.target_keywords?.length) {
      const ideas = await getKeywordIdeas(company.target_keywords.slice(0, 5), locationCode, 50)
      const allCovered = new Set([...covered, ...relevant.map(k => k.keyword.toLowerCase())])
      const freshIdeas = ideas.filter(k => !allCovered.has(k.keyword.toLowerCase()))

      // AI filter the ideas too
      const ideaRelevantSet = await filterKeywordsWithAI(
        freshIdeas.map(k => ({ ...k, rank: 0, url: '' })),
        company
      )
      const relevantIdeas = freshIdeas.filter(k => ideaRelevantSet.has(k.keyword.toLowerCase()))

      if (relevantIdeas.length > 0) {
        const dedupedIdeas = Array.from(new Map(relevantIdeas.map(k => [k.keyword.toLowerCase(), k])).values())
        const { error: ideaInsertError } = await supabase.from('keywords').upsert(
          dedupedIdeas.map(k => ({
            company_id,
            keyword: k.keyword,
            search_volume: k.searchVolume,
            difficulty: k.difficulty,
            status: 'tracking',
          })),
          { onConflict: 'company_id,keyword' }
        )
        if (!ideaInsertError) ideaCount = dedupedIdeas.length
      }
    }

    const total = deduped.length + ideaCount
    const parts: string[] = []
    if (deduped.length > 0) parts.push(`${deduped.length} keywords your site ranks for`)
    if (filtered > 0) parts.push(`${filtered} irrelevant/branded terms removed by AI`)
    if (ideaCount > 0) parts.push(`${ideaCount} additional opportunities added`)
    if (total === 0) parts.push('No new keywords found — try clearing and re-researching, or add target keywords in company settings')

    return NextResponse.json({ found: total, message: parts.join(' · ') + '.' })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
