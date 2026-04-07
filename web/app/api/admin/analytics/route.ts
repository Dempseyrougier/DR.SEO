import { NextRequest, NextResponse } from 'next/server'
import { getSupabaseAdmin } from '../../../../lib/supabase'

export const maxDuration = 30

function auth(req: NextRequest) {
  return req.headers.get('x-admin-key') === process.env.ADMIN_KEY
}

// Estimated CTR by rank position (Sistrix / FirstPageSage curve)
function estimatedCTR(rank: number | null): number {
  if (!rank) return 0
  const curve: Record<number, number> = {
    1: 0.276, 2: 0.158, 3: 0.110, 4: 0.084, 5: 0.063,
    6: 0.049, 7: 0.039, 8: 0.032, 9: 0.026, 10: 0.021,
  }
  if (rank <= 10) return curve[rank] ?? 0.021
  if (rank <= 20) return 0.010
  if (rank <= 30) return 0.003
  return 0
}

export async function GET(req: NextRequest) {
  if (!auth(req)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const companyId = req.nextUrl.searchParams.get('company_id')
  if (!companyId) return NextResponse.json({ error: 'company_id required' }, { status: 400 })

  const supabase = getSupabaseAdmin()

  // Parallel fetch all data
  const [companyRes, postsRes, keywordsRes, citationsRes] = await Promise.all([
    supabase.from('companies').select('*').eq('id', companyId).single(),
    supabase.from('posts').select('id, status, created_at, published_at, schema_injected, target_keyword, title').eq('company_id', companyId).order('created_at', { ascending: false }),
    supabase.from('keywords').select('*').eq('company_id', companyId).order('search_volume', { ascending: false }),
    supabase.from('citation_logs').select('*').eq('company_id', companyId).order('checked_at', { ascending: false }),
  ])

  const company = companyRes.data
  if (!company) return NextResponse.json({ error: 'Company not found' }, { status: 404 })

  const posts = postsRes.data ?? []
  const keywords = keywordsRes.data ?? []
  const citations = citationsRes.data ?? []

  // Fetch rank history (table may not exist yet — fail gracefully)
  let rankHistory: Array<{ checked_at: string; avg_rank: number }> = []
  try {
    const { data: history } = await supabase
      .from('keyword_rank_history')
      .select('checked_at, rank')
      .eq('company_id', companyId)
      .not('rank', 'is', null)
      .order('checked_at', { ascending: true })
      .limit(500)

    if (history?.length) {
      // Group by date, compute avg position per day
      const byDate: Record<string, number[]> = {}
      for (const row of history) {
        const date = row.checked_at.slice(0, 10)
        if (!byDate[date]) byDate[date] = []
        if (row.rank != null) byDate[date].push(row.rank)
      }
      rankHistory = Object.entries(byDate)
        .map(([date, ranks]) => ({
          checked_at: date,
          avg_rank: Math.round(ranks.reduce((a, b) => a + b, 0) / ranks.length),
        }))
        .slice(-30) // last 30 data points
    }
  } catch {
    // Table doesn't exist yet — user needs to run migration
  }

  // ── Content stats ──────────────────────────────────────────────────────────
  const now = new Date()
  const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000)
  const ninetyDaysAgo = new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000)

  const byStatus = {
    draft: posts.filter(p => p.status === 'draft').length,
    approved: posts.filter(p => p.status === 'approved').length,
    published: posts.filter(p => p.status === 'published').length,
    failed: posts.filter(p => p.status === 'failed').length,
  }

  const publishedLast30 = posts.filter(
    p => p.status === 'published' && new Date(p.created_at) >= thirtyDaysAgo
  ).length

  const publishedLast90 = posts.filter(
    p => p.status === 'published' && new Date(p.created_at) >= ninetyDaysAgo
  ).length

  const publishedWithSchema = posts.filter(p => p.status === 'published' && p.schema_injected).length
  const schemaRate = byStatus.published > 0 ? Math.round((publishedWithSchema / byStatus.published) * 100) : 0

  // Posts per month for last 6 months
  const postsPerMonth: Array<{ month: string; label: string; count: number }> = []
  for (let i = 5; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1)
    const label = d.toLocaleDateString('en-US', { month: 'short', year: '2-digit' })
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
    const count = posts.filter(p => {
      const m = p.created_at.slice(0, 7)
      return m === key && p.status === 'published'
    }).length
    postsPerMonth.push({ month: key, label, count })
  }

  // ── Keyword stats ──────────────────────────────────────────────────────────
  const ranked = keywords.filter(k => k.current_rank != null)
  const avgPosition = ranked.length > 0
    ? Math.round(ranked.reduce((sum, k) => sum + (k.current_rank ?? 0), 0) / ranked.length)
    : null

  const distribution = {
    top3: keywords.filter(k => k.current_rank != null && k.current_rank <= 3).length,
    top10: keywords.filter(k => k.current_rank != null && k.current_rank > 3 && k.current_rank <= 10).length,
    top30: keywords.filter(k => k.current_rank != null && k.current_rank > 10 && k.current_rank <= 30).length,
    beyond30: keywords.filter(k => k.current_rank != null && k.current_rank > 30).length,
    unranked: keywords.filter(k => k.current_rank == null).length,
  }

  const totalSearchVolume = keywords.reduce((sum, k) => sum + (k.search_volume ?? 0), 0)

  const estimatedMonthlyClicks = keywords.reduce((sum, k) => {
    const ctr = estimatedCTR(k.current_rank)
    return sum + Math.round((k.search_volume ?? 0) * ctr)
  }, 0)

  // Top opportunities: unranked keywords with best vol/difficulty ratio
  const opportunities = keywords
    .filter(k => k.current_rank == null && (k.search_volume ?? 0) >= 50)
    .map(k => ({
      id: k.id,
      keyword: k.keyword,
      search_volume: k.search_volume ?? 0,
      difficulty: k.difficulty ?? 50,
      score: Math.round(((k.search_volume ?? 0) / ((k.difficulty ?? 50) + 1)) * 10) / 10,
    }))
    .sort((a, b) => b.score - a.score)
    .slice(0, 10)

  // Quick wins: ranking 11-30, decent volume — push to top 10
  const quickWins = keywords
    .filter(k => k.current_rank != null && k.current_rank > 10 && k.current_rank <= 30 && (k.search_volume ?? 0) >= 100)
    .sort((a, b) => (a.current_rank ?? 99) - (b.current_rank ?? 99))
    .slice(0, 5)
    .map(k => ({
      id: k.id,
      keyword: k.keyword,
      search_volume: k.search_volume ?? 0,
      difficulty: k.difficulty ?? 50,
      current_rank: k.current_rank!,
    }))

  // ── Citation stats ─────────────────────────────────────────────────────────
  const citationRate = citations.length > 0
    ? Math.round((citations.filter(c => c.cited).length / citations.length) * 100)
    : null

  const citationsBySource = ['chatgpt', 'perplexity', 'google_ai'].map(source => ({
    source,
    total: citations.filter(c => c.source === source).length,
    cited: citations.filter(c => c.source === source && c.cited).length,
  })).filter(s => s.total > 0)

  // ── SEO Health Score ───────────────────────────────────────────────────────
  const targetMonthlyPosts = company.posts_per_week * 4.33
  const velocityScore = Math.min(25, Math.round((publishedLast30 / Math.max(1, targetMonthlyPosts)) * 25))

  const totalKeywords = keywords.length
  const top30Count = distribution.top3 + distribution.top10 + distribution.top30
  const rankingScore = totalKeywords > 0
    ? Math.min(25, Math.round((top30Count / totalKeywords) * 25))
    : 0

  const coverageScore = Math.min(25, Math.round(totalKeywords / 2))

  const visibilityScore = citationRate != null ? Math.min(25, Math.round(citationRate / 4)) : 0

  const healthScore = velocityScore + rankingScore + coverageScore + visibilityScore

  return NextResponse.json({
    company: {
      id: company.id,
      name: company.name,
      domain: company.domain,
      industry: company.industry,
      posts_per_week: company.posts_per_week,
      ga4_property_id: (company as Record<string, unknown>).ga4_property_id ?? null,
    },
    content: {
      totalPosts: posts.length,
      byStatus,
      publishedLast30,
      publishedLast90,
      schemaRate,
      postsPerMonth,
      targetMonthlyPosts: Math.round(targetMonthlyPosts),
    },
    keywords: {
      total: keywords.length,
      ranked: ranked.length,
      avgPosition,
      distribution,
      totalSearchVolume,
      estimatedMonthlyClicks,
      opportunities,
      quickWins,
      rankHistory,
    },
    citations: {
      total: citations.length,
      citationRate,
      bySource: citationsBySource,
      recent: citations.slice(0, 8),
    },
    health: {
      score: healthScore,
      breakdown: {
        velocity: { score: velocityScore, label: 'Content Velocity' },
        ranking: { score: rankingScore, label: 'Ranking Strength' },
        coverage: { score: coverageScore, label: 'Keyword Coverage' },
        visibility: { score: visibilityScore, label: 'Brand Visibility' },
      },
    },
  })
}
