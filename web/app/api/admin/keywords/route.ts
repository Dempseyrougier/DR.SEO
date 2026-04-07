import { NextRequest, NextResponse } from 'next/server'
import { getSupabaseAdmin } from '../../../../lib/supabase'
import { getRankedKeywords, getKeywordIdeas } from '../../../../lib/dataforseo'

export const maxDuration = 30

function auth(req: NextRequest) {
  return req.headers.get('x-admin-key') === process.env.ADMIN_KEY
}

export async function GET(req: NextRequest) {
  if (!auth(req)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const companyId = req.nextUrl.searchParams.get('company_id')
  const supabase = getSupabaseAdmin()
  const query = supabase.from('keywords').select('*').order('search_volume', { ascending: false })
  if (companyId) query.eq('company_id', companyId)
  const { data, error } = await query
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ keywords: data ?? [] })
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
    .select('keyword')
    .eq('company_id', company_id)

  const covered = new Set((existingKeywords ?? []).map(k => k.keyword.toLowerCase()))
  const locationCode = (company as { location_code?: number }).location_code ?? 2840

  try {
    // Phase 1: import keywords the domain already ranks for (most accurate source)
    const ranked = await getRankedKeywords(company.domain, locationCode, 100)
    const freshRanked = ranked.filter(k => !covered.has(k.keyword.toLowerCase()))

    if (freshRanked.length > 0) {
      await supabase.from('keywords').upsert(
        freshRanked.map(k => ({
          company_id,
          keyword: k.keyword,
          search_volume: k.searchVolume,
          difficulty: k.difficulty,
          current_rank: k.rank,
          status: 'tracking',
        })),
        { onConflict: 'company_id,keyword' }
      )
      // Write rank history for each
      await supabase.from('keyword_rank_history').insert(
        freshRanked.map(k => {
          const existing = existingKeywords?.find(e => e.keyword.toLowerCase() === k.keyword.toLowerCase())
          return {
            keyword_id: (existing as { id?: string } | undefined)?.id,
            company_id,
            rank: k.rank,
            checked_at: new Date().toISOString(),
          }
        }).filter(r => r.keyword_id)
      ).throwOnError().catch(() => { /* rank history is best-effort */ })
    }

    // Phase 2: if we got fewer than 20 ranked keywords, supplement with ideas based on target keywords
    let ideaCount = 0
    if (freshRanked.length < 20 && company.target_keywords?.length) {
      const seeds = company.target_keywords.slice(0, 5)
      const ideas = await getKeywordIdeas(seeds, locationCode, 50)
      const freshIdeas = ideas.filter(k => !covered.has(k.keyword.toLowerCase()) && !freshRanked.some(r => r.keyword.toLowerCase() === k.keyword.toLowerCase()))
      if (freshIdeas.length > 0) {
        await supabase.from('keywords').upsert(
          freshIdeas.map(k => ({
            company_id,
            keyword: k.keyword,
            search_volume: k.searchVolume,
            difficulty: k.difficulty,
            status: 'tracking',
          })),
          { onConflict: 'company_id,keyword' }
        )
        ideaCount = freshIdeas.length
      }
    }

    const total = freshRanked.length + ideaCount
    const parts = []
    if (freshRanked.length > 0) parts.push(`${freshRanked.length} keywords your site already ranks for (with live positions)`)
    if (ideaCount > 0) parts.push(`${ideaCount} additional keyword opportunities`)
    if (total === 0) parts.push('No new keywords found — all are already tracked')

    return NextResponse.json({
      found: total,
      message: parts.join(' + ') + '.',
    })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
