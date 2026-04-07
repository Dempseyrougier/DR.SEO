'use client'

import { useState } from 'react'
import Dashboard from './dashboard/Dashboard'

export default function Home() {
  const [key, setKey] = useState('')
  const [input, setInput] = useState('')
  const [error, setError] = useState('')

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (input === process.env.NEXT_PUBLIC_ADMIN_KEY) {
      setKey(input)
    } else {
      // Validate via API so we don't expose the key client-side
      fetch('/api/admin/auth', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ key: input }),
      }).then(r => {
        if (r.ok) setKey(input)
        else setError('Invalid key')
      })
    }
  }

  if (!key) {
    return (
      <div className="min-h-screen flex items-center justify-center px-6">
        <form onSubmit={handleSubmit} className="flex flex-col gap-4 w-full max-w-xs">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">DR.SEO</h1>
            <p className="text-sm text-zinc-500 mt-1">AI-powered SEO platform</p>
          </div>
          <input
            type="password"
            value={input}
            onChange={e => { setInput(e.target.value); setError('') }}
            placeholder="Admin key"
            autoFocus
            className="rounded-xl border border-zinc-800 bg-zinc-900 px-4 py-3 text-sm text-zinc-100 placeholder:text-zinc-600 focus:outline-none focus:border-zinc-600"
          />
          {error && <p className="text-xs text-red-400">{error}</p>}
          <button
            type="submit"
            disabled={!input}
            className="rounded-xl bg-white text-black py-3 text-sm font-semibold disabled:opacity-40 hover:bg-zinc-200 transition-colors"
          >
            Enter
          </button>
        </form>
      </div>
    )
  }

  return <Dashboard adminKey={key} />
}
