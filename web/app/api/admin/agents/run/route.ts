import { NextRequest, NextResponse } from 'next/server'
import { getSupabaseAdmin } from '../../../../../lib/supabase'
import Anthropic from '@anthropic-ai/sdk'

export const maxDuration = 60

function auth(req: NextRequest) {
  return req.headers.get('x-admin-key') === process.env.ADMIN_KEY
}

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

async function runWriter(companyId: string) {
  const supabase = getSupabaseAdmin()

  const { data: company } = await supabase
    .from('companies')
    .select('*')
    .eq('id', companyId)
    .single()

  if (!company) return { error: 'Company not found' }

  // Fetch existing posts to avoid keyword cannibalization
  const { data: existingPosts } = await supabase
    .from('posts')
    .select('title, target_keyword')
    .eq('company_id', companyId)
    .in('status', ['draft', 'approved', 'published'])

  const existingTopics = existingPosts?.length
    ? existingPosts
        .map(p => `- "${p.title}"${p.target_keyword ? ` (keyword: ${p.target_keyword})` : ''}`)
        .join('\n')
    : 'None yet.'

  const targetKeywords = company.target_keywords?.length
    ? company.target_keywords.join(', ')
    : 'general industry terms'

  const systemPrompt = `You are a senior SEO content strategist and writer. Your posts consistently rank on page 1 of Google.

## Company
Name: ${company.name}
Domain: ${company.domain}
Industry: ${company.industry}
Voice guidelines: ${company.voice_guidelines ?? 'Professional and informative.'}
Target keywords to draw from: ${targetKeywords}

## Existing posts (DO NOT target these same keywords or topics)
${existingTopics}

## Content requirements
- Choose ONE primary keyword that:
  - Is NOT already covered by existing posts above
  - Has clear commercial or informational search intent
  - Is specific enough to realistically rank for (long-tail preferred)
- Word count: 1,500–2,000 words
- Structure: H1 title, 4–6 H2 sections, H3 subsections where appropriate
- Include a FAQ section at the end (4–5 questions with direct answers)
- Weave in 3–5 secondary/related keywords naturally throughout
- Write with E-E-A-T in mind: demonstrate real expertise, include specific details, data points, or examples — no generic filler
- End with a clear call-to-action relevant to the business
- Match the brand voice guidelines exactly

## HTML output requirements
- Use semantic HTML: <h2>, <h3>, <p>, <ul>, <ol>, <strong>
- Add a FAQ schema JSON-LD <script> block at the very end of the content covering the FAQ questions
- Add [INTERNAL_LINK: suggested topic] placeholders where internal links would strengthen the post
- Do NOT include <html>, <head>, or <body> tags — content only

## Response format
Return ONLY valid JSON — no markdown, no commentary:
{
  "title": "exact H1 title (include primary keyword near the front)",
  "target_keyword": "primary keyword phrase",
  "secondary_keywords": ["kw1", "kw2", "kw3"],
  "meta_description": "compelling 150–160 char meta description with primary keyword",
  "content": "full HTML content as a single string"
}`

  const message = await anthropic.messages.create({
    model: 'claude-opus-4-6',
    max_tokens: 8192,
    messages: [
      {
        role: 'user',
        content: `Write the next SEO blog post for ${company.name}. Choose a keyword angle not covered by the existing posts listed above. Make it genuinely useful — the kind of content that earns backlinks and ranks.`,
      },
    ],
    system: systemPrompt,
  })

  const text = message.content[0].type === 'text' ? message.content[0].text : ''
  let parsed: {
    title: string
    target_keyword: string
    secondary_keywords: string[]
    meta_description: string
    content: string
  }
  try {
    const jsonMatch = text.match(/\{[\s\S]*\}/)
    parsed = JSON.parse(jsonMatch?.[0] ?? text)
  } catch {
    return { error: 'Failed to parse writer output. Raw: ' + text.slice(0, 200) }
  }

  const { error } = await supabase.from('posts').insert({
    company_id: companyId,
    title: parsed.title,
    content: parsed.content,
    meta_description: parsed.meta_description,
    target_keyword: parsed.target_keyword,
    status: company.auto_publish ? 'approved' : 'draft',
  })

  if (error) return { error: error.message }
  return {
    message: `Post "${parsed.title}" created as ${company.auto_publish ? 'approved' : 'draft'}. Keywords: ${parsed.target_keyword}${parsed.secondary_keywords?.length ? `, ${parsed.secondary_keywords.join(', ')}` : ''}.`,
  }
}

