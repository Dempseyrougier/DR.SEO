'use client'

import { useState, useEffect, useCallback } from 'react'
import type { Company, Post, CitationLog } from '../../lib/types'
import PostEditor from './PostEditor'

type Tab = 'companies' | 'posts' | 'keywords' | 'agents' | 'citations'

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

export default function Dashboard({ adminKey }: { adminKey: string }) {
  const [tab, setTab] = useState<Tab>('companies')
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

  const headers = { 'x-admin-key': adminKey }

  const fetchData = useCallback(async () => {
    setLoading(true)
    const [companiesRes, postsRes, citationsRes] = await Promise.all([
      fetch('/api/admin/companies', { headers }),
      fetch('/api/admin/posts', { headers }),
      fetch('/api/admin/citations', { headers }),
    ])

    const [companiesData, postsData, citationsData, keywordsData] = await Promise.all([
      companiesRes.json(),
      postsRes.json(),
      citationsRes.json(),
      fetch('/api/admin/keywords', { headers }).then(r => r.json()),
    ])
    setCompanies(companiesData.companies ?? [])
    setPosts(postsData.posts ?? [])
    setCitations(citationsData.citations ?? [])
    setKeywords(keywordsData.keywords ?? [])
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

  async function toggleAutoPublish(companyId: string, current: boolean) {
    await fetch('/api/admin/companies', {
      method: 'PATCH',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: companyId, auto_publish: !current }),
    })
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

  const tabs: { id: Tab; label: string }[] = [
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
          onSave={() => { fetchData(); setEditingPost(null) }}
        />
      )}
      {/* Header */}
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">DR.SEO</h1>
          <p className="text-sm text-zinc-500 mt-0.5">AI-powered SEO platform</p>
        </div>
        <button
          onClick={fetchData}
          className="text-xs text-zinc-500 hover:text-zinc-300 px-3 py-1.5 rounded-lg border border-zinc-800 hover:border-zinc-700 transition-colors"
        >
          Refresh
        </button>
      </div>

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
          {/* COMPANIES TAB */}
          {tab === 'companies' && (
            <div className="grid gap-4">
              {companies.map(company => (
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
                      <span className="text-xs text-zinc-500">{company.posts_per_week}x/week</span>
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
              ))}
            </div>
          )}

          {/* POSTS TAB */}
          {tab === 'posts' && (
            <div className="grid gap-4">
              {posts.length === 0 && (
                <p className="text-zinc-500 text-sm">No posts yet. Run the writer agent on a company.</p>
              )}
              {posts.map(post => (
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
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* KEYWORDS TAB */}
          {tab === 'keywords' && (
            <div>
              {/* Research buttons per company */}
              <div className="flex gap-2 mb-6 flex-wrap">
                {companies.map(company => (
                  <div key={company.id} className="flex flex-col gap-1">
                    <button
                      onClick={() => researchKeywords(company.id)}
                      disabled={researchingKeywords === company.id}
                      className="text-xs px-3 py-1.5 rounded-lg bg-zinc-800 hover:bg-zinc-700 disabled:opacity-50 transition-colors"
                    >
                      {researchingKeywords === company.id ? 'Researching...' : `Research ${company.name}`}
                    </button>
                    {researchResult[company.id] && (
                      <span className="text-xs text-zinc-500">{researchResult[company.id]}</span>
                    )}
                  </div>
                ))}
              </div>

              {keywords.length === 0 ? (
                <p className="text-zinc-500 text-sm">No keywords yet. Click a Research button above to find opportunities.</p>
              ) : (
                <div className="rounded-xl border border-zinc-800 overflow-hidden">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-zinc-800 text-xs text-zinc-500">
                        <th className="text-left px-4 py-3 font-medium">Keyword</th>
                        <th className="text-left px-4 py-3 font-medium">Company</th>
                        <th className="text-right px-4 py-3 font-medium">Volume</th>
                        <th className="text-right px-4 py-3 font-medium">Difficulty</th>
                        <th className="text-left px-4 py-3 font-medium">Status</th>
                        <th className="px-4 py-3" />
                      </tr>
                    </thead>
                    <tbody>
                      {keywords.map((kw, i) => {
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
                            <td className="px-4 py-3">
                              <span className={`text-xs px-2 py-0.5 rounded-full ${
                                kw.status === 'published' ? 'bg-green-900/40 text-green-400' :
                                kw.status === 'content_planned' ? 'bg-blue-900/40 text-blue-400' :
                                'bg-zinc-800 text-zinc-500'
                              }`}>
                                {kw.status}
                              </span>
                            </td>
                            <td className="px-4 py-3 text-right">
                              {kw.status === 'tracking' && (
                                <button
                                  onClick={() => {
                                    setWriterPrompt(prev => ({ ...prev, [kw.company_id]: `write about "${kw.keyword}"` }))
                                    setTab('companies')
                                  }}
                                  className="text-xs px-2 py-1 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-zinc-300 transition-colors"
                                >
                                  Write Post
                                </button>
                              )}
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
              {[
                {
                  id: 'writer',
                  name: 'Blog Writer',
                  description: 'Generates SEO-optimized blog posts for each company using their voice guidelines and target keywords.',
                  action: 'Run for all companies',
                },
                {
                  id: 'citation',
                  name: 'Citation Monitor',
                  description: 'Checks ChatGPT, Perplexity, and Google AI to see if your brands are being cited in AI search responses.',
                  action: 'Check all brands',
                },
                {
                  id: 'refresh',
                  name: 'Content Refresh',
                  description: 'Scans for outdated or underperforming pages and queues them for rewriting.',
                  action: 'Scan all sites',
                },
              ].map(agent => (
                <div key={agent.id} className="rounded-xl border border-zinc-800 p-5">
                  <div className="flex items-start justify-between gap-4">
                    <div>
                      <h3 className="font-semibold mb-1">{agent.name}</h3>
                      <p className="text-sm text-zinc-400">{agent.description}</p>
                      {agentResult[agent.id] && (
                        <p className="text-xs text-zinc-400 mt-2 bg-zinc-900 rounded-lg px-3 py-2">
                          {agentResult[agent.id]}
                        </p>
                      )}
                    </div>
                    <button
                      onClick={() => runAgent(agent.id)}
                      disabled={agentRunning === agent.id}
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
