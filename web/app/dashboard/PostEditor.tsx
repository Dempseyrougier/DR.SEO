'use client'

import { useState } from 'react'
import type { Post } from '../../lib/types'

type UnsplashImage = {
  id: string
  thumb: string
  full: string
  credit: string
  creditUrl: string
}

function statusColors(status: string) {
  if (status === 'published') return 'bg-green-900/40 text-green-400'
  if (status === 'approved') return 'bg-blue-900/40 text-blue-400'
  if (status === 'failed') return 'bg-red-900/40 text-red-400'
  return 'bg-zinc-800 text-zinc-400'
}

export default function PostEditor({
  post,
  adminKey,
  onClose,
  onSave,
  onDelete,
}: {
  post: Post
  adminKey: string
  onClose: () => void
  onSave: () => void
  onDelete: () => void
}) {
  const [title, setTitle] = useState(post.title)
  const [meta, setMeta] = useState(post.meta_description ?? '')
  const [keyword, setKeyword] = useState(post.target_keyword ?? '')
  const [content, setContent] = useState(post.content)
  const [preview, setPreview] = useState(false)
  const [saving, setSaving] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [enhancing, setEnhancing] = useState<string | null>(null)
  const [images, setImages] = useState<UnsplashImage[]>([])
  const [message, setMessage] = useState('')
  const [messageType, setMessageType] = useState<'ok' | 'error'>('ok')

  const headers = { 'x-admin-key': adminKey, 'Content-Type': 'application/json' }

  const isDirty =
    title !== post.title ||
    meta !== (post.meta_description ?? '') ||
    keyword !== (post.target_keyword ?? '') ||
    content !== post.content

  function notify(msg: string, type: 'ok' | 'error' = 'ok') {
    setMessage(msg)
    setMessageType(type)
  }

  function handleClose() {
    if (isDirty && !window.confirm('You have unsaved changes. Discard them?')) return
    onClose()
  }

  async function save() {
    setSaving(true)
    const res = await fetch('/api/admin/posts', {
      method: 'PATCH',
      headers,
      body: JSON.stringify({
        id: post.id,
        title,
        meta_description: meta,
        target_keyword: keyword,
        content,
      }),
    })
    setSaving(false)
    if (res.ok) {
      notify('Saved.')
      onSave()
    } else {
      notify('Save failed.', 'error')
    }
  }

  async function deletePost() {
    if (!window.confirm('Delete this post? This cannot be undone.')) return
    setDeleting(true)
    const res = await fetch(`/api/admin/posts?id=${post.id}`, {
      method: 'DELETE',
      headers: { 'x-admin-key': adminKey },
    })
    setDeleting(false)
    if (res.ok) {
      onDelete()
    } else {
      notify('Delete failed.', 'error')
    }
  }

  async function enhance(action: 'expand' | 'add-links' | 'add-images') {
    setEnhancing(action)
    setMessage('')
    setImages([])
    const res = await fetch('/api/admin/posts/enhance', {
      method: 'POST',
      headers,
      body: JSON.stringify({
        action,
        post_id: post.id,
        company_id: post.company_id,
        content,
        title,
        keyword,
      }),
    })
    const data = await res.json()
    if (!res.ok) {
      notify(data.error ?? 'Something went wrong.', 'error')
    } else if (action === 'expand' && data.content) {
      setContent(data.content)
      notify('Article expanded to ' + data.wordCount + ' words.')
    } else if (action === 'add-links' && data.content) {
      setContent(data.content)
      notify(`Links added: ${data.internalCount} internal, ${data.externalCount} external.`)
    } else if (action === 'add-images' && data.images) {
      setImages(data.images)
      notify('Select an image to insert at the top of the post.')
    }
    setEnhancing(null)
  }

  function insertImage(img: UnsplashImage) {
    const credit = `Photo by <a href="${img.creditUrl}?utm_source=dr_seo&utm_medium=referral" target="_blank" rel="noopener">${img.credit}</a> on <a href="https://unsplash.com?utm_source=dr_seo&utm_medium=referral" target="_blank" rel="noopener">Unsplash</a>`
    const block = `<figure style="margin:0 0 32px 0;">\n  <img src="${img.full}" alt="${keyword}" style="width:100%;border-radius:8px;" />\n  <figcaption style="font-size:12px;color:#888;margin-top:8px;">${credit}</figcaption>\n</figure>\n\n`
    setContent(block + content)
    setImages([])
    notify('Image inserted at the top.')
  }

  const wordCount = content.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().split(' ').length

  return (
    <div className="fixed inset-0 bg-zinc-950 z-50 overflow-y-auto">
      <div className="max-w-4xl mx-auto px-6 py-8">

        {/* Top bar */}
        <div className="flex items-center justify-between mb-6 sticky top-0 bg-zinc-950 py-3 -mx-6 px-6 border-b border-zinc-800 z-10">
          <div className="flex items-center gap-3">
            <button
              onClick={handleClose}
              className="text-zinc-500 hover:text-zinc-200 text-sm transition-colors"
            >
              ← Back
            </button>
            <span className="text-zinc-700">|</span>
            <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${statusColors(post.status)}`}>
              {post.status}
            </span>
            <span className="text-xs text-zinc-600">{wordCount.toLocaleString()} words</span>
            {isDirty && (
              <span className="text-xs text-amber-500">● unsaved</span>
            )}
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={deletePost}
              disabled={deleting}
              className="text-xs px-3 py-1.5 rounded-lg border border-red-900 hover:border-red-700 text-red-500 hover:text-red-400 disabled:opacity-50 transition-colors"
            >
              {deleting ? 'Deleting...' : 'Delete'}
            </button>
            <button
              onClick={() => { setPreview(!preview); setImages([]) }}
              className="text-xs px-3 py-1.5 rounded-lg border border-zinc-700 hover:border-zinc-500 text-zinc-400 hover:text-zinc-200 transition-colors"
            >
              {preview ? 'Edit HTML' : 'Preview'}
            </button>
            <button
              onClick={save}
              disabled={saving || !isDirty}
              className="text-xs px-4 py-1.5 rounded-lg bg-white text-black font-semibold hover:bg-zinc-200 disabled:opacity-50 transition-colors"
            >
              {saving ? 'Saving...' : 'Save'}
            </button>
          </div>
        </div>

        {/* Meta fields */}
        <div className="grid gap-3 mb-5">
          <input
            value={title}
            onChange={e => setTitle(e.target.value)}
            placeholder="Post title"
            className="w-full rounded-lg border border-zinc-700 bg-zinc-900 px-4 py-2.5 text-sm text-zinc-100 placeholder:text-zinc-600 focus:outline-none focus:border-zinc-500"
          />
          <div className="grid grid-cols-2 gap-3">
            <input
              value={keyword}
              onChange={e => setKeyword(e.target.value)}
              placeholder="Primary keyword"
              className="rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 text-xs text-zinc-200 placeholder:text-zinc-600 focus:outline-none focus:border-zinc-500"
            />
            <input
              value={meta}
              onChange={e => setMeta(e.target.value)}
              placeholder="Meta description (150–160 chars)"
              className="rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 text-xs text-zinc-200 placeholder:text-zinc-600 focus:outline-none focus:border-zinc-500"
            />
          </div>
          {meta.length > 0 && (
            <p className={`text-xs ${meta.length > 160 ? 'text-red-400' : meta.length > 140 ? 'text-green-400' : 'text-zinc-600'}`}>
              Meta: {meta.length}/160 chars
            </p>
          )}
        </div>

        {/* AI action bar */}
        <div className="flex gap-2 mb-4 flex-wrap">
          <button
            onClick={() => enhance('expand')}
            disabled={!!enhancing}
            className="text-xs px-3 py-1.5 rounded-lg bg-zinc-800 hover:bg-zinc-700 disabled:opacity-50 transition-colors flex items-center gap-1.5"
          >
            {enhancing === 'expand' ? (
              <><span className="animate-pulse">●</span> Expanding...</>
            ) : (
              '↕ Expand Article'
            )}
          </button>
          <button
            onClick={() => enhance('add-links')}
            disabled={!!enhancing}
            className="text-xs px-3 py-1.5 rounded-lg bg-zinc-800 hover:bg-zinc-700 disabled:opacity-50 transition-colors flex items-center gap-1.5"
          >
            {enhancing === 'add-links' ? (
              <><span className="animate-pulse">●</span> Linking...</>
            ) : (
              '🔗 Auto-Link'
            )}
          </button>
          <button
            onClick={() => enhance('add-images')}
            disabled={!!enhancing}
            className="text-xs px-3 py-1.5 rounded-lg bg-zinc-800 hover:bg-zinc-700 disabled:opacity-50 transition-colors flex items-center gap-1.5"
          >
            {enhancing === 'add-images' ? (
              <><span className="animate-pulse">●</span> Searching...</>
            ) : (
              '🖼 Find Images'
            )}
          </button>
        </div>

        {/* Status message */}
        {message && (
          <p className={`text-xs mb-4 px-3 py-2 rounded-lg ${messageType === 'error' ? 'bg-red-900/30 text-red-400' : 'bg-zinc-900 text-zinc-400'}`}>
            {message}
          </p>
        )}

        {/* Image picker */}
        {images.length > 0 && (
          <div className="grid grid-cols-3 gap-3 mb-5">
            {images.map(img => (
              <button
                key={img.id}
                onClick={() => insertImage(img)}
                className="group text-left rounded-lg overflow-hidden border border-zinc-800 hover:border-zinc-600 transition-colors"
              >
                <img
                  src={img.thumb}
                  alt={img.credit}
                  className="w-full h-28 object-cover group-hover:opacity-90 transition-opacity"
                />
                <p className="text-xs text-zinc-500 px-2 py-1.5 truncate">{img.credit}</p>
              </button>
            ))}
          </div>
        )}

        {/* Content area */}
        {preview ? (
          <div
            className="rounded-xl border border-zinc-800 p-6 text-sm text-zinc-200 leading-relaxed
              [&_h2]:text-xl [&_h2]:font-semibold [&_h2]:mt-8 [&_h2]:mb-3 [&_h2]:text-white
              [&_h3]:text-base [&_h3]:font-semibold [&_h3]:mt-5 [&_h3]:mb-2 [&_h3]:text-zinc-100
              [&_p]:mb-4 [&_p]:text-zinc-300
              [&_ul]:mb-4 [&_ul]:pl-5 [&_ul]:list-disc [&_ul]:text-zinc-300
              [&_ol]:mb-4 [&_ol]:pl-5 [&_ol]:list-decimal [&_ol]:text-zinc-300
              [&_li]:mb-1.5
              [&_strong]:text-white [&_strong]:font-semibold
              [&_a]:text-blue-400 [&_a]:underline
              [&_img]:rounded-lg [&_img]:my-4
              [&_figure]:my-6
              [&_figcaption]:text-xs [&_figcaption]:text-zinc-500 [&_figcaption]:mt-2"
            dangerouslySetInnerHTML={{ __html: content }}
          />
        ) : (
          <textarea
            value={content}
            onChange={e => setContent(e.target.value)}
            rows={40}
            spellCheck={false}
            className="w-full rounded-xl border border-zinc-700 bg-zinc-900 px-4 py-3 text-xs text-zinc-300 font-mono leading-relaxed focus:outline-none focus:border-zinc-500 resize-y"
          />
        )}

        {/* Bottom save */}
        <div className="flex justify-between mt-4 gap-2">
          <button
            onClick={deletePost}
            disabled={deleting}
            className="text-xs px-4 py-2 rounded-lg border border-red-900 hover:border-red-700 text-red-500 hover:text-red-400 disabled:opacity-50 transition-colors"
          >
            {deleting ? 'Deleting...' : 'Delete Post'}
          </button>
          <div className="flex gap-2">
            <button
              onClick={handleClose}
              className="text-xs px-4 py-2 rounded-lg border border-zinc-700 text-zinc-400 hover:text-zinc-200 transition-colors"
            >
              Close
            </button>
            <button
              onClick={save}
              disabled={saving || !isDirty}
              className="text-xs px-6 py-2 rounded-lg bg-white text-black font-semibold hover:bg-zinc-200 disabled:opacity-50 transition-colors"
            >
              {saving ? 'Saving...' : 'Save Changes'}
            </button>
          </div>
        </div>

      </div>
    </div>
  )
}
