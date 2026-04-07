'use client'

import { useState, useEffect } from 'react'

type AnalyticsData = {
  company: {
    id: string
    name: string
    domain: string
    industry: string
    posts_per_week: number
  }
  content: {
    totalPosts: number
    byStatus: { draft: number; approved: number; published: number; failed: number }
    publishedLast30: number
    publishedLast90: number
    schemaRate: number
    postsPerMonth: Array<{ month: string; label: string; count: number }>
    targetMonthlyPosts: number
  }
  keywords: {
    total: number
    ranked: number
    avgPosition: number | null
    distribution: { top3: number; top10: number; top30: number; beyond30: number; unranked: number }
    totalSearchVolume: number
    estimatedMonthlyClicks: number
    opportunities: Array<{ id: string; keyword: string; search_volume: number; difficulty: number; score: number }>
    quickWins: Array<{ id: string; keyword: string; search_volume: number; difficulty: number; current_rank: number }>
    rankHistory: Array<{ checked_at: string; avg_rank: number }>
  }
  citations: {
    total: number
    citationRate: number | null
    bySource: Array<{ source: string; total: number; cited: number }>
    recent: Array<{ id: string; query: string; source: string; cited: boolean; snippet: string | null; checked_at: string }>
  }
  health: {
    score: number
    breakdown: Record<string, { score: number; label: string }>
  }
}

function StatCard({ label, value, sub, color = 'text-white' }: { label: string; value: string; sub?: string; color?: string }) {
  return (
    <div className="rounded-xl border border-zinc-800 p-4">
      <p className={`text-2xl font-semibold ${color}`}>{value}</p>
      <p className="text-xs text-zinc-500 mt-0.5">{label}</p>
      {sub && <p className="text-xs text-zinc-600 mt-1">{sub}</p>}
    </div>
  )
}

function MiniBar({ value, max, color = 'bg-zinc-600' }: { value: number; max: number; color?: string }) {
  const pct = max > 0 ? Math.round((value / max) * 100) : 0
  return (
    <div className="flex-1 bg-zinc-900 rounded-full h-1.5 overflow-hidden">
      <div className={`h-full rounded-full ${color}`} style={{ width: `${pct}%` }} />
    </div>
  )
}

function diffColor(d: number) {
  if (d < 30) return 'text-green-400'
  if (d < 60) return 'text-yellow-400'
  return 'text-red-400'
}

function rankColor(r: number) {
  if (r <= 3) return 'text-green-400'
  if (r <= 10) return 'text-blue-400'
  if (r <= 30) return 'text-yellow-400'
  return 'text-zinc-500'
}

