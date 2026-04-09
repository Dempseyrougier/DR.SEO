'use client'

import { useState, useEffect, useCallback } from 'react'
import type { Company, Post, CitationLog } from '../../lib/types'
import PostEditor from './PostEditor'
import CompanyAnalytics from './CompanyAnalytics'

type Tab = 'companies' | 'posts' | 'keywords' | 'agents' | 'citations' | 'analytics'

type Keyword = {
  id: string
  company_id: string
  keyword: string
  search_volume: number | null
  difficulty: number | null
  current_rank: number | null
  status: string
  created_at: string
}

export default function Dashboard({ adminKey, onLogout }: { adminKey: string; onLogout: () => void }) {
  const [tab, setTab] = useState<Tab>('analytics')
  const [companies, setCompanies] = useState<Company[]>([])
  const [posts, setPosts] = useState<Post[]>([])
  const [citations, setCitations] = useState<CitationLog[]>([])
  const [keywords, setKeywords] = useState<Keyword[]>([])
  const [loading, setLoading] = useState(true)
  const [agentRunning, setAgentRunning] = useState<string | null>(null)
  const [agentResult, setAgentResult] = useState<Record<string, string>>({})
  const [writerExpanded, setWriterExpanded] = useState<Record<string, boolean>>({})
  const [writerPrompt, setWriterPrompt] = useState<Record<string, string>>({})
  const [writerUrl, setWriterUrl] = useState<Record<string, string>>({})
  const [editingPost, setEditingPost] = useState<Post | null>(null)
  const [researchingKeywords, setResearchingKeywords] = useState<string | null>(null)
  const [researchResult, setResearchResult] = useState<Record<string, string>>({})
  const [clearingKeywords, setClearingKeywords] = useState<string | null>(null)
  const [kwFilterStatus, setKwFilterStatus] = useState('')
  const [checkingRankings, setCheckingRankings] = useState<string | null>(null)
  const [rankingResult, setRankingResult] = useState<Record<string, string>>({})
  const [competitorInput, setCompetitorInput] = useState<Record<string, string>>({})
  const [analyzingCompetitor, setAnalyzingCompetitor] = useState<string | null>(null)
  const [competitorResult, setCompetitorResult] = useState<Record<string, string>>({})
  const [schedule, setSchedule] = useState<Array<{
    company_id: string; company_name: string; posts_per_week: number
    days_since_last_post: number | null; days_until_due: number; is_due: boolean
    draft_count: number; last_post_date: string | null
  }>>([])
  const [runningSchedule, setRunningSchedule] = useState(false)
  const [scheduleResult, setScheduleResult] = useState('')

  // Analytics tab state
  const [analyticsCompanyId, setAnalyticsCompanyId] = useState('')
  const [analyticsKey, setAnalyticsKey] = useState(0) // increment to force re-fetch

  // Filters
  const [postFilterCompany, setPostFilterCompany] = useState('')
  const [postFilterStatus, setPostFilterStatus] = useState('')
  const [kwFilterCompany, setKwFilterCompany] = useState('')

  const headers = { 'x-admin-key': adminKey }

  const fetchData = useCallback(async () => {
    setLoading(true)
    const [companiesData, postsData, citationsData, keywordsData, scheduleData] = await Promise.all([
      fetch('/api/admin/companies', { headers }).then(r => r.json()),
      fetch('/api/admin/posts', { headers }).then(r => r.json()),
      fetch('/api/admin/citations', { headers }).then(r => r.json()),
      fetch('/api/admin/keywords', { headers }).then(r => r.json()),
      fetch('/api/admin/schedule', { headers }).then(r => r.json()),
    ])
    const companiesList = companiesData.companies ?? []
    setCompanies(companiesList)
    if (companiesList.length > 0 && !analyticsCompanyId) {
      setAnalyticsCompanyId(companiesList[0].id)
    }
    setPosts(postsData.posts ?? [])
    setCitations(citationsData.citations ?? [])
    setKeywords(keywordsData.keywords ?? [])
    if (keywordsData.error) console.error('Keywords fetch error:', keywordsData.error)
    setSchedule(scheduleData.schedule ?? [])
    setLoading(false)
  }, [adminKey])

  useEffect(() => { fetchData() }, [fetchData])

  async function runAgent(agent: string, companyId?: string, extra?: { prompt?: string; url?: string }) {
    const key = companyId ? `${agent}:${companyId}` : agent
    setAgentRunning(key)
    setAgentResult(prev => ({ ...prev, [key]: '' }))
    const res = await fetch('/api/admin/agents/run', {
      method: 'POST',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({ agent, company_id: companyId, ...extra }),
    })
    const data = await res.json()
    setAgentResult(prev => ({ ...prev, [key]: data.message ?? data.error ?? 'Done' }))
    setAgentRunning(null)
    if (res.ok) fetchData()
  }

  async function updatePostStatus(postId: string, status: 'approved' | 'published' | 'failed') {
    await fetch('/api/admin/posts', {
      method: 'PATCH',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: postId, status }),
    })
    fetchData()
  }

  async function deletePost(postId: string) {
    if (!window.confirm('Delete this post? This cannot be undone.')) return
    await fetch(`/api/admin/posts?id=${postId}`, {
      method: 'DELETE',
      headers,
    })
    fetchData()
  }

  async function toggleAutoPublish(companyId: string, current: boolean) {
    await fetch('/api/admin/companies', {
      method: 'PATCH',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: companyId, auto_publish: !current }),
    })
    fetchData()
  }

  async function checkRankings(companyId: string): Promise<string> {
    setCheckingRankings(companyId)
    setRankingResult(prev => ({ ...prev, [companyId]: '' }))
    const res = await fetch('/api/admin/rankings', {
      method: 'POST',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({ company_id: companyId }),
    })
    const data = await res.json()
    const msg = data.message ?? data.error ?? 'Done'
    setRankingResult(prev => ({ ...prev, [companyId]: msg }))
    setCheckingRankings(null)
    if (res.ok) fetchData()
    return msg
  }

  async function analyzeCompetitor(companyId: string) {
    const domain = competitorInput[companyId]?.trim()
    if (!domain) return
    setAnalyzingCompetitor(companyId)
    setCompetitorResult(prev => ({ ...prev, [companyId]: '' }))
    const res = await fetch('/api/admin/competitors', {
      method: 'POST',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({ company_id: companyId, competitor_domain: domain }),
    })
    const data = await res.json()
    setCompetitorResult(prev => ({ ...prev, [companyId]: data.message ?? data.error ?? 'Done' }))
    setAnalyzingCompetitor(null)
    if (res.ok) fetchData()
  }

  async function clearKeywords(companyId: string, companyName: string) {
    if (!confirm(`Delete all keywords for ${companyName}? This cannot be undone.`)) return
    setClearingKeywords(companyId)
    await fetch(`/api/admin/keywords?company_id=${companyId}`, { method: 'DELETE', headers })
    setClearingKeywords(null)
    fetchData()
  }

  async function researchKeywords(companyId: string) {
    setResearchingKeywords(companyId)
    setResearchResult(prev => ({ ...prev, [companyId]: '' }))
    const res = await fetch('/api/admin/keywords', {
      method: 'POST',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({ company_id: companyId }),
    })
    const data = await res.json()
    setResearchResult(prev => ({ ...prev, [companyId]: data.message ?? data.error ?? 'Done' }))
    setResearchingKeywords(null)
    if (res.ok) fetchData()
  }

  // Derived stats
  const now = new Date()
  const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1)
  const draftCount = posts.filter(p => p.status === 'draft').length
  const publishedThisMonth = posts.filter(p => p.status === 'published' && new Date(p.created_at) >= startOfMonth).length
  const top10Count = keywords.filter(k => k.current_rank != null && k.current_rank <= 10).length
  const dueCount = schedule.filter(s => s.is_due).length

  // Filtered posts
  const filteredPosts = posts.filter(p => {
    if (postFilterCompany && p.company_id !== postFilterCompany) return false
    if (postFilterStatus && p.status !== postFilterStatus) return false
    return true
  })

  // Filtered keywords
  const filteredKeywords = keywords.filter(k => {
    if (kwFilterCompany && k.company_id !== kwFilterCompany) return false
    if (kwFilterStatus && k.status !== kwFilterStatus) return false
    return true
  })

  const tabs: { id: Tab; label: string }[] = [
    { id: 'analytics', label: 'Analytics' },
    { id: 'companies', label: 'Companies' },
    { id: 'posts', label: `Posts${posts.length ? ` (${posts.length})` : ''}` },
    { id: 'keywords', label: `Keywords${keywords.length ? ` (${keywords.length})` : ''}` },
    { id: 'agents', label: 'Agents' },
    { id: 'citations', label: 'Citations' },
  ]

  return (
    <div className="min-h-screen p-6 max-w-6xl mx-auto">
      {editingPost && (
        <PostEditor
          post={editingPost}
          adminKey={adminKey}
          onClose={() => setEditingPost(null)}
          onSave={() => fetchData()}
          onDelete={() => { setEditingPost(null); fetchData() }}
        />
      )}

      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">DR.SEO</h1>
          <p className="text-sm text-zinc-500 mt-0.5">AI-powered SEO platform</p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={fetchData}
            className="text-xs text-zinc-500 hover:text-zinc-300 px-3 py-1.5 rounded-lg border border-zinc-800 hover:border-zinc-700 transition-colors"
          >
            Refresh
          </button>
          <button
            onClick={onLogout}
            className="text-xs text-zinc-500 hover:text-zinc-300 px-3 py-1.5 rounded-lg border border-zinc-800 hover:border-zinc-700 transition-colors"
          >
            Log out
          </button>
        </div>
      </div>

      {/* Stats bar */}
      {!loading && (
        <div className="grid grid-cols-4 gap-3 mb-6">
          {[
            { label: 'Drafts', value: draftCount, color: 'text-zinc-300' },
            { label: 'Published this month', value: publishedThisMonth, color: 'text-green-400' },
            { label: 'Keywords in top 10', value: top10Count, color: 'text-blue-400' },
            { label: 'Companies due', value: dueCount, color: dueCount > 0 ? 'text-orange-400' : 'text-zinc-600' },
          ].map(stat => (
            <div key={stat.label} className="rounded-xl border border-zinc-800 px-4 py-3">
              <p className={`text-2xl font-semibold ${stat.color}`}>{stat.value}</p>
              <p className="text-xs text-zinc-600 mt-0.5">{stat.label}</p>
            </div>
          ))}
        </div>
      )}

      {/* Tabs */}
      <div className="flex gap-1 mb-6 border-b border-zinc-800 pb-0">
        {tabs.map(t => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={`px-4 py-2 text-sm font-medium rounded-t-lg transition-colors -mb-px border-b-2 ${
              tab === t.id
                ? 'text-white border-white'
                : 'text-zinc-500 border-transparent hover:text-zinc-300'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {loading ? (
        <div className="text-zinc-500 text-sm">Loading...</div>
      ) : (
        <>
          {/* ANALYTICS TAB */}
          {tab === 'analytics' && (
            <div>
              {/* Company selector */}
              <div className="flex items-center gap-3 mb-6">
                <div className="flex gap-1.5 flex-wrap">
                  {companies.map(c => (
                    <button
                      key={c.id}
                      onClick={() => { setAnalyticsCompanyId(c.id); setAnalyticsKey(k => k + 1) }}
                      className={`text-xs px-3 py-1.5 rounded-lg border transition-colors ${
                        analyticsCompanyId === c.id
                          ? 'border-white text-white bg-zinc-900'
                          : 'border-zinc-800 text-zinc-500 hover:text-zinc-300 hover:border-zinc-700'
                      }`}
                    >
                      {c.name}
                    </button>
                  ))}
                </div>
              </div>

              {analyticsCompanyId ? (
                <CompanyAnalytics
                  key={`${analyticsCompanyId}-${analyticsKey}`}
                  companyId={analyticsCompanyId}
                  adminKey={adminKey}
                  onRunRankings={async (cid) => {
                    const msg = await checkRankings(cid)
                    setAnalyticsKey(k => k + 1)
                    return msg
                  }}
                  onSavePropertyId={async (cid, propertyId) => {
                    await fetch('/api/admin/companies', {
                      method: 'PATCH',
                      headers: { ...headers, 'Content-Type': 'application/json' },
                      body: JSON.stringify({ id: cid, ga4_property_id: propertyId }),
                    })
                    await fetchData()
                    setAnalyticsKey(k => k + 1)
                  }}
                />
              ) : (
                <p className="text-zinc-500 text-sm">Select a company above.</p>
              )}
            </div>
          )}

          {/* COMPANIES TAB */}
          {tab === 'companies' && (
            <div className="grid gap-4">
              {companies.map(company => {
                const companyPosts = posts.filter(p => p.company_id === company.id)
                const companyKeywords = keywords.filter(k => k.company_id === company.id)
                const companyDrafts = companyPosts.filter(p => p.status === 'draft').length
                const companyPublished = companyPosts.filter(p => p.status === 'published').length
                const companyTop10 = companyKeywords.filter(k => k.current_rank != null && k.current_rank <= 10).length
                const sched = schedule.find(s => s.company_id === company.id)

                return (
                  <div key={company.id} className="rounded-xl border border-zinc-800 p-5">
                    <div className="flex items-start justify-between gap-4">
                      <div>
                        <div className="flex items-center gap-2 mb-1">
                          <h2 className="font-semibold">{company.name}</h2>
                          <span className="text-xs px-2 py-0.5 rounded-full bg-zinc-800 text-zinc-400">
                            {company.cms_type}
                          </span>
                          {!company.active && (
                            <span className="text-xs px-2 py-0.5 rounded-full bg-red-900/40 text-red-400">
                              inactive
                            </span>
                          )}
                        </div>
                        <p className="text-sm text-zinc-400">{company.domain}</p>
                        <p className="text-xs text-zinc-600 mt-1">{company.industry}</p>
                        {/* Per-company stats */}
                        <div className="flex gap-4 mt-3 text-xs text-zinc-500">
                          <span>{companyDrafts} draft{companyDrafts !== 1 ? 's' : ''}</span>
                          <span>{companyPublished} published</span>
                          <span>{companyKeywords.length} keywords</span>
                          {companyTop10 > 0 && <span className="text-green-400">{companyTop10} top-10</span>}
                          {sched && (
                            sched.is_due
                              ? <span className="text-orange-400 font-medium">● due now</span>
                              : <span>due in {sched.days_until_due}d</span>
                          )}
                        </div>
                      </div>
                      <div className="flex flex-col items-end gap-2 shrink-0">
                        <div className="flex items-center gap-2">
                          <span className="text-xs text-zinc-500">Auto-publish</span>
                          <button
                            onClick={() => toggleAutoPublish(company.id, company.auto_publish)}
                            className={`w-10 h-5 rounded-full transition-colors relative ${
                              company.auto_publish ? 'bg-green-600' : 'bg-zinc-700'
                            }`}
                          >
                            <span
                              className={`absolute top-0.5 w-4 h-4 rounded-full bg-white transition-transform ${
                                company.auto_publish ? 'translate-x-5' : 'translate-x-0.5'
                              }`}
                            />
                          </button>
                        </div>
                        <select
                          value={company.posts_per_week}
                          onChange={async e => {
                            await fetch('/api/admin/companies', {
                              method: 'PATCH',
                              headers: { ...headers, 'Content-Type': 'application/json' },
                              body: JSON.stringify({ id: company.id, posts_per_week: Number(e.target.value) }),
                            })
                            fetchData()
                          }}
                          className="text-xs rounded-lg border border-zinc-700 bg-zinc-900 px-2 py-1 text-zinc-300 focus:outline-none focus:border-zinc-500"
                        >
                          {[1, 2, 3, 4, 5, 6, 7].map(n => (
                            <option key={n} value={n}>{n}x/week</option>
                          ))}
                        </select>
                      </div>
                    </div>
                    {company.voice_guidelines && (
                      <p className="text-xs text-zinc-600 mt-3 border-t border-zinc-800 pt-3 line-clamp-2">
                        {company.voice_guidelines}
                      </p>
                    )}
                    <div className="mt-4 border-t border-zinc-800 pt-4">
                      {/* Writer controls */}
                      <div className="mb-3">
                        <button
                          onClick={() => setWriterExpanded(prev => ({ ...prev, [company.id]: !prev[company.id] }))}
                          className="text-xs text-zinc-400 hover:text-zinc-200 flex items-center gap-1 transition-colors"
                        >
                          <span>{writerExpanded[company.id] ? '▾' : '▸'}</span>
                          Writer options
                        </button>
                        {writerExpanded[company.id] && (
                          <div className="mt-2 flex flex-col gap-2">
                            <textarea
                              value={writerPrompt[company.id] ?? ''}
                              onChange={e => setWriterPrompt(prev => ({ ...prev, [company.id]: e.target.value }))}
                              placeholder="Topic or prompt (optional) — e.g. 'write about sunset sailing charters for bachelorette parties'"
                              rows={2}
                              className="w-full rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 text-xs text-zinc-200 placeholder:text-zinc-600 focus:outline-none focus:border-zinc-500 resize-none"
                            />
                            <input
                              type="url"
                              value={writerUrl[company.id] ?? ''}
                              onChange={e => setWriterUrl(prev => ({ ...prev, [company.id]: e.target.value }))}
                              placeholder="Reference URL (optional) — Claude will read this page for inspiration"
                              className="w-full rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 text-xs text-zinc-200 placeholder:text-zinc-600 focus:outline-none focus:border-zinc-500"
                            />
                          </div>
                        )}
                      </div>
                      <div className="flex gap-2">
                        <button
                          onClick={() => runAgent('writer', company.id, {
                            prompt: writerPrompt[company.id] || undefined,
                            url: writerUrl[company.id] || undefined,
                          })}
                          disabled={agentRunning === `writer:${company.id}`}
                          className="text-xs px-3 py-1.5 rounded-lg bg-zinc-800 hover:bg-zinc-700 disabled:opacity-50 transition-colors"
                        >
                          {agentRunning === `writer:${company.id}` ? 'Writing...' : 'Write Post'}
                        </button>
                        <button
                          onClick={() => runAgent('citation', company.id)}
                          disabled={agentRunning === `citation:${company.id}`}
                          className="text-xs px-3 py-1.5 rounded-lg bg-zinc-800 hover:bg-zinc-700 disabled:opacity-50 transition-colors"
                        >
                          {agentRunning === `citation:${company.id}` ? 'Checking...' : 'Check Citations'}
                        </button>
                      </div>
                      {agentResult[`writer:${company.id}`] && (
                        <p className="text-xs text-zinc-400 mt-2">{agentResult[`writer:${company.id}`]}</p>
                      )}
                      {agentResult[`citation:${company.id}`] && (
                        <p className="text-xs text-zinc-400 mt-2">{agentResult[`citation:${company.id}`]}</p>
                      )}
                    </div>
                  </div>
                )
              })}
            </div>
          )}

          {/* POSTS TAB */}
          {tab === 'posts' && (
            <div>
              {/* Filters */}
              <div className="flex gap-2 mb-4 flex-wrap">
                <select
                  value={postFilterCompany}
                  onChange={e => setPostFilterCompany(e.target.value)}
                  className="rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-1.5 text-xs text-zinc-300 focus:outline-none focus:border-zinc-500"
                >
                  <option value="">All companies</option>
                  {companies.map(c => (
                    <option key={c.id} value={c.id}>{c.name}</option>
                  ))}
                </select>
                <select
                  value={postFilterStatus}
                  onChange={e => setPostFilterStatus(e.target.value)}
                  className="rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-1.5 text-xs text-zinc-300 focus:outline-none focus:border-zinc-500"
                >
                  <option value="">All statuses</option>
                  <option value="draft">Draft</option>
                  <option value="approved">Approved</option>
                  <option value="published">Published</option>
                  <option value="failed">Failed</option>
                </select>
                {(postFilterCompany || postFilterStatus) && (
                  <button
                    onClick={() => { setPostFilterCompany(''); setPostFilterStatus('') }}
                    className="text-xs px-3 py-1.5 rounded-lg border border-zinc-700 text-zinc-500 hover:text-zinc-300 transition-colors"
                  >
                    Clear filters
                  </button>
                )}
                <span className="text-xs text-zinc-600 self-center ml-auto">
                  {filteredPosts.length} of {posts.length} posts
                </span>
              </div>

              <div className="grid gap-4">
                {filteredPosts.length === 0 && (
                  <p className="text-zinc-500 text-sm">No posts match the current filters.</p>
                )}
                {filteredPosts.map(post => (
                  <div key={post.id} className="rounded-xl border border-zinc-800 p-5">
                    <div className="flex items-start justify-between gap-4">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-1 flex-wrap">
                          <span
                            className={`text-xs px-2 py-0.5 rounded-full font-medium ${
                              post.status === 'published'
                                ? 'bg-green-900/40 text-green-400'
                                : post.status === 'approved'
                                ? 'bg-blue-900/40 text-blue-400'
                                : post.status === 'failed'
                                ? 'bg-red-900/40 text-red-400'
                                : 'bg-zinc-800 text-zinc-400'
                            }`}
                          >
                            {post.status}
                          </span>
                          {post.companies && (
                            <span className="text-xs text-zinc-500">{post.companies.name}</span>
                          )}
                          {post.target_keyword && (
                            <span className="text-xs text-zinc-600">#{post.target_keyword}</span>
                          )}
                        </div>
                        <h3 className="font-medium text-sm leading-snug">{post.title}</h3>
                        {post.meta_description && (
                          <p className="text-xs text-zinc-500 mt-1 line-clamp-2">{post.meta_description}</p>
                        )}
                        <p className="text-xs text-zinc-700 mt-1">
                          {new Date(post.created_at).toLocaleDateString()}
                        </p>
                      </div>
                      <div className="flex flex-col gap-1.5 shrink-0">
                        <button
                          onClick={() => setEditingPost(post)}
                          className="text-xs px-3 py-1.5 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-zinc-300 transition-colors"
                        >
                          Edit
                        </button>
                        {post.status === 'draft' && (
                          <button
                            onClick={() => updatePostStatus(post.id, 'approved')}
                            className="text-xs px-3 py-1.5 rounded-lg bg-blue-900/40 hover:bg-blue-900/60 text-blue-400 transition-colors"
                          >
                            Approve
                          </button>
                        )}
                        {post.status === 'approved' && (
                          <button
                            onClick={() => runAgent('publisher', post.id)}
                            disabled={agentRunning === `publisher:${post.id}`}
                            className="text-xs px-3 py-1.5 rounded-lg bg-green-900/40 hover:bg-green-900/60 text-green-400 disabled:opacity-50 transition-colors"
                          >
                            {agentRunning === `publisher:${post.id}` ? 'Publishing...' : 'Publish'}
                          </button>
                        )}
                        <button
                          onClick={() => deletePost(post.id)}
                          className="text-xs px-3 py-1.5 rounded-lg border border-zinc-800 hover:border-red-900 text-zinc-600 hover:text-red-500 transition-colors"
                        >
                          Delete
                        </button>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* KEYWORDS TAB */}
          {tab === 'keywords' && (
            <div>
              {/* Action buttons per company */}
              <div className="flex flex-col gap-3 mb-6">
                {companies.map(company => (
                  <div key={company.id} className="rounded-xl border border-zinc-800 p-4">
                    <p className="text-sm font-medium mb-3">{company.name}</p>
                    <div className="flex gap-2 flex-wrap">
                      <button
                        onClick={() => researchKeywords(company.id)}
                        disabled={researchingKeywords === company.id}
                        className="text-xs px-3 py-1.5 rounded-lg bg-zinc-800 hover:bg-zinc-700 disabled:opacity-50 transition-colors"
                      >
                        {researchingKeywords === company.id ? 'Researching...' : '🔍 Research Keywords'}
                      </button>
                      <button
                        onClick={() => clearKeywords(company.id, company.name)}
                        disabled={clearingKeywords === company.id}
                        className="text-xs px-3 py-1.5 rounded-lg border border-zinc-800 hover:border-red-900 text-zinc-600 hover:text-red-500 disabled:opacity-50 transition-colors"
                      >
                        {clearingKeywords === company.id ? 'Clearing...' : 'Clear All'}
                      </button>
                    </div>
                    {researchResult[company.id] && (
                      <p className="text-xs text-zinc-500 mt-2">{researchResult[company.id]}</p>
                    )}
                    {/* Competitor gap analysis */}
                    <div className="mt-3 pt-3 border-t border-zinc-800">
                      <p className="text-xs text-zinc-600 mb-2">Competitor gap analysis</p>
                      <div className="flex gap-2">
                        <input
                          type="text"
                          value={competitorInput[company.id] ?? ''}
                          onChange={e => setCompetitorInput(prev => ({ ...prev, [company.id]: e.target.value }))}
                          placeholder="competitor.com"
                          className="flex-1 rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-1.5 text-xs text-zinc-200 placeholder:text-zinc-600 focus:outline-none focus:border-zinc-500"
                        />
                        <button
                          onClick={() => analyzeCompetitor(company.id)}
                          disabled={analyzingCompetitor === company.id || !competitorInput[company.id]?.trim()}
                          className="text-xs px-3 py-1.5 rounded-lg bg-zinc-800 hover:bg-zinc-700 disabled:opacity-50 transition-colors whitespace-nowrap"
                        >
                          {analyzingCompetitor === company.id ? 'Analyzing...' : '🎯 Find Gaps'}
                        </button>
                      </div>
                      {competitorResult[company.id] && (
                        <p className="text-xs text-zinc-400 mt-2">{competitorResult[company.id]}</p>
                      )}
                    </div>
                  </div>
                ))}
              </div>

              {/* Filters for keyword table */}
              <div className="flex items-center gap-2 mb-3 flex-wrap">
                <select
                  value={kwFilterCompany}
                  onChange={e => setKwFilterCompany(e.target.value)}
                  className="rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-1.5 text-xs text-zinc-300 focus:outline-none focus:border-zinc-500"
                >
                  <option value="">All companies</option>
                  {companies.map(c => (
                    <option key={c.id} value={c.id}>{c.name}</option>
                  ))}
                </select>
                <select
                  value={kwFilterStatus}
                  onChange={e => setKwFilterStatus(e.target.value)}
                  className="rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-1.5 text-xs text-zinc-300 focus:outline-none focus:border-zinc-500"
                >
                  <option value="">All statuses</option>
                  <option value="tracking">Tracking</option>
                  <option value="approved">Approved</option>
                  <option value="content_planned">Content planned</option>
                  <option value="published">Published</option>
                </select>
                <span className="text-xs text-zinc-600 ml-auto">{filteredKeywords.length} keywords</span>
              </div>

              {filteredKeywords.length === 0 ? (
                <p className="text-zinc-500 text-sm">No keywords yet. Click Research Keywords above to find opportunities.</p>
              ) : (
                <div className="rounded-xl border border-zinc-800 overflow-hidden">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-zinc-800 text-xs text-zinc-500">
                        <th className="text-left px-4 py-3 font-medium">Keyword</th>
                        <th className="text-left px-4 py-3 font-medium">Company</th>
                        <th className="text-right px-4 py-3 font-medium">Volume</th>
                        <th className="text-right px-4 py-3 font-medium">Difficulty</th>
                        <th className="text-right px-4 py-3 font-medium">Rank</th>
                        <th className="text-left px-4 py-3 font-medium">Status</th>
                        <th className="px-4 py-3" />
                      </tr>
                    </thead>
                    <tbody>
                      {filteredKeywords.map((kw, i) => {
                        const company = companies.find(c => c.id === kw.company_id)
                        const diff = kw.difficulty ?? 0
                        const diffColor = diff < 30 ? 'text-green-400' : diff < 60 ? 'text-yellow-400' : 'text-red-400'
                        return (
                          <tr key={kw.id} className={`border-b border-zinc-800/50 hover:bg-zinc-900/50 ${i % 2 === 0 ? '' : 'bg-zinc-900/20'}`}>
                            <td className="px-4 py-3 font-medium text-zinc-200">{kw.keyword}</td>
                            <td className="px-4 py-3 text-xs text-zinc-500">{company?.name ?? '—'}</td>
                            <td className="px-4 py-3 text-right text-zinc-300">
                              {kw.search_volume != null ? kw.search_volume.toLocaleString() : '—'}
                            </td>
                            <td className={`px-4 py-3 text-right font-medium ${diffColor}`}>
                              {kw.difficulty != null ? `${kw.difficulty}/100` : '—'}
                            </td>
                            <td className="px-4 py-3 text-right">
                              {kw.current_rank != null ? (
                                <span className={`font-medium ${kw.current_rank <= 10 ? 'text-green-400' : kw.current_rank <= 30 ? 'text-yellow-400' : 'text-zinc-400'}`}>
                                  #{kw.current_rank}
                                </span>
                              ) : (
                                <span className="text-zinc-700">—</span>
                              )}
                            </td>
                            <td className="px-4 py-3">
                              <span className={`text-xs px-2 py-0.5 rounded-full ${
                                kw.status === 'published' ? 'bg-green-900/40 text-green-400' :
                                kw.status === 'content_planned' ? 'bg-blue-900/40 text-blue-400' :
                                kw.status === 'approved' ? 'bg-emerald-900/40 text-emerald-400' :
                                'bg-zinc-800 text-zinc-500'
                              }`}>
                                {kw.status === 'approved' ? '✓ approved' : kw.status}
                              </span>
                            </td>
                            <td className="px-4 py-3 text-right">
                              <div className="flex items-center justify-end gap-1.5">
                                {(kw.status === 'tracking' || kw.status === 'approved') && (
                                  <button
                                    onClick={() => runAgent('writer', kw.company_id, { prompt: `write about "${kw.keyword}"` })}
                                    disabled={agentRunning === `writer:${kw.company_id}`}
                                    className="text-xs px-2 py-1 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-zinc-300 disabled:opacity-50 transition-colors"
                                  >
                                    {agentRunning === `writer:${kw.company_id}` ? 'Writing...' : 'Write Post'}
                                  </button>
                                )}
                                {kw.status === 'tracking' && (
                                  <button
                                    onClick={async () => {
                                      await fetch('/api/admin/keywords', { method: 'PATCH', headers: { ...headers, 'Content-Type': 'application/json' }, body: JSON.stringify({ id: kw.id, status: 'approved' }) })
                                      fetchData()
                                    }}
                                    className="text-xs px-2 py-1 rounded-lg bg-emerald-900/30 hover:bg-emerald-900/50 text-emerald-400 transition-colors"
                                  >
                                    Approve
                                  </button>
                                )}
                                {kw.status === 'approved' && (
                                  <button
                                    onClick={async () => {
                                      await fetch('/api/admin/keywords', { method: 'PATCH', headers: { ...headers, 'Content-Type': 'application/json' }, body: JSON.stringify({ id: kw.id, status: 'tracking' }) })
                                      fetchData()
                                    }}
                                    className="text-xs px-2 py-1 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-zinc-500 transition-colors"
                                  >
                                    Unapprove
                                  </button>
                                )}
                                {(kw.status === 'tracking' || kw.status === 'approved') && (
                                  <button
                                    onClick={async () => {
                                      await fetch(`/api/admin/keywords?id=${kw.id}`, { method: 'DELETE', headers })
                                      fetchData()
                                    }}
                                    className="text-xs px-2 py-1 rounded-lg border border-zinc-800 hover:border-red-900 text-zinc-600 hover:text-red-500 transition-colors"
                                  >
                                    ✕
                                  </button>
                                )}
                              </div>
                            </td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}

          {/* AGENTS TAB */}
          {tab === 'agents' && (
            <div className="grid gap-4">
              {/* Schedule status */}
              <div className="rounded-xl border border-zinc-800 p-5">
                <div className="flex items-center justify-between mb-4">
                  <div>
                    <h3 className="font-semibold">Content Schedule</h3>
                    <p className="text-sm text-zinc-400 mt-0.5">Auto-write posts based on each company's cadence</p>
                  </div>
                  <button
                    onClick={async () => {
                      setRunningSchedule(true)
                      setScheduleResult('')
                      const res = await fetch('/api/admin/schedule', {
                        method: 'POST',
                        headers: { ...headers, 'Content-Type': 'application/json' },
                      })
                      const data = await res.json()
                      setScheduleResult(data.message ?? data.error ?? 'Done')
                      setRunningSchedule(false)
                      fetchData()
                    }}
                    disabled={runningSchedule}
                    className="text-xs px-4 py-2 rounded-lg bg-white text-black font-semibold hover:bg-zinc-200 disabled:opacity-50 transition-colors"
                  >
                    {runningSchedule ? 'Running...' : 'Run Schedule'}
                  </button>
                </div>
                {scheduleResult && (
                  <p className="text-xs text-zinc-400 mb-3 bg-zinc-900 px-3 py-2 rounded-lg">{scheduleResult}</p>
                )}
                <div className="grid gap-2">
                  {schedule.map(s => (
                    <div key={s.company_id} className="flex items-center justify-between text-sm">
                      <span className="text-zinc-300">{s.company_name}</span>
                      <div className="flex items-center gap-3 text-xs">
                        {s.draft_count > 0 && (
                          <span className="text-zinc-500">{s.draft_count} draft{s.draft_count !== 1 ? 's' : ''}</span>
                        )}
                        <span className="text-zinc-500">{s.posts_per_week}x/week</span>
                        {s.is_due ? (
                          <span className="text-orange-400 font-medium">● Due now</span>
                        ) : (
                          <span className="text-zinc-600">Due in {s.days_until_due}d</span>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
              {[
                {
                  id: 'writer',
                  name: 'Blog Writer',
                  description: 'Picks the best untargeted keyword via DataForSEO, analyzes SERP intent, then writes a fully structured SEO post with schema markup using Claude Opus.',
                  action: 'Run for all companies',
                  available: true,
                },
                {
                  id: 'citation',
                  name: 'Citation Monitor',
                  description: 'Searches Google for brand mentions and AI citation signals across the web. Logs results per company to track brand visibility over time.',
                  action: 'Check all brands',
                  available: true,
                },
                {
                  id: 'refresh',
                  name: 'Content Refresh',
                  description: 'Scans for underperforming posts and queues them for rewriting to recover lost rankings.',
                  action: 'Scan all sites',
                  available: false,
                },
              ].map(agent => (
                <div key={agent.id} className="rounded-xl border border-zinc-800 p-5">
                  <div className="flex items-start justify-between gap-4">
                    <div>
                      <div className="flex items-center gap-2 mb-1">
                        <h3 className="font-semibold">{agent.name}</h3>
                        {!agent.available && (
                          <span className="text-xs px-2 py-0.5 rounded-full bg-zinc-800 text-zinc-500">coming soon</span>
                        )}
                      </div>
                      <p className="text-sm text-zinc-400">{agent.description}</p>
                      {agentResult[agent.id] && (
                        <p className="text-xs text-zinc-400 mt-2 bg-zinc-900 rounded-lg px-3 py-2">
                          {agentResult[agent.id]}
                        </p>
                      )}
                    </div>
                    <button
                      onClick={() => agent.available && runAgent(agent.id)}
                      disabled={agentRunning === agent.id || !agent.available}
                      className="shrink-0 text-xs px-4 py-2 rounded-lg bg-white text-black font-semibold hover:bg-zinc-200 disabled:opacity-50 transition-colors"
                    >
                      {agentRunning === agent.id ? 'Running...' : agent.action}
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* CITATIONS TAB */}
          {tab === 'citations' && (
            <div>
              {citations.length === 0 && (
                <p className="text-zinc-500 text-sm">No citation checks yet. Run the Citation Monitor agent.</p>
              )}
              <div className="grid gap-3">
                {citations.map(c => (
                  <div key={c.id} className="rounded-xl border border-zinc-800 p-4 flex items-start gap-4">
                    <div
                      className={`mt-0.5 w-2 h-2 rounded-full shrink-0 ${
                        c.cited ? 'bg-green-400' : 'bg-zinc-600'
                      }`}
                    />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap mb-1">
                        <span className="text-xs font-medium text-zinc-300">{c.companies?.name}</span>
                        <span className="text-xs px-1.5 py-0.5 rounded bg-zinc-800 text-zinc-500">
                          {c.source}
                        </span>
                        <span className={`text-xs font-medium ${c.cited ? 'text-green-400' : 'text-zinc-600'}`}>
                          {c.cited ? 'Cited' : 'Not cited'}
                        </span>
                      </div>
                      <p className="text-sm text-zinc-400 truncate">{c.query}</p>
                      {c.snippet && (
                        <p className="text-xs text-zinc-600 mt-1 line-clamp-2">{c.snippet}</p>
                      )}
                      <p className="text-xs text-zinc-700 mt-1">
                        {new Date(c.checked_at).toLocaleDateString()}
                      </p>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </>
      )}
    </div>
  )
}
