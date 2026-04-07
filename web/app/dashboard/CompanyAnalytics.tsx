'use client'

import { useState, useEffect } from 'react'

type AnalyticsData = {
  company: {
    id: string
    name: string
    domain: string
    industry: string
    posts_per_week: number
    ga4_property_id: string | null
  }
  content: {
    totalPosts: number
    byStatus: { draft: number; approved: number; published: number; failed: number }
    publishedLast30: number
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

type GA4Data = {
  error?: string
  trend: Array<{ date: string; sessions: number; users: number }>
  summary: {
    sessions: { value: number; change: number | null }
    users: { value: number; change: number | null }
    pageviews: { value: number; change: number | null }
    engagementRate: { value: number; change: number | null }
    avgSessionDuration: { value: number; change: null }
  }
  channels: Array<{ channel: string; sessions: number }>
  topPages: Array<{ page: string; sessions: number; users: number; engagementRate: number }>
}

type GSCData = {
  error?: string
  trend: Array<{ date: string; clicks: number; impressions: number; ctr: number; position: number }>
  summary: {
    clicks: { value: number; change: number | null }
    impressions: { value: number; change: number | null }
    ctr: { value: number; change: null }
    position: { value: number; change: null }
  }
  queries: Array<{ query: string; clicks: number; impressions: number; ctr: number; position: number }>
  pages: Array<{ page: string; clicks: number; impressions: number; ctr: number; position: number }>
}

function Change({ value }: { value: number | null }) {
  if (value === null) return null
  const up = value > 0
  return (
    <span className={`text-xs ml-1 ${up ? 'text-green-400' : 'text-red-400'}`}>
      {up ? '+' : ''}{value}%
    </span>
  )
}

function StatCard({
  label, value, sub, color = 'text-white', change,
}: {
  label: string; value: string; sub?: string; color?: string; change?: number | null
}) {
  return (
    <div className="rounded-xl border border-zinc-800 p-4">
      <div className="flex items-baseline gap-1">
        <p className={`text-2xl font-semibold ${color}`}>{value}</p>
        {change !== undefined && <Change value={change} />}
      </div>
      <p className="text-xs text-zinc-500 mt-0.5">{label}</p>
      {sub && <p className="text-xs text-zinc-600 mt-0.5">{sub}</p>}
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

function formatDuration(seconds: number) {
  if (seconds < 60) return `${seconds}s`
  return `${Math.floor(seconds / 60)}m ${seconds % 60}s`
}

function MiniSparkline({ values, color = 'bg-zinc-600' }: { values: number[]; color?: string }) {
  const max = Math.max(...values, 1)
  return (
    <div className="flex items-end gap-0.5 h-8">
      {values.map((v, i) => (
        <div
          key={i}
          className={`flex-1 rounded-sm ${i === values.length - 1 ? color.replace('bg-', 'bg-') + ' opacity-100' : color + ' opacity-60'}`}
          style={{ height: `${Math.max(10, Math.round((v / max) * 32))}%` }}
        />
      ))}
    </div>
  )
}

function ConnectCard({ title, steps }: { title: string; steps: string[] }) {
  return (
    <div className="rounded-xl border border-dashed border-zinc-700 p-5">
      <p className="text-sm font-medium text-zinc-300 mb-1">{title}</p>
      <p className="text-xs text-zinc-500 mb-3">Follow these steps to connect:</p>
      <ol className="space-y-1.5">
        {steps.map((s, i) => (
          <li key={i} className="text-xs text-zinc-500 flex gap-2">
            <span className="text-zinc-700 shrink-0">{i + 1}.</span>
            <span>{s}</span>
          </li>
        ))}
      </ol>
    </div>
  )
}

export default function CompanyAnalytics({
  companyId,
  adminKey,
  onRunRankings,
  onSavePropertyId,
}: {
  companyId: string
  adminKey: string
  onRunRankings: (companyId: string) => void
  onSavePropertyId: (companyId: string, propertyId: string) => Promise<void>
}) {
  const [data, setData] = useState<AnalyticsData | null>(null)
  const [ga4, setGa4] = useState<GA4Data | null>(null)
  const [gsc, setGsc] = useState<GSCData | null>(null)
  const [loading, setLoading] = useState(true)
  const [ga4Loading, setGa4Loading] = useState(false)
  const [gscLoading, setGscLoading] = useState(false)
  const [error, setError] = useState('')
  const [propertyIdInput, setPropertyIdInput] = useState('')
  const [savingPropertyId, setSavingPropertyId] = useState(false)

  const headers = { 'x-admin-key': adminKey }

  useEffect(() => {
    setLoading(true)
    setError('')
    fetch(`/api/admin/analytics?company_id=${companyId}`, { headers })
      .then(r => r.json())
      .then(d => {
        if (d.error) { setError(d.error); setLoading(false); return }
        setData(d)
        setLoading(false)

        // Fetch GA4 if property ID is set
        if (d.company.ga4_property_id) {
          setGa4Loading(true)
          fetch(`/api/admin/analytics/ga4?property_id=${d.company.ga4_property_id}`, { headers })
            .then(r => r.json())
            .then(ga4d => { setGa4(ga4d); setGa4Loading(false) })
            .catch(() => setGa4Loading(false))
        }

        // Fetch GSC always (uses domain)
        if (d.company.domain) {
          setGscLoading(true)
          fetch(`/api/admin/analytics/gsc?domain=${d.company.domain}`, { headers })
            .then(r => r.json())
            .then(gscd => { setGsc(gscd); setGscLoading(false) })
            .catch(() => setGscLoading(false))
        }
      })
      .catch(() => { setError('Failed to load analytics.'); setLoading(false) })
  }, [companyId])

  async function savePropertyId() {
    if (!propertyIdInput.trim()) return
    setSavingPropertyId(true)
    await onSavePropertyId(companyId, propertyIdInput.trim())
    setSavingPropertyId(false)
    // Refresh GA4 data
    setGa4Loading(true)
    fetch(`/api/admin/analytics/ga4?property_id=${propertyIdInput.trim()}`, { headers })
      .then(r => r.json())
      .then(ga4d => { setGa4(ga4d); setGa4Loading(false) })
      .catch(() => setGa4Loading(false))
    if (data) setData({ ...data, company: { ...data.company, ga4_property_id: propertyIdInput.trim() } })
  }

  if (loading) {
    return <div className="flex items-center justify-center h-40"><span className="text-zinc-500 text-sm animate-pulse">Loading analytics...</span></div>
  }
  if (error || !data) return <p className="text-red-400 text-sm">{error || 'No data'}</p>

  const { company, content, keywords, citations, health } = data
  const totalKwDist = keywords.distribution.top3 + keywords.distribution.top10 + keywords.distribution.top30 + keywords.distribution.beyond30 + keywords.distribution.unranked
  const maxMonthly = Math.max(...content.postsPerMonth.map(m => m.count), content.targetMonthlyPosts, 1)
  const healthColor = health.score >= 70 ? 'text-green-400' : health.score >= 40 ? 'text-yellow-400' : 'text-red-400'
  const gscReady = gsc && !gsc.error
  const ga4Ready = ga4 && !ga4.error

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

      {/* GA4 Property ID — always visible settings row */}
      <div className="rounded-xl border border-zinc-800 bg-zinc-900/50 px-4 py-3 flex items-center gap-3">
        <span className="text-xs text-zinc-500 shrink-0">GA4 Property ID</span>
        <input
          value={propertyIdInput || company.ga4_property_id || ''}
          onChange={e => setPropertyIdInput(e.target.value)}
          placeholder="e.g. 123456789  — find this in GA4 → Admin → Property Settings"
          className="flex-1 rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-1.5 text-xs text-zinc-200 placeholder:text-zinc-600 focus:outline-none focus:border-zinc-500"
        />
        <button
          onClick={savePropertyId}
          disabled={savingPropertyId || !propertyIdInput.trim()}
          className="text-xs px-3 py-1.5 rounded-lg bg-white text-black font-semibold disabled:opacity-40 hover:bg-zinc-200 transition-colors shrink-0"
        >
          {savingPropertyId ? 'Saving...' : company.ga4_property_id ? 'Update' : 'Connect'}
        </button>
        {company.ga4_property_id && !propertyIdInput && (
          <span className="text-xs text-green-400 shrink-0">● Connected</span>
        )}
      </div>

      {/* ── SEARCH CONSOLE SECTION ───────────────────────────────────────────── */}
      <div>
        <h3 className="text-xs font-medium text-zinc-500 uppercase tracking-wider mb-3">Search Performance (Google Search Console)</h3>

        {gscLoading ? (
          <div className="rounded-xl border border-zinc-800 p-6 text-center text-zinc-600 text-xs animate-pulse">Loading Search Console data...</div>
        ) : gsc?.error === 'not_configured' ? (
          <ConnectCard
            title="Connect Google Search Console"
            steps={[
              'Go to console.cloud.google.com → create a project',
              'Enable "Google Search Console API"',
              'Create a Service Account → download JSON key',
              'Add service account email to Search Console as Full User',
              'Add GOOGLE_SERVICE_ACCOUNT_KEY (full JSON) to Vercel env vars',
              'Redeploy — Search Console data will appear automatically',
            ]}
          />
        ) : gsc?.error === 'permission_denied' ? (
          <div className="rounded-xl border border-red-900/30 bg-red-900/10 p-4 text-xs text-red-400">
            Permission denied. Make sure the service account email is added to Search Console for {company.domain} as a Full User.
          </div>
        ) : gscReady ? (
          <div className="space-y-4">
            {/* GSC summary cards */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              <StatCard label="Clicks (30d)" value={gsc.summary.clicks.value.toLocaleString()} change={gsc.summary.clicks.change} color="text-blue-400" />
              <StatCard label="Impressions (30d)" value={gsc.summary.impressions.value.toLocaleString()} change={gsc.summary.impressions.change} color="text-zinc-200" />
              <StatCard label="Avg CTR" value={`${gsc.summary.ctr.value}%`} color={gsc.summary.ctr.value >= 3 ? 'text-green-400' : 'text-yellow-400'} />
              <StatCard label="Avg Position" value={`#${gsc.summary.position.value}`} color={gsc.summary.position.value <= 10 ? 'text-green-400' : 'text-zinc-300'} />
            </div>

            {/* GSC trend chart */}
            {gsc.trend.length > 0 && (
              <div className="rounded-xl border border-zinc-800 p-5">
                <p className="text-xs text-zinc-500 mb-3">Clicks per day (last 30 days)</p>
                <div className="flex items-end gap-1 h-16">
                  {gsc.trend.map((d, i) => {
                    const maxClicks = Math.max(...gsc.trend.map(t => t.clicks), 1)
                    const h = Math.max(4, Math.round((d.clicks / maxClicks) * 64))
                    return (
                      <div
                        key={d.date}
                        title={`${d.date}: ${d.clicks} clicks`}
                        className={`flex-1 rounded-sm ${i === gsc.trend.length - 1 ? 'bg-blue-500' : 'bg-blue-900/60'}`}
                        style={{ height: `${h}px` }}
                      />
                    )
                  })}
                </div>
                <div className="flex justify-between text-xs text-zinc-700 mt-1">
                  <span>{gsc.trend[0]?.date}</span>
                  <span>{gsc.trend[gsc.trend.length - 1]?.date}</span>
                </div>
              </div>
            )}

            {/* Top queries + top pages */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="rounded-xl border border-zinc-800 p-5">
                <p className="text-xs text-zinc-500 mb-3">Top search queries</p>
                <div className="space-y-2">
                  {gsc.queries.slice(0, 8).map(q => (
                    <div key={q.query} className="flex items-center gap-2">
                      <p className="text-xs text-zinc-300 flex-1 truncate">{q.query}</p>
                      <span className="text-xs text-blue-400 shrink-0">{q.clicks} clicks</span>
                      <span className="text-xs text-zinc-600 shrink-0">#{q.position}</span>
                    </div>
                  ))}
                </div>
              </div>
              <div className="rounded-xl border border-zinc-800 p-5">
                <p className="text-xs text-zinc-500 mb-3">Top pages by clicks</p>
                <div className="space-y-2">
                  {gsc.pages.slice(0, 8).map(p => {
                    const slug = p.page.replace(/^https?:\/\/[^/]+/, '') || '/'
                    return (
                      <div key={p.page} className="flex items-center gap-2">
                        <p className="text-xs text-zinc-300 flex-1 truncate">{slug}</p>
                        <span className="text-xs text-blue-400 shrink-0">{p.clicks} clicks</span>
                        <span className="text-xs text-zinc-600 shrink-0">{p.ctr}% CTR</span>
                      </div>
                    )
                  })}
                </div>
              </div>
            </div>
          </div>
        ) : (
          <div className="rounded-xl border border-zinc-800 p-4 text-xs text-zinc-600">No Search Console data available.</div>
        )}
      </div>

      {/* ── GOOGLE ANALYTICS SECTION ─────────────────────────────────────────── */}
      <div>
        <h3 className="text-xs font-medium text-zinc-500 uppercase tracking-wider mb-3">Traffic (Google Analytics 4)</h3>

        {!company.ga4_property_id && !ga4Ready ? (
          <div className="rounded-xl border border-zinc-800 p-4 text-xs text-zinc-500">
            Enter your GA4 Property ID in the field above to connect Google Analytics.
          </div>
        ) : ga4Loading ? (
          <div className="rounded-xl border border-zinc-800 p-6 text-center text-zinc-600 text-xs animate-pulse">Loading GA4 data...</div>
        ) : ga4?.error === 'permission_denied' ? (
          <div className="rounded-xl border border-red-900/30 bg-red-900/10 p-4 text-xs text-red-400">
            Permission denied for Property ID {company.ga4_property_id}. Make sure the service account has Viewer access in GA4.
          </div>
        ) : ga4Ready ? (
          <div className="space-y-4">
            {/* GA4 summary cards */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              <StatCard label="Sessions (30d)" value={ga4.summary.sessions.value.toLocaleString()} change={ga4.summary.sessions.change} color="text-green-400" />
              <StatCard label="Users (30d)" value={ga4.summary.users.value.toLocaleString()} change={ga4.summary.users.change} color="text-zinc-200" />
              <StatCard label="Page views" value={ga4.summary.pageviews.value.toLocaleString()} change={ga4.summary.pageviews.change} color="text-zinc-200" />
              <StatCard label="Engagement rate" value={`${ga4.summary.engagementRate.value}%`} color={ga4.summary.engagementRate.value >= 50 ? 'text-green-400' : 'text-yellow-400'} sub={`Avg ${formatDuration(ga4.summary.avgSessionDuration.value)}/session`} />
            </div>

            {/* GA4 trend chart */}
            {ga4.trend.length > 0 && (
              <div className="rounded-xl border border-zinc-800 p-5">
                <p className="text-xs text-zinc-500 mb-3">Sessions per day (last 30 days)</p>
                <div className="flex items-end gap-1 h-16">
                  {ga4.trend.map((d, i) => {
                    const maxSessions = Math.max(...ga4.trend.map(t => t.sessions), 1)
                    const h = Math.max(4, Math.round((d.sessions / maxSessions) * 64))
                    return (
                      <div
                        key={d.date}
                        title={`${d.date}: ${d.sessions} sessions`}
                        className={`flex-1 rounded-sm ${i === ga4.trend.length - 1 ? 'bg-green-500' : 'bg-green-900/60'}`}
                        style={{ height: `${h}px` }}
                      />
                    )
                  })}
                </div>
                <div className="flex justify-between text-xs text-zinc-700 mt-1">
                  <span>{ga4.trend[0]?.date?.replace(/(\d{4})(\d{2})(\d{2})/, '$1-$2-$3')}</span>
                  <span>{ga4.trend[ga4.trend.length - 1]?.date?.replace(/(\d{4})(\d{2})(\d{2})/, '$1-$2-$3')}</span>
                </div>
              </div>
            )}

            {/* Channels + Top pages */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="rounded-xl border border-zinc-800 p-5">
                <p className="text-xs text-zinc-500 mb-3">Sessions by channel</p>
                {(() => {
                  const total = ga4.channels.reduce((s, c) => s + c.sessions, 0)
                  return ga4.channels.map(c => (
                    <div key={c.channel} className="flex items-center gap-2 mb-2">
                      <span className="text-xs text-zinc-400 w-28 shrink-0 truncate">{c.channel}</span>
                      <div className="flex-1 bg-zinc-900 rounded-full h-1.5 overflow-hidden">
                        <div
                          className="h-full rounded-full bg-green-700"
                          style={{ width: `${total > 0 ? (c.sessions / total) * 100 : 0}%` }}
                        />
                      </div>
                      <span className="text-xs text-zinc-500 shrink-0">{c.sessions.toLocaleString()}</span>
                    </div>
                  ))
                })()}
              </div>
              <div className="rounded-xl border border-zinc-800 p-5">
                <p className="text-xs text-zinc-500 mb-3">Top landing pages</p>
                <div className="space-y-2">
                  {ga4.topPages.map(p => {
                    const slug = p.page || '/'
                    return (
                      <div key={p.page} className="flex items-center gap-2">
                        <p className="text-xs text-zinc-300 flex-1 truncate">{slug}</p>
                        <span className="text-xs text-green-400 shrink-0">{p.sessions.toLocaleString()}</span>
                        <span className="text-xs text-zinc-600 shrink-0">{p.engagementRate}%</span>
                      </div>
                    )
                  })}
                </div>
              </div>
            </div>
          </div>
        ) : null}
      </div>

      {/* ── SEO PERFORMANCE (internal data) ──────────────────────────────────── */}
      <div>
        <h3 className="text-xs font-medium text-zinc-500 uppercase tracking-wider mb-3">SEO Performance</h3>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
          <StatCard
            label="Est. organic clicks/mo"
            value={keywords.estimatedMonthlyClicks > 0 ? keywords.estimatedMonthlyClicks.toLocaleString() : '—'}
            sub={keywords.totalSearchVolume > 0 ? `${keywords.totalSearchVolume.toLocaleString()} vol tracked` : undefined}
            color="text-blue-400"
          />
          <StatCard
            label="Avg. rank position"
            value={keywords.avgPosition != null ? `#${keywords.avgPosition}` : '—'}
            sub={`${keywords.ranked}/${keywords.total} keywords ranking`}
            color={keywords.avgPosition != null && keywords.avgPosition <= 10 ? 'text-green-400' : 'text-zinc-300'}
          />
          <StatCard label="Published posts" value={String(content.byStatus.published)} sub={`${content.publishedLast30} in last 30 days`} />
          <StatCard
            label="Brand mention rate"
            value={citations.citationRate != null ? `${citations.citationRate}%` : '—'}
            sub={citations.total > 0 ? `${citations.total} AI checks run` : undefined}
            color={citations.citationRate != null && citations.citationRate > 50 ? 'text-green-400' : 'text-zinc-300'}
          />
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {/* Keyword rank distribution */}
          <div className="rounded-xl border border-zinc-800 p-5">
            <h3 className="font-medium text-sm mb-4">Keyword rank distribution</h3>
            {keywords.total === 0 ? (
              <p className="text-zinc-600 text-xs">No keywords tracked yet.</p>
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
                      <div className={`h-full rounded-full ${row.color}`} style={{ width: totalKwDist > 0 ? `${(row.count / totalKwDist) * 100}%` : '0%' }} />
                    </div>
                    <span className="text-xs text-zinc-400 w-6 text-right shrink-0">{row.count}</span>
                  </div>
                ))}
              </div>
            )}

            {keywords.rankHistory.length > 1 && (
              <div className="mt-4 pt-4 border-t border-zinc-800">
                <p className="text-xs text-zinc-600 mb-2">Avg. position trend</p>
                <div className="flex items-end gap-1 h-10">
                  {keywords.rankHistory.map((point, i) => {
                    const maxRank = Math.max(...keywords.rankHistory.map(p => p.avg_rank), 1)
                    const h = Math.max(8, Math.round((point.avg_rank / maxRank) * 40))
                    return (
                      <div key={point.checked_at} title={`${point.checked_at}: avg #${point.avg_rank}`}
                        className={`flex-1 rounded-sm ${i === keywords.rankHistory.length - 1 ? 'bg-blue-500' : 'bg-zinc-700'}`}
                        style={{ height: `${h}px` }} />
                    )
                  })}
                </div>
              </div>
            )}
          </div>

          {/* Content velocity */}
          <div className="rounded-xl border border-zinc-800 p-5">
            <h3 className="font-medium text-sm mb-4">Content velocity</h3>
            <div className="flex items-end gap-2 h-20 mb-3">
              {content.postsPerMonth.map(m => {
                const h = maxMonthly > 0 ? Math.max(4, Math.round((m.count / maxMonthly) * 80)) : 4
                return (
                  <div key={m.month} className="flex-1 flex flex-col items-center gap-1">
                    <div className="w-full flex items-end justify-center" style={{ height: '80px' }}>
                      <div className={`w-full rounded-sm ${m.count === 0 ? 'bg-zinc-800' : m.count >= content.targetMonthlyPosts ? 'bg-green-600' : 'bg-zinc-600'}`} style={{ height: `${h}px` }} />
                    </div>
                    <span className="text-xs text-zinc-700">{m.label}</span>
                  </div>
                )
              })}
            </div>
            <p className="text-xs text-zinc-600 mb-3">Target: {content.targetMonthlyPosts}/mo · Green = on target</p>
            <div className="space-y-2">
              <div className="flex justify-between text-xs"><span className="text-zinc-500">Schema markup rate</span><span className={content.schemaRate >= 80 ? 'text-green-400' : content.schemaRate >= 50 ? 'text-yellow-400' : 'text-red-400'}>{content.schemaRate}%</span></div>
              <div className="flex justify-between text-xs"><span className="text-zinc-500">Drafts awaiting review</span><span className={content.byStatus.draft > 0 ? 'text-amber-400' : 'text-zinc-600'}>{content.byStatus.draft}</span></div>
            </div>
          </div>
        </div>

        {/* Opportunities + Health */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mt-4">
          <div className="rounded-xl border border-zinc-800 p-5 md:col-span-2">
            <p className="text-sm font-medium mb-1">Top keyword opportunities</p>
            <p className="text-xs text-zinc-600 mb-3">Unranked · sorted by volume/difficulty score</p>
            {keywords.opportunities.length === 0 ? (
              <p className="text-zinc-600 text-xs">No opportunities yet — research more keywords.</p>
            ) : (
              <div className="space-y-2">
                {keywords.opportunities.slice(0, 6).map(kw => (
                  <div key={kw.id} className="flex items-center gap-3">
                    <div className="flex-1 min-w-0">
                      <p className="text-xs text-zinc-200 truncate">{kw.keyword}</p>
                    </div>
                    <span className="text-xs text-zinc-500 shrink-0">{kw.search_volume.toLocaleString()} vol</span>
                    <span className={`text-xs shrink-0 ${diffColor(kw.difficulty)}`}>{kw.difficulty}/100</span>
                    <span className="text-xs text-zinc-600 shrink-0 w-10 text-right font-mono">{kw.score}</span>
                  </div>
                ))}
              </div>
            )}
            {keywords.quickWins.length > 0 && (
              <div className="mt-4 pt-4 border-t border-zinc-800">
                <p className="text-xs text-zinc-600 mb-2">Quick wins — currently ranking 11-30</p>
                <div className="space-y-2">
                  {keywords.quickWins.map(kw => (
                    <div key={kw.id} className="flex items-center gap-2">
                      <span className={`text-xs font-medium shrink-0 ${rankColor(kw.current_rank)}`}>#{kw.current_rank}</span>
                      <p className="text-xs text-zinc-300 flex-1 truncate">{kw.keyword}</p>
                      <span className="text-xs text-zinc-600">{kw.search_volume.toLocaleString()}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>

          <div className="rounded-xl border border-zinc-800 p-5">
            <p className="text-sm font-medium mb-1">SEO Health</p>
            <p className="text-xs text-zinc-600 mb-4">Composite score</p>
            <div className="flex items-center gap-3 mb-5">
              <p className={`text-5xl font-semibold ${healthColor}`}>{health.score}</p>
              <div>
                <p className="text-xs text-zinc-500">/ 100</p>
                <p className={`text-xs font-medium mt-0.5 ${healthColor}`}>{health.score >= 70 ? 'Strong' : health.score >= 40 ? 'Developing' : 'Needs work'}</p>
              </div>
            </div>
            <div className="space-y-3">
              {Object.values(health.breakdown).map(dim => (
                <div key={dim.label}>
                  <div className="flex justify-between mb-1"><span className="text-xs text-zinc-500">{dim.label}</span><span className="text-xs text-zinc-400">{dim.score}/25</span></div>
                  <div className="bg-zinc-900 rounded-full h-1.5 overflow-hidden">
                    <div className={`h-full rounded-full ${dim.score >= 20 ? 'bg-green-600' : dim.score >= 12 ? 'bg-yellow-600' : 'bg-zinc-600'}`} style={{ width: `${(dim.score / 25) * 100}%` }} />
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
