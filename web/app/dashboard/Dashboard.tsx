'use client'

import { useState, useEffect, useCallback } from 'react'
import type { Company, Post, CitationLog } from '../../lib/types'

type Tab = 'companies' | 'posts' | 'agents' | 'citations'

export default function Dashboard({ adminKey }: { adminKey: string }) {
  const [tab, setTab] = useState<Tab>('companies')
  const [companies, setCompanies] = useState<Company[]>([])
  const [posts, setPosts] = useState<Post[]>([])
  const [citations, setCitations] = useState<CitationLog[]>([])
  const [loading, setLoading] = useState(true)
  const [agentRunning, setAgentRunning] = useState<string | null>(null)
  const [agentResult, setAgentResult] = useState<Record<string, string>>({})

  const headers = { 'x-admin-key': adminKey }

  const fetchData = useCallback(async () => {
    setLoading(true)
    const [companiesRes, postsRes, citationsRes] = await Promise.all([
      fetch('/api/admin/companies', { headers }),
      fetch('/api/admin/posts', { headers }),
      fetch('/api/admin/citations', { headers }),
    ])
    const [companiesData, postsData, citationsData] = await Promise.all([
      companiesRes.json(),
      postsRes.json(),
      citationsRes.json(),
    ])
    setCompanies(companiesData.companies ?? [])
    setPosts(postsData.posts ?? [])
    setCitations(citationsData.citations ?? [])
    setLoading(false)
  }, [adminKey])

  useEffect(() => { fetchData() }, [fetchData])

  async function runAgent(agent: string, companyId?: string) {
    const key = companyId ? `${agent}:${companyId}` : agent
    setAgentRunning(key)
    setAgentResult(prev => ({ ...prev, [key]: '' }))
    const res = await fetch('/api/admin/agents/run', {
      method: 'POST',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({ agent, company_id: companyId }),
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

  const tabs: { id: Tab; label: string }[] = [
    { id: 'companies', label: 'Companies' },
    { id: 'posts', label: `Posts${posts.length ? ` (${posts.length})` : ''}` },
    { id: 'agents', label: 'Agents' },
    { id: 'citations', label: 'Citations' },
  ]

  return (
    <div className="min-h-screen p-6 max-w-6xl mx-auto">
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
                  <div className="flex gap-2 mt-4">
                    <button
                      onClick={() => runAgent('writer', company.id)}
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