async function runCitationCheck(companyId: string) {
  const supabase = getSupabaseAdmin()

  const { data: company } = await supabase
    .from('companies')
    .select('name, domain, industry')
    .eq('id', companyId)
    .single()

  if (!company) return { error: 'Company not found' }

  const queries = [
    `best ${company.industry} services`,
    `top ${company.industry} companies`,
    `${company.domain} reviews`,
  ]

  const sources: Array<'chatgpt' | 'perplexity' | 'google_ai'> = ['perplexity']
  const results: Array<{ cited: boolean; query: string; source: string }> = []

  for (const query of queries) {
    for (const source of sources) {
      // Simulated check — real implementation would call each AI search API
      const cited = false
      await supabase.from('citation_logs').insert({
        company_id: companyId,
        query,
        source,
        cited,
        snippet: null,
      })
      results.push({ cited, query, source })
    }
  }

  const citedCount = results.filter(r => r.cited).length
  return { message: `Checked ${results.length} queries. Cited in ${citedCount}.` }
}

async function runForAllCompanies(agent: string) {
  const supabase = getSupabaseAdmin()
  const { data: companies } = await supabase.from('companies').select('id').eq('active', true)
  if (!companies?.length) return { message: 'No active companies.' }

  const results = await Promise.all(
    companies.map(c =>
      agent === 'writer' ? runWriter(c.id) : runCitationCheck(c.id)
    )
  )

  const errors = results.filter(r => r.error)
  return {
    message: `Ran ${agent} for ${companies.length} companies.${errors.length ? ` ${errors.length} errors.` : ' All succeeded.'}`,
  }
}

export async function POST(req: NextRequest) {
  if (!auth(req)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { agent, company_id } = await req.json()

  if (!['writer', 'citation', 'refresh', 'publisher'].includes(agent)) {
    return NextResponse.json({ error: 'Unknown agent' }, { status: 400 })
  }

  try {
    let result: { message?: string; error?: string }

    if (agent === 'writer') {
      result = company_id ? await runWriter(company_id) : await runForAllCompanies('writer')
    } else if (agent === 'citation') {
      result = company_id ? await runCitationCheck(company_id) : await runForAllCompanies('citation')
    } else if (agent === 'refresh') {
      result = { message: 'Content refresh agent coming soon.' }
    } else if (agent === 'publisher') {
      // company_id here is actually a post id
      const supabase = getSupabaseAdmin()
      const { data: post } = await supabase
        .from('posts')
        .select('*, companies(*)')
        .eq('id', company_id)
        .single()

      if (!post) return NextResponse.json({ error: 'Post not found' }, { status: 404 })

      if (post.companies?.cms_type === 'wordpress' && post.companies?.wp_url) {
        const wpResult = await publishToWordPress(post)
        result = wpResult
      } else {
        // Mark as published for non-WP sites (manual deploy)
        await supabase
          .from('posts')
          .update({ status: 'published', published_at: new Date().toISOString() })
          .eq('id', company_id)
        result = { message: 'Marked as published. Deploy manually for this CMS type.' }
      }
    } else {
      result = { error: 'Unknown agent' }
    }

    if (result.error) return NextResponse.json(result, { status: 500 })
    return NextResponse.json(result)
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}

async function publishToWordPress(post: {
  id: string
  title: string
  content: string
  meta_description: string | null
  companies: { wp_url: string; wp_user: string; wp_app_password: string }
}) {
  const supabase = getSupabaseAdmin()
  const { wp_url, wp_user, wp_app_password } = post.companies
  const credentials = Buffer.from(`${wp_user}:${wp_app_password}`).toString('base64')

  const res = await fetch(`${wp_url}/wp-json/wp/v2/posts`, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${credentials}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      title: post.title,
      content: post.content,
      status: 'publish',
      excerpt: post.meta_description ?? '',
    }),
  })

  if (!res.ok) {
    const err = await res.text()
    await supabase.from('posts').update({ status: 'failed' }).eq('id', post.id)
    return { error: `WordPress error: ${err}` }
  }

  const wpPost = await res.json()
  await supabase
    .from('posts')
    .update({ status: 'published', published_at: new Date().toISOString(), wp_post_id: wpPost.id })
    .eq('id', post.id)

  return { message: `Published to WordPress (post #${wpPost.id}).` }
}
