import { NextRequest, NextResponse } from 'next/server'
import { getSupabaseAdmin } from '../../../../lib/supabase'
import { getKeywordIdeas, selectBestKeyword } from '../../../../lib/dataforseo'
import Anthropic from '@anthropic-ai/sdk'

export const maxDuration = 30

function auth(req: NextRequest) {
  return req.headers.get('x-admin-key') === process.env.ADMIN_KEY
}

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

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

  const { data: company } = await supabase
    .from('companies')
    .select('name, domain, industry, target_keywords, voice_guidelines, location_code')
    .eq('id', company_id)
    .single()

  if (!company) return NextResponse.json({ error: 'Company not found' }, { status: 404 })

  const { data: existingKeywords } = await supabase
    .from('keywords')
    .select('keyword')
    .eq('company_id', company_id)

  const covered = existingKeywords?.map(k => k.keyword) ?? []

  try {
    // Generate seed keywords via Claude
    const seedRes = await anthropic.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 512,
      messages: [{
        role: 'user',
        content: `Company: ${company.name}
Industry: ${company.industry}
Existing target keywords: ${company.target_keywords?.join(', ') || 'none'}
Already tracked keywords: ${covered.slice(0, 20).join(', ') || 'none'}

Generate 10 specific long-tail keyword phrases this company could realistically rank for.
Mix informational and commercial intent. Be specific, not generic.
Return ONLY a JSON array: ["keyword 1", "keyword 2", ...]`,
      }],
    })
    const seedText = seedRes.content[0].type === 'text' ? seedRes.content[0].text : '[]'
    const seedMatch = seedText.match(/\[[\s\S]*\]/)
    const seeds: string[] = JSON.parse(seedMatch?.[0] ?? '[]')

    const locationCode = (company as { location_code?: number }).location_code ?? 2840

    // Get keyword ideas + difficulty from DataForSEO
    const ideas = await getKeywordIdeas(seeds.slice(0, 5), locationCode, 50)

    // Filter out already tracked keywords
    const fresh = ideas.filter(k => !covered.includes(k.keyword))

    // Save to keywords table
    if (fresh.length > 0) {
      await supabase.from('keywords').upsert(
        fresh.map(k => ({
          company_id,
          keyword: k.keyword,
          search_volume: k.searchVolume,
          difficulty: k.difficulty,
          status: 'tracking',
        })),
        { onConflict: 'company_id,keyword' }
      )
    }

    // Also return best opportunity
    const best = selectBestKeyword(fresh, covered)

    return NextResponse.json({
      found: fresh.length,
      best: best ?? null,
      message: `Found ${fresh.length} new keyword opportunities.`,
    })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