export default function CompanyAnalytics({
  companyId,
  adminKey,
  onRunRankings,
}: {
  companyId: string
  adminKey: string
  onRunRankings: (companyId: string) => void
}) {
  const [data, setData] = useState<AnalyticsData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    setLoading(true)
    setError('')
    fetch(`/api/admin/analytics?company_id=${companyId}`, {
      headers: { 'x-admin-key': adminKey },
    })
      .then(r => r.json())
      .then(d => {
        if (d.error) setError(d.error)
        else setData(d)
        setLoading(false)
      })
      .catch(() => { setError('Failed to load analytics.'); setLoading(false) })
  }, [companyId, adminKey])

  if (loading) {
    return (
      <div className="flex items-center justify-center h-40">
        <span className="text-zinc-500 text-sm animate-pulse">Loading analytics...</span>
      </div>
    )
  }

  if (error || !data) {
    return <p className="text-red-400 text-sm">{error || 'No data'}</p>
  }

  const { company, content, keywords, citations, health } = data
  const totalKwDist = keywords.distribution.top3 + keywords.distribution.top10 + keywords.distribution.top30 + keywords.distribution.beyond30 + keywords.distribution.unranked
  const maxMonthly = Math.max(...content.postsPerMonth.map(m => m.count), content.targetMonthlyPosts, 1)

  const healthColor = health.score >= 70 ? 'text-green-400' : health.score >= 40 ? 'text-yellow-400' : 'text-red-400'

  return (
    <div className="space-y-6">

      {/* Company header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="font-semibold text-lg">{company.name}</h2>
          <p className="text-xs text-zinc-500">{company.domain} · {company.industry}</p>
        </div>
        <button
          onClick={() => onRunRankings(companyId)}
          className="text-xs px-3 py-1.5 rounded-lg bg-zinc-800 hover:bg-zinc-700 transition-colors"
        >
          Refresh Rankings
        </button>
      </div>

      {/* Overview stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <StatCard
          label="Est. monthly clicks"
          value={keywords.estimatedMonthlyClicks > 0 ? keywords.estimatedMonthlyClicks.toLocaleString() : '—'}
          sub={keywords.totalSearchVolume > 0 ? `${keywords.totalSearchVolume.toLocaleString()} total search vol.` : 'No rankings yet'}
          color="text-blue-400"
        />
        <StatCard
          label="Avg. position"
          value={keywords.avgPosition != null ? `#${keywords.avgPosition}` : '—'}
          sub={`${keywords.ranked} of ${keywords.total} keywords ranking`}
          color={keywords.avgPosition != null && keywords.avgPosition <= 10 ? 'text-green-400' : 'text-zinc-300'}
        />
        <StatCard
          label="Published posts"
          value={String(content.byStatus.published)}
          sub={`${content.publishedLast30} in last 30 days`}
          color="text-zinc-100"
        />
        <StatCard
          label="Brand mention rate"
          value={citations.citationRate != null ? `${citations.citationRate}%` : '—'}
          sub={citations.total > 0 ? `${citations.total} checks run` : 'No checks yet'}
          color={citations.citationRate != null && citations.citationRate > 50 ? 'text-green-400' : 'text-zinc-300'}
        />
      </div>

      {/* Middle row: Rankings + Content */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">

        {/* Keyword rank distribution */}
        <div className="rounded-xl border border-zinc-800 p-5">
          <h3 className="font-medium text-sm mb-4">Keyword Rankings</h3>
          {keywords.total === 0 ? (
            <p className="text-zinc-600 text-xs">No keywords tracked yet. Use the Keywords tab to research opportunities.</p>
          ) : (
            <div className="space-y-3">
              {[
                { label: 'Top 3', count: keywords.distribution.top3, color: 'bg-green-500' },
                { label: 'Positions 4–10', count: keywords.distribution.top10, color: 'bg-blue-500' },
                { label: 'Positions 11–30', count: keywords.distribution.top30, color: 'bg-yellow-500' },
                { label: 'Beyond 30', count: keywords.distribution.beyond30, color: 'bg-zinc-600' },
                { label: 'Not ranking', count: keywords.distribution.unranked, color: 'bg-zinc-800' },
              ].map(row => (
                <div key={row.label} className="flex items-center gap-3">
                  <span className="text-xs text-zinc-500 w-28 shrink-0">{row.label}</span>
                  <div className="flex-1 bg-zinc-900 rounded-full h-2 overflow-hidden">
                    <div
                      className={`h-full rounded-full ${row.color} transition-all`}
                      style={{ width: totalKwDist > 0 ? `${(row.count / totalKwDist) * 100}%` : '0%' }}
                    />
                  </div>
                  <span className="text-xs text-zinc-400 w-6 text-right shrink-0">{row.count}</span>
                </div>
              ))}
            </div>
          )}

          {keywords.ranked > 0 && (
            <div className="mt-4 pt-4 border-t border-zinc-800 grid grid-cols-2 gap-3 text-center">
              <div>
                <p className="text-lg font-semibold text-green-400">
                  {keywords.distribution.top3 + keywords.distribution.top10}
                </p>
                <p className="text-xs text-zinc-600">in top 10</p>
              </div>
              <div>
                <p className="text-lg font-semibold text-blue-400">
                  {keywords.estimatedMonthlyClicks.toLocaleString()}
                </p>
                <p className="text-xs text-zinc-600">est. clicks/mo</p>
              </div>
            </div>
          )}

          {/* Rank trend */}
          {keywords.rankHistory.length > 1 && (
            <div className="mt-4 pt-4 border-t border-zinc-800">
              <p className="text-xs text-zinc-600 mb-2">Avg. position trend (lower = better)</p>
              <div className="flex items-end gap-1 h-12">
                {keywords.rankHistory.map((point, i) => {
                  const maxRank = Math.max(...keywords.rankHistory.map(p => p.avg_rank), 1)
                  const height = Math.max(8, Math.round((point.avg_rank / maxRank) * 48))
                  const isLast = i === keywords.rankHistory.length - 1
                  return (
                    <div
                      key={point.checked_at}
                      title={`${point.checked_at}: avg #${point.avg_rank}`}
                      className={`flex-1 rounded-sm ${isLast ? 'bg-blue-500' : 'bg-zinc-700'} transition-all`}
                      style={{ height: `${height}px` }}
                    />
                  )
                })}
              </div>
              <div className="flex justify-between text-xs text-zinc-700 mt-1">
                <span>{keywords.rankHistory[0]?.checked_at}</span>
                <span>{keywords.rankHistory[keywords.rankHistory.length - 1]?.checked_at}</span>
              </div>
            </div>
          )}
        </div>

        {/* Content velocity */}
        <div className="rounded-xl border border-zinc-800 p-5">
          <h3 className="font-medium text-sm mb-4">Content Velocity</h3>

          {/* Monthly posts chart */}
          <div className="flex items-end gap-2 h-24 mb-3">
            {content.postsPerMonth.map(m => {
              const height = maxMonthly > 0 ? Math.max(4, Math.round((m.count / maxMonthly) * 96)) : 4
              const isOnTarget = m.count >= content.targetMonthlyPosts
              return (
                <div key={m.month} className="flex-1 flex flex-col items-center gap-1">
                  <div className="w-full flex items-end justify-center">
                    <div
                      className={`w-full rounded-sm ${m.count === 0 ? 'bg-zinc-800' : isOnTarget ? 'bg-green-600' : 'bg-zinc-600'}`}
                      style={{ height: `${height}px` }}
                      title={`${m.count} posts`}
                    />
                  </div>
                  <span className="text-xs text-zinc-700">{m.label}</span>
                </div>
              )
            })}
          </div>

          {/* Target line label */}
          <p className="text-xs text-zinc-600 mb-4">
            Target: {content.targetMonthlyPosts} posts/month · Green = on target
          </p>

          <div className="space-y-2.5">
            <div className="flex items-center justify-between text-xs">
              <span className="text-zinc-500">Published (last 30 days)</span>
              <span className="font-medium text-zinc-200">{content.publishedLast30} / {content.targetMonthlyPosts} target</span>
            </div>
            <div className="flex items-center justify-between text-xs">
              <span className="text-zinc-500">Total published</span>
              <span className="font-medium text-zinc-200">{content.byStatus.published}</span>
            </div>
            <div className="flex items-center justify-between text-xs">
              <span className="text-zinc-500">Drafts awaiting review</span>
              <span className={`font-medium ${content.byStatus.draft > 0 ? 'text-amber-400' : 'text-zinc-600'}`}>
                {content.byStatus.draft}
              </span>
            </div>
            <div className="flex items-center justify-between text-xs">
              <span className="text-zinc-500">Schema markup rate</span>
              <span className={`font-medium ${content.schemaRate >= 80 ? 'text-green-400' : content.schemaRate >= 50 ? 'text-yellow-400' : 'text-red-400'}`}>
                {content.schemaRate}%
              </span>
            </div>
          </div>
        </div>
      </div>

      {/* Bottom row: Opportunities + Citations + Health */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">

        {/* Top opportunities */}
        <div className="rounded-xl border border-zinc-800 p-5 md:col-span-1">
          <h3 className="font-medium text-sm mb-1">Top Opportunities</h3>
          <p className="text-xs text-zinc-600 mb-4">High-volume, low-difficulty, not yet ranking</p>
          {keywords.opportunities.length === 0 ? (
            <p className="text-zinc-600 text-xs">No opportunities found. Research more keywords.</p>
          ) : (
            <div className="space-y-2.5">
              {keywords.opportunities.slice(0, 6).map(kw => (
                <div key={kw.id} className="flex items-center gap-2">
                  <div className="flex-1 min-w-0">
                    <p className="text-xs text-zinc-200 truncate">{kw.keyword}</p>
                    <p className="text-xs text-zinc-600">
                      {kw.search_volume.toLocaleString()} vol · <span className={diffColor(kw.difficulty)}>{kw.difficulty}/100 diff</span>
                    </p>
                  </div>
                  <span className="text-xs text-zinc-500 shrink-0 font-mono">{kw.score}</span>
                </div>
              ))}
            </div>
          )}

          {keywords.quickWins.length > 0 && (
            <div className="mt-4 pt-4 border-t border-zinc-800">
              <p className="text-xs text-zinc-600 mb-3">Quick wins — push to top 10</p>
              <div className="space-y-2">
                {keywords.quickWins.map(kw => (
                  <div key={kw.id} className="flex items-center gap-2">
                    <span className={`text-xs font-medium shrink-0 ${rankColor(kw.current_rank)}`}>
                      #{kw.current_rank}
                    </span>
                    <p className="text-xs text-zinc-300 flex-1 truncate">{kw.keyword}</p>
                    <span className="text-xs text-zinc-600 shrink-0">{kw.search_volume.toLocaleString()}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Citations */}
        <div className="rounded-xl border border-zinc-800 p-5 md:col-span-1">
          <h3 className="font-medium text-sm mb-1">Brand Visibility</h3>
          <p className="text-xs text-zinc-600 mb-4">AI citation monitoring</p>

          {citations.total === 0 ? (
            <p className="text-zinc-600 text-xs">No citation checks yet. Run the Citation Monitor.</p>
          ) : (
            <>
              <div className="flex items-center gap-3 mb-4">
                <p className={`text-3xl font-semibold ${
                  (citations.citationRate ?? 0) >= 50 ? 'text-green-400' : (citations.citationRate ?? 0) >= 25 ? 'text-yellow-400' : 'text-zinc-400'
                }`}>
                  {citations.citationRate ?? 0}%
                </p>
                <p className="text-xs text-zinc-500">mentioned in<br/>AI responses</p>
              </div>

              {citations.bySource.map(s => (
                <div key={s.source} className="flex items-center gap-2 mb-2">
                  <span className="text-xs text-zinc-600 w-20 shrink-0 capitalize">{s.source.replace('_', ' ')}</span>
                  <MiniBar
                    value={s.cited}
                    max={s.total}
                    color={s.cited / s.total >= 0.5 ? 'bg-green-600' : 'bg-zinc-600'}
                  />
                  <span className="text-xs text-zinc-500 shrink-0">{s.cited}/{s.total}</span>
                </div>
              ))}

              <div className="mt-4 pt-4 border-t border-zinc-800 space-y-1.5">
                {citations.recent.slice(0, 4).map(c => (
                  <div key={c.id} className="flex items-start gap-2">
                    <span className={`mt-0.5 w-1.5 h-1.5 rounded-full shrink-0 ${c.cited ? 'bg-green-400' : 'bg-zinc-700'}`} />
                    <p className="text-xs text-zinc-500 truncate flex-1">{c.query}</p>
                  </div>
                ))}
              </div>
            </>
          )}
        </div>

        {/* SEO Health Score */}
        <div className="rounded-xl border border-zinc-800 p-5 md:col-span-1">
          <h3 className="font-medium text-sm mb-1">SEO Health</h3>
          <p className="text-xs text-zinc-600 mb-4">Composite score across 4 dimensions</p>

          <div className="flex items-center gap-4 mb-5">
            <p className={`text-5xl font-semibold tabular-nums ${healthColor}`}>{health.score}</p>
            <div>
              <p className="text-xs text-zinc-500">out of 100</p>
              <p className={`text-xs font-medium mt-0.5 ${healthColor}`}>
                {health.score >= 70 ? 'Strong' : health.score >= 40 ? 'Developing' : 'Needs work'}
              </p>
            </div>
          </div>

          <div className="space-y-3">
            {Object.values(health.breakdown).map(dim => (
              <div key={dim.label}>
                <div className="flex items-center justify-between mb-1">
                  <span className="text-xs text-zinc-500">{dim.label}</span>
                  <span className="text-xs text-zinc-400">{dim.score}/25</span>
                </div>
                <div className="bg-zinc-900 rounded-full h-1.5 overflow-hidden">
                  <div
                    className={`h-full rounded-full transition-all ${
                      dim.score >= 20 ? 'bg-green-600' : dim.score >= 12 ? 'bg-yellow-600' : 'bg-zinc-600'
                    }`}
                    style={{ width: `${(dim.score / 25) * 100}%` }}
                  />
                </div>
              </div>
            ))}
          </div>

          <div className="mt-4 pt-4 border-t border-zinc-800">
            <p className="text-xs text-zinc-600">
              {health.score < 40
                ? 'Publish more posts, research keywords, and run citation checks to improve.'
                : health.score < 70
                ? 'Good progress. Focus on pushing rankings from page 2 to page 1.'
                : 'Strong SEO performance. Keep the content cadence consistent.'}
            </p>
          </div>
        </div>
      </div>

    </div>
  )
}
