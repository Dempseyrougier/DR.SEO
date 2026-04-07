import { NextRequest, NextResponse } from 'next/server'
import { getSupabaseAdmin } from '../../../../lib/supabase'

export const maxDuration = 30

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

  const { company_id, competitor_domain } = await req.json()
  if (!competitor_domain) return NextResponse.json({ error: 'competitor_domain is required' }, { status: 400 })

  const supabase = getSupabaseAdmin()

  const { data: company } = await supabase
    .from('companies')
    .select('name, domain, location_code')
    .eq('id', company_id)
    .single()

  if (!company) return NextResponse.json({ error: 'Company not found' }, { status: 404 })

  const locationCode = (company as { location_code?: number }).location_code ?? 2840

  // DataForSEO Labs — domain intersection (keywords competitor ranks for that we don't)
  const res = await fetch('https://api.dataforseo.com/v3/dataforseo_labs/google/domain_intersection/live', {
    method: 'POST',
    headers: {
      Authorization: getDataForSEOAuth(),
      'Content-Type': 'application/json',
    },
    body: JSON.stringify([{
      target1: competitor_domain.replace(/^https?:\/\//, '').replace(/\/$/, ''),
      target2: company.domain,
      location_code: locationCode,
      language_code: 'en',
      limit: 50,
      order_by: ['keyword_data.keyword_info.search_volume,desc'],
      filters: [
        ['keyword_data.keyword_info.search_volume', '>', 50],
        'and',
        ['ranked_serp_element.serp_item.rank_group', '<', 20], // competitor ranks in top 20
      ],
    }]),
  })

  if (!res.ok) {
    return NextResponse.json({ error: 'DataForSEO error: ' + res.status }, { status: 500 })
  }

  const data = await res.json()

  // domain_intersection returns keywords both domains rank for
  // We want keywords where competitor ranks but our domain doesn't (gaps)
  // Use competitor_keywords endpoint instead for true gap analysis
  const intersectionItems: Array<{
    keyword: string
    keyword_data: {
      keyword_info: { search_volume: number; cpc: number }
      keyword_properties: { keyword_difficulty: number }
    }
  }> = data.tasks?.[0]?.result?.[0]?.items ?? []

  if (!intersectionItems.length) {
    // Fallback: get competitor's top keywords directly
    const compRes = await fetch('https://api.dataforseo.com/v3/dataforseo_labs/google/ranked_keywords/live', {
      method: 'POST',
      headers: {
        Authorization: getDataForSEOAuth(),
        'Content-Type': 'application/json',
      },
      body: JSON.stringify([{
        target: competitor_domain.replace(/^https?:\/\//, '').replace(/\/$/, ''),
        location_code: locationCode,
        language_code: 'en',
        limit: 50,
        order_by: ['keyword_data.keyword_info.search_volume,desc'],
        filters: [
          ['keyword_data.keyword_info.search_volume', '>', 50],
          'and',
          ['ranked_serp_element.serp_item.rank_group', '<', 20],
        ],
      }]),
    })

    if (!compRes.ok) {
      return NextResponse.json({ error: 'Could not fetch competitor keywords.' }, { status: 500 })
    }

    const compData = await compRes.json()
    const compItems: Array<{
      keyword_data: {
        keyword: string
        keyword_info: { search_volume: number; cpc: number }
        keyword_properties: { keyword_difficulty: number }
      }
      ranked_serp_element: { serp_item: { rank_group: number } }
    }> = compData.tasks?.[0]?.result?.[0]?.items ?? []

    // Get our existing keywords to filter out what we already cover
    const { data: existingKws } = await supabase
      .from('keywords')
      .select('keyword')
      .eq('company_id', company_id)

    const existingSet = new Set(existingKws?.map(k => k.keyword.toLowerCase()) ?? [])

    const gaps = compItems
      .filter(item => !existingSet.has(item.keyword_data.keyword.toLowerCase()))
      .map(item => ({
        keyword: item.keyword_data.keyword,
        searchVolume: item.keyword_data.keyword_info.search_volume,
        difficulty: item.keyword_data.keyword_properties?.keyword_difficulty ?? 0,
        cpc: item.keyword_data.keyword_info.cpc,
        competitorRank: item.ranked_serp_element.serp_item.rank_group,
      }))

    // Save gaps to keywords table
    if (gaps.length > 0) {
      await supabase.from('keywords').upsert(
        gaps.map(g => ({
          company_id,
          keyword: g.keyword,
          search_volume: g.searchVolume,
          difficulty: g.difficulty,
          status: 'tracking',
        })),
        { onConflict: 'company_id,keyword' }
      )
    }

    return NextResponse.json({
      gaps,
      competitor: competitor_domain,
      message: `Found ${gaps.length} keywords ${competitor_domain} ranks for that ${company.domain} doesn't. Added to Keywords tab.`,
    })
  }

  return NextResponse.json({
    gaps: [],
    message: 'No gap data returned. Try a different competitor domain.',
  })
}
