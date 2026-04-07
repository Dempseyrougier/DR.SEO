import { NextRequest, NextResponse } from 'next/server'
import { getSupabaseAdmin } from '../../../../../lib/supabase'
import Anthropic from '@anthropic-ai/sdk'

export const maxDuration = 60

function auth(req: NextRequest) {
  return req.headers.get('x-admin-key') === process.env.ADMIN_KEY
}

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

function countWords(html: string) {
  return html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().split(' ').length
}

// ── Expand ──────────────────────────────────────────────────────────────────

async function expandArticle(content: string, title: string, keyword: string) {
  const currentWords = countWords(content)

  const message = await anthropic.messages.create({
    model: 'claude-opus-4-6',
    max_tokens: 8192,
    system: `You are a senior SEO content writer. You will receive an existing blog post in HTML and must expand it to at least 2,500 words total.

Rules:
- Keep all existing content — only ADD to it, never remove or rewrite sections
- Add 2–4 new H2 sections with substantive content (real insights, examples, data points)
- Deepen existing sections with additional paragraphs where content is thin
- Expand the FAQ section with 2–3 more questions
- Maintain the exact same voice, tone, and HTML structure
- Return ONLY the complete expanded HTML — no JSON wrapper, no markdown, no commentary`,
    messages: [
      {
        role: 'user',
        content: `Expand this blog post titled "${title}" (primary keyword: "${keyword}") from ~${currentWords} words to at least 2,500 words. Return the full expanded HTML:\n\n${content}`,
      },
    ],
  })

  const expanded = message.content[0].type === 'text' ? message.content[0].text : ''
  return { content: expanded, wordCount: countWords(expanded) }
}

// ── Auto-Link ────────────────────────────────────────────────────────────────

async function addLinks(
  content: string,
  title: string,
  keyword: string,
  companyId: string
) {
  const supabase = getSupabaseAdmin()

  const { data: company } = await supabase
    .from('companies')
    .select('name, domain, cms_type')
    .eq('id', companyId)
    .single()

  const { data: otherPosts } = await supabase
    .from('posts')
    .select('title, target_keyword, wp_post_id, status')
    .eq('company_id', companyId)
    .in('status', ['published', 'approved'])
    .neq('title', title)
    .limit(20)

  // For published WP posts, fetch real permalinks via WP REST API
  const { data: companyFull } = await supabase
    .from('companies')
    .select('wp_url, wp_user, wp_app_password, cms_type')
    .eq('id', companyId)
    .single()

  const wpPermalinks: Record<number, string> = {}
  if (companyFull?.cms_type === 'wordpress' && companyFull.wp_url && companyFull.wp_user) {
    const credentials = Buffer.from(`${companyFull.wp_user}:${companyFull.wp_app_password}`).toString('base64')
    const publishedIds = otherPosts?.filter(p => p.wp_post_id).map(p => p.wp_post_id) ?? []
    if (publishedIds.length > 0) {
      try {
        const wpRes = await fetch(
          `${companyFull.wp_url}/wp-json/wp/v2/posts?include=${publishedIds.join(',')}&_fields=id,link`,
          { headers: { Authorization: `Basic ${credentials}` }, signal: AbortSignal.timeout(5000) }
        )
        if (wpRes.ok) {
          const wpPosts: Array<{ id: number; link: string }> = await wpRes.json()
          wpPosts.forEach(p => { wpPermalinks[p.id] = p.link })
        }
      } catch { /* proceed with derived slugs */ }
    }
  }

  const internalList = otherPosts?.length
    ? otherPosts
        .map(p => {
          let url: string
          if (p.wp_post_id && wpPermalinks[p.wp_post_id]) {
            url = wpPermalinks[p.wp_post_id]
          } else {
            // Derive slug same way WordPress does
            const slug = p.title
              .toLowerCase()
              .replace(/[^a-z0-9\s-]/g, '')
              .trim()
              .split(/\s+/)
              .slice(0, 6)
              .join('-')
            url = `https://${company?.domain}/${slug}/`
          }
          return `- "${p.title}" → ${url}`
        })
        .join('\n')
    : 'No other posts yet.'

  const message = await anthropic.messages.create({
    model: 'claude-opus-4-6',
    max_tokens: 8192,
    system: `You are an SEO specialist. You will receive a blog post in HTML and must add internal and external links to strengthen it.

Instructions:
1. INTERNAL LINKS: Replace any [INTERNAL_LINK: topic] placeholders with actual <a> tags using the URLs from the list provided. Also identify 2–3 natural places in the text where an internal link makes sense and add them.
2. EXTERNAL LINKS: Add 2–3 external links to high-authority, relevant sources (Wikipedia, industry publications, government sites, well-known brands). Use target="_blank" rel="noopener noreferrer".
3. Never link the same URL twice.
4. Links should feel natural — anchor text should match the surrounding sentence, not be forced.
5. Return ONLY the updated HTML — no JSON, no markdown, no commentary.
6. Return two counts at the very end as HTML comments: <!-- internal:N --> <!-- external:N -->`,
    messages: [
      {
        role: 'user',
        content: `Blog post: "${title}" (keyword: "${keyword}")

Other posts on ${company?.domain} you can link to internally:
${internalList}

Add internal and external links to this HTML:

${content}`,
      },
    ],
  })

  let updated = message.content[0].type === 'text' ? message.content[0].text : content

  // Parse counts from HTML comments
  const internalMatch = updated.match(/<!--\s*internal:(\d+)\s*-->/)
  const externalMatch = updated.match(/<!--\s*external:(\d+)\s*-->/)
  const internalCount = internalMatch ? parseInt(internalMatch[1]) : 0
  const externalCount = externalMatch ? parseInt(externalMatch[1]) : 0

  // Remove the comment markers from the content
  updated = updated.replace(/<!--\s*(internal|external):\d+\s*-->/g, '')

  return { content: updated, internalCount, externalCount }
}

// ── Images ───────────────────────────────────────────────────────────────────

async function findImages(keyword: string) {
  const accessKey = process.env.UNSPLASH_ACCESS_KEY
  if (!accessKey) {
    return { error: 'Add UNSPLASH_ACCESS_KEY to your environment variables. Get a free key at unsplash.com/developers.' }
  }

  const query = encodeURIComponent(keyword)
  const res = await fetch(
    `https://api.unsplash.com/search/photos?query=${query}&per_page=6&orientation=landscape`,
    { headers: { Authorization: `Client-ID ${accessKey}` } }
  )

  if (!res.ok) return { error: 'Unsplash API error: ' + res.status }

  const data = await res.json()
  const images = data.results.map((img: {
    id: string
    urls: { regular: string; thumb: string }
    user: { name: string; links: { html: string } }
  }) => ({
    id: img.id,
    thumb: img.urls.thumb,
    full: img.urls.regular,
    credit: img.user.name,
    creditUrl: img.user.links.html,
  }))

  return { images }
}

// ── Handler ──────────────────────────────────────────────────────────────────

export async function POST(req: NextRequest) {
  if (!auth(req)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { action, content, title, keyword, company_id } = await req.json()

  try {
    if (action === 'expand') {
      const result = await expandArticle(content, title, keyword)
      return NextResponse.json(result)
    }

    if (action === 'add-links') {
      const result = await addLinks(content, title, keyword, company_id)
      return NextResponse.json(result)
    }

    if (action === 'add-images') {
      const result = await findImages(keyword)
      if (result.error) return NextResponse.json(result, { status: 400 })
      return NextResponse.json(result)
    }

    return NextResponse.json({ error: 'Unknown action' }, { status: 400 })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
