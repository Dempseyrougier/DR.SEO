import { NextRequest, NextResponse } from 'next/server'
import { getSupabaseAdmin } from '../../../../lib/supabase'

export const maxDuration = 60

function auth(req: NextRequest) {
  return req.headers.get('x-admin-key') === process.env.ADMIN_KEY
}

function getDataForSEOAuth() {
  const login = process.env.DATAFORSEO_LOGIN
  const password = process.env.DATAFORSEO_PASSWORD
  return 'Basic ' + Buffer.from(`${login}:${password}`).toString('base64')
}

export async function POST(req: NextRequest) {
  if (!auth(req)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { company_id } = await req.json()
  const supabase = getSupabaseAdmin()

  const { data: company } = await supabase
    .from('companies')
    .select('name, domain, location_code')
    .eq('id', company_id)
    .single()

  if (!company) return NextResponse.json({ error: 'Company not found' }, { status: 404 })

  // Get keywords that need rank checking (tracking or content_planned)
  const { data: keywords } = await supabase
    .from('keywords')
    .select('id, keyword, current_rank')
    .eq('company_id', company_id)
    .in('status', ['tracking', 'content_planned', 'published'])
    .limit(20)

  if (!keywords?.length) {
    return NextResponse.json({ message: 'No keywords to track. Research keywords first.' })
  }

  const locationCode = (company as { location_code?: number }).location_code ?? 2840

  // Batch SERP requests — DataForSEO allows up to 100 per request
  const tasks = keywords.map(kw => ({
    keyword: kw.keyword,
    location_code: locationCode,
    language_code: 'en',
    depth: 100, // check top 100 results
  }))

  try {
    const res = await fetch('https://api.dataforseo.com/v3/serp/google/organic/live/regular', {
      method: 'POST',
      headers: {
        Authorization: getDataForSEOAuth(),
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(tasks),
    })

    if (!res.ok) {
      return NextResponse.json({ error: 'DataForSEO SERP API error: ' + res.status }, { status: 500 })
    }

    const data = await res.json()
    const taskResults = data.tasks ?? []

    const updates: Array<{ id: string; keyword: string; rank: number | null; previousRank: number | null }> = []

    for (let i = 0; i < taskResults.length; i++) {
      const task = taskResults[i]
      const keyword = keywords[i]
      if (!keyword) continue

      const items: Array<{ type: string; url: string; rank_absolute: number }> =
        task?.result?.[0]?.items ?? []

      // Find company domain in organic results
      const domainLower = company.domain.toLowerCase()
      const match = items
        .filter(item => item.type === 'organic')
        .find(item => item.url?.toLowerCase().includes(domainLower))

      const newRank = match ? match.rank_absolute : null

      updates.push({
        id: keyword.id,
        keyword: keyword.keyword,
        rank: newRank,
        previousRank: keyword.current_rank,
      })

      // Update rank in DB
      await supabase
        .from('keywords')
        .update({ current_rank: newRank })
        .eq('id', keyword.id)
    }

    const ranked = updates.filter(u => u.rank !== null)
    const improved = updates.filter(u => u.rank !== null && u.previousRank !== null && u.rank < u.previousRank)
    const notRanking = updates.filter(u => u.rank === null)

    const summary = [
      `Checked ${updates.length} keywords for ${company.domain}.`,
      ranked.length > 0 ? `Ranking for ${ranked.length}: ${ranked.map(u => `"${u.keyword}" #${u.rank}`).join(', ')}.` : 'Not yet ranking in top 100 for any tracked keywords.',
      improved.length > 0 ? `↑ Improved: ${improved.map(u => `"${u.keyword}" ${u.previousRank}→${u.rank}`).join(', ')}.` : '',
      notRanking.length > 0 && ranked.length > 0 ? `Not yet ranking: ${notRanking.map(u => `"${u.keyword}"`).join(', ')}.` : '',
    ].filter(Boolean).join(' ')

    return NextResponse.json({ message: summary, updates })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
