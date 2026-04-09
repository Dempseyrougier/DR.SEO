import { NextRequest, NextResponse } from 'next/server'
import { getSupabaseAdmin } from '../../../../../lib/supabase'
import Anthropic from '@anthropic-ai/sdk'
import { getKeywordIdeas, getSearchVolumes, selectBestKeyword, analyzeSerpIntent, classifyIntent, type SerpIntent } from '../../../../../lib/dataforseo'

export const maxDuration = 60
export const preferredRegion = ['iad1']

function auth(req: NextRequest) {
  return req.headers.get('x-admin-key') === process.env.ADMIN_KEY
}

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

async function runWriter(companyId: string, customPrompt?: string, referenceUrl?: string) {
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

  const existingKeywords = existingPosts?.map(p => p.target_keyword).filter(Boolean) as string[] ?? []
  const targetKeywords = company.target_keywords?.length
    ? company.target_keywords.join(', ')
    : 'general industry terms'

  const locationCode: number = (company as { location_code?: number }).location_code ?? 2840
  const moneyPageUrl: string | null = (company as { money_page_url?: string | null }).money_page_url ?? null

  // ── Step 1: Keyword research via DataForSEO ────────────────────────────────
  let selectedKeyword: { keyword: string; searchVolume: number; difficulty: number } | null = null
  let serpIntent: SerpIntent | null = null
  let keywordContext = ''

  // Pre-check: if no custom prompt, prefer approved keywords from the DB first
  let preselectedFromDb: string | null = null
  if (!customPrompt) {
    const { data: approvedKws } = await supabase
      .from('keywords')
      .select('keyword, search_volume, difficulty')
      .eq('company_id', companyId)
      .eq('focus', true)
      .not('keyword', 'in', `(${existingKeywords.map(k => `"${k}"`).join(',') || '""'})`)
      .order('search_volume', { ascending: false })
      .limit(1)

    if (approvedKws?.[0]) {
      preselectedFromDb = approvedKws[0].keyword
      selectedKeyword = {
        keyword: approvedKws[0].keyword,
        searchVolume: approvedKws[0].search_volume ?? 0,
        difficulty: approvedKws[0].difficulty ?? 0,
      }
    }
  }

  try {
    if (preselectedFromDb) {
      // Keyword already chosen from DB — skip all research calls entirely
      const intent = classifyIntent(preselectedFromDb)
      keywordContext = `\n## Keyword selected from approved list\nPrimary keyword: "${preselectedFromDb}"\nSearch intent: ${intent}`
    } else {
      // No pre-selected keyword — run full research pipeline
      let seedKeywords: string[] = []

      if (customPrompt) {
        const seedRes = await anthropic.messages.create({
          model: 'claude-haiku-4-5-20251001',
          max_tokens: 256,
          messages: [{
            role: 'user',
            content: `Given this blog topic request: "${customPrompt}"
And this industry: ${company.industry}
Generate 6 specific long-tail keyword phrases someone would search for related to this topic.
Return ONLY a JSON array of strings: ["keyword 1", "keyword 2", ...]`,
          }],
        })
        const seedText = seedRes.content[0].type === 'text' ? seedRes.content[0].text : '[]'
        seedKeywords = JSON.parse(seedText.match(/\[[\s\S]*\]/)?.[0] ?? '[]')
      } else {
        const seedRes = await anthropic.messages.create({
          model: 'claude-haiku-4-5-20251001',
          max_tokens: 256,
          messages: [{
            role: 'user',
            content: `Company: ${company.name}
Industry: ${company.industry}
Existing keywords covered: ${existingKeywords.join(', ') || 'none'}
Target keyword areas: ${targetKeywords}

Generate 8 specific long-tail keyword phrases this company could rank for that are NOT in the existing list.
Focus on commercial and informational intent. Be specific, not generic.
Return ONLY a JSON array of strings: ["keyword 1", "keyword 2", ...]`,
          }],
        })
        const seedText = seedRes.content[0].type === 'text' ? seedRes.content[0].text : '[]'
        seedKeywords = JSON.parse(seedText.match(/\[[\s\S]*\]/)?.[0] ?? '[]')
      }

      if (seedKeywords.length > 0) {
      // Get keyword ideas + difficulty from DataForSEO Labs
      const ideas = await getKeywordIdeas(seedKeywords.slice(0, 4), locationCode)

      // Also get volume for the seeds themselves
      const volumes = await getSearchVolumes(seedKeywords, locationCode)
      const seedsWithData = volumes.map(v => ({
        keyword: v.keyword,
        searchVolume: v.searchVolume,
        difficulty: ideas.find(i => i.keyword === v.keyword)?.difficulty ?? 0,
        cpc: v.cpc,
      }))

      // Merge ideas + seeds, pick best
      const allCandidates = [...ideas, ...seedsWithData]
      const best = selectBestKeyword(allCandidates, existingKeywords)

      if (best) {
        selectedKeyword = best

        // ── SERP intent analysis for the selected keyword ──────────────────
        try {
          serpIntent = await analyzeSerpIntent(best.keyword, locationCode)
        } catch {
          // Non-fatal — proceed without SERP data
        }

        const intent = classifyIntent(best.keyword)
        keywordContext = `\n## Keyword research data (DataForSEO)
Selected primary keyword: "${best.keyword}"
Search volume: ${best.searchVolume.toLocaleString()}/month
Keyword difficulty: ${best.difficulty}/100
Search intent: ${intent} — ${intent === 'transactional' ? 'reader is ready to act/buy, include strong CTA and pricing/booking info' : intent === 'commercial' ? 'reader is comparing options, include comparisons and clear differentiators' : 'reader wants to learn, be thorough and educational'}
${serpIntent ? `
## SERP intent analysis
Winning content format for this keyword: ${serpIntent.format}
Writing recommendation: ${serpIntent.recommendation}
Top ranking titles (match this style and depth):
${serpIntent.topResults.slice(0, 5).map((r, i) => `${i + 1}. "${r.title}"`).join('\n')}` : ''}`
      }
      } // end seedKeywords.length > 0
    } // end else (no preselectedFromDb)
  } catch (err) {
    // DataForSEO failed — fall back to Claude-only keyword selection
    console.error('DataForSEO keyword research failed:', err)
    keywordContext = '\n(Keyword research unavailable — Claude will select the best keyword.)'
  }

  // ── Step 2: Fetch reference URL if provided ────────────────────────────────
  let referenceContent = ''
  if (referenceUrl) {
    try {
      // Block SSRF: only allow public http/https URLs
      const parsed = new URL(referenceUrl)
      if (!['http:', 'https:'].includes(parsed.protocol)) throw new Error('Invalid protocol')
      const host = parsed.hostname.toLowerCase()
      const privateIp = /^(localhost|.*\.local|127\.\d+\.\d+\.\d+|10\.\d+\.\d+\.\d+|172\.(1[6-9]|2\d|3[01])\.\d+\.\d+|192\.168\.\d+\.\d+|169\.254\.\d+\.\d+|0\.0\.0\.0)$/.test(host)
      if (privateIp) throw new Error('Private URL blocked')

      const res = await fetch(referenceUrl, {
        headers: { 'User-Agent': 'Mozilla/5.0 (compatible; DR.SEO/1.0)' },
        signal: AbortSignal.timeout(8000),
      })
      const html = await res.text()
      referenceContent = html
        .replace(/<script[\s\S]*?<\/script>/gi, '')
        .replace(/<style[\s\S]*?<\/style>/gi, '')
        .replace(/<[^>]+>/g, ' ')
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, 4000)
    } catch {
      referenceContent = '(Could not fetch reference URL)'
    }
  }

  // ── Step 3: Write the post ─────────────────────────────────────────────────
  const systemPrompt = `You are a senior SEO content strategist and writer. Your posts consistently rank on page 1 of Google AND get cited by AI assistants like ChatGPT, Perplexity, and Google AI Overviews.

## Company
Name: ${company.name}
Domain: ${company.domain}
Industry: ${company.industry}
Voice guidelines: ${company.voice_guidelines ?? 'Professional and informative.'}
Target keywords to draw from: ${targetKeywords}

## Existing posts (DO NOT target these same keywords or topics)
${existingTopics}
${keywordContext}
${referenceContent ? `\n## Reference material (use for inspiration, tone, and topic ideas)\n${referenceContent}` : ''}

## Content requirements
${selectedKeyword
  ? `- PRIMARY KEYWORD: "${selectedKeyword.keyword}" — research-validated. Build the entire post around it.`
  : `- Choose ONE specific long-tail primary keyword not covered by existing posts above`
}
${serpIntent ? `- CONTENT FORMAT: Write as a ${serpIntent.format} — ${serpIntent.recommendation}` : ''}
${customPrompt ? `- User-requested angle: "${customPrompt}" — prioritize this direction` : ''}
- Word count: 1,500–2,000 words
- Structure: H1 title, 4–6 H2 sections, H3 subsections where appropriate
- Include a FAQ section at the end (4–5 questions with direct answers in <h3>/<p> format)
- Weave in 3–5 secondary/related keywords naturally throughout
- Write with E-E-A-T in mind: real expertise, specific details, data points — no generic filler
- End with a clear call-to-action relevant to the business
${moneyPageUrl ? `- MONEY PAGE LINK: Naturally include one contextual link to ${moneyPageUrl} — this is the most important page on the site. Anchor text should be descriptive and keyword-rich, never generic ("click here").` : ''}
- Match the brand voice guidelines exactly

## GEO (Generative Engine Optimization) requirements — CRITICAL
AI assistants (Perplexity, ChatGPT, Google AI Overview) cite content that is structured for direct extraction. Follow ALL of these:

1. DIRECT ANSWER FIRST: The very first paragraph after the H1 must directly answer the core question implied by the keyword in 2–3 sentences. No preamble, no "In this article we'll explore..." — just the answer.

2. CONVERSATIONAL H2 HEADINGS: Phrase H2s as questions the reader would actually type or say:
   - Good: "How Long Does It Take to Get a Sailing Certificate?"
   - Bad: "Certification Timeline Overview"

3. STATISTICS AND SPECIFICS: Include at least 3 specific data points, numbers, or percentages per article. Cite the source inline (e.g., "According to the US Coast Guard..." or "Studies show 73% of..."). Real numbers only — do not fabricate statistics.

4. ENTITY SIGNALS: In the introduction or a dedicated section, clearly establish WHO the business is, WHAT they do, WHERE they operate, and WHY they are authoritative (years in business, certifications, notable credentials). This helps AI models correctly identify and cite ${company.name}.

5. DEFINITION BOXES: For any technical term or concept central to the topic, include a bolded definition sentence immediately after first use: e.g., <p><strong>[Term]</strong> is defined as...</p>

6. FAQ SECTION STRUCTURE: The FAQ section MUST use <h3> tags for each question and <p> tags for each answer, formatted so each Q&A pair is immediately extractable. Minimum 4 pairs, maximum 8.

## HTML output requirements
- Use semantic HTML: <h2>, <h3>, <p>, <ul>, <ol>, <strong>
- FAQ section: use <h3> for each question, <p> for each answer (required for FAQPage schema extraction)
- Add [INTERNAL_LINK: suggested topic] placeholders where other internal links would help
- Do NOT include <html>, <head>, or <body> tags — content only
- Do NOT add JSON-LD script tags — the publishing system handles schema injection automatically

## Response format
Return ONLY valid JSON — no markdown, no commentary:
{
  "title": "exact H1 title (include primary keyword near the front)",
  "seo_title": "CTR-optimized title tag ≤60 chars for the <title> tag (can differ from H1)",
  "target_keyword": "primary keyword phrase",
  "secondary_keywords": ["kw1", "kw2", "kw3"],
  "meta_description": "compelling 150–160 char meta description with primary keyword",
  "slug": "url-friendly-slug-max-6-words",
  "content": "full HTML content as a single string"
}`

  const userMessage = customPrompt
    ? `Write an SEO blog post for ${company.name} about: ${customPrompt}. Make it genuinely useful — the kind of content that earns backlinks and ranks.`
    : `Write the next SEO blog post for ${company.name}. Use the research-validated keyword above. Make it genuinely useful — the kind of content that earns backlinks and ranks.`

  const message = await anthropic.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 4096,
    messages: [{ role: 'user', content: userMessage }],
    system: systemPrompt,
  })

  const text = message.content[0].type === 'text' ? message.content[0].text : ''
  let parsed: {
    title: string
    seo_title: string
    target_keyword: string
    secondary_keywords: string[]
    meta_description: string
    slug: string
    content: string
  }
  try {
    const jsonMatch = text.match(/\{[\s\S]*\}/)
    parsed = JSON.parse(jsonMatch?.[0] ?? text)
  } catch {
    return { error: 'Failed to parse writer output. Raw: ' + text.slice(0, 200) }
  }

  const { data: newPost, error } = await supabase.from('posts').insert({
    company_id: companyId,
    title: parsed.title,
    content: parsed.content,
    meta_description: parsed.meta_description,
    target_keyword: parsed.target_keyword,
    status: company.auto_publish ? 'approved' : 'draft',
  }).select('id').single()

  if (error) return { error: error.message }

  // Save keyword metrics to keywords table if we have DataForSEO data
  if (selectedKeyword) {
    await supabase.from('keywords').upsert({
      company_id: companyId,
      keyword: selectedKeyword.keyword,
      search_volume: selectedKeyword.searchVolume,
      difficulty: selectedKeyword.difficulty,
      status: 'content_planned',
    }, { onConflict: 'company_id,keyword' })
  }

  const kwInfo = selectedKeyword
    ? ` | Volume: ${selectedKeyword.searchVolume.toLocaleString()}/mo, Difficulty: ${selectedKeyword.difficulty}/100`
    : ''

  // Auto-publish: if auto_publish is on, immediately send to WordPress/CMS
  if (company.auto_publish && newPost?.id) {
    const publishResult = await runPublisher(newPost.id)
    if (publishResult?.error) {
      return { message: `Post "${parsed.title}" created but publish failed: ${publishResult.error}.${kwInfo}` }
    }
    return { message: `Post "${parsed.title}" written and published automatically.${kwInfo}` }
  }

  return {
    message: `Post "${parsed.title}" created as ${company.auto_publish ? 'approved' : 'draft'}.${kwInfo}`,
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

  const apiKey = process.env.GOOGLE_SEARCH_API_KEY
  const engineId = process.env.GOOGLE_SEARCH_ENGINE_ID
  if (!apiKey || !engineId) {
    return { error: 'Add GOOGLE_SEARCH_API_KEY and GOOGLE_SEARCH_ENGINE_ID to environment variables.' }
  }

  const queries = [
    `best ${company.industry} companies`,
    `top ${company.industry} services`,
    `${company.name} reviews`,
    `${company.domain}`,
  ]

  const results: Array<{ cited: boolean; query: string; snippet: string | null; position: number | null }> = []

  for (const query of queries) {
    try {
      const url = `https://www.googleapis.com/customsearch/v1?key=${apiKey}&cx=${engineId}&q=${encodeURIComponent(query)}&num=10`
      const res = await fetch(url, { signal: AbortSignal.timeout(10000) })

      if (!res.ok) {
        results.push({ cited: false, query, snippet: null, position: null })
        continue
      }

      const data = await res.json()
      const items: Array<{ title: string; link: string; snippet: string }> = data.items ?? []

      const brandLower = company.name.toLowerCase()
      const domainLower = company.domain.toLowerCase()

      let cited = false
      let snippet: string | null = null
      let position: number | null = null

      for (let i = 0; i < items.length; i++) {
        const item = items[i]
        if (
          item.link.toLowerCase().includes(domainLower) ||
          item.title.toLowerCase().includes(brandLower) ||
          item.snippet.toLowerCase().includes(brandLower)
        ) {
          cited = true
          position = i + 1
          snippet = `#${i + 1}: "${item.title}" — ${item.snippet}`
          break
        }
      }

      await supabase.from('citation_logs').insert({
        company_id: companyId,
        query,
        source: 'google_search',
        cited,
        snippet,
      })

      results.push({ cited, query, snippet, position })
    } catch {
      results.push({ cited: false, query, snippet: null, position: null })
    }
  }

  const citedCount = results.filter(r => r.cited).length
  const bestPosition = results
    .filter(r => r.position)
    .sort((a, b) => (a.position ?? 99) - (b.position ?? 99))[0]?.position

  return {
    message: `Checked ${results.length} queries via Google Search. ${company.name} appearing in ${citedCount}/${results.length}.${bestPosition ? ` Best position: #${bestPosition}.` : ' Not yet ranking for tracked queries.'}`,
  }
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

async function runPublisher(postId: string): Promise<{ message?: string; error?: string } | null> {
  const supabase = getSupabaseAdmin()
  const { data: post } = await supabase
    .from('posts')
    .select('*, companies(*)')
    .eq('id', postId)
    .single()

  if (!post) return null

  if (post.companies?.cms_type === 'wordpress' && post.companies?.wp_url) {
    return publishToWordPress(post)
  }
  // Non-WP: mark published, user deploys manually
  await supabase
    .from('posts')
    .update({ status: 'published', published_at: new Date().toISOString() })
    .eq('id', postId)
  return { message: 'Marked as published. Deploy manually for this CMS type.' }
}

export async function POST(req: NextRequest) {
  if (!auth(req)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { agent, company_id, prompt, url } = await req.json()

  if (!['writer', 'citation', 'refresh', 'publisher'].includes(agent)) {
    return NextResponse.json({ error: 'Unknown agent' }, { status: 400 })
  }

  try {
    let result: { message?: string; error?: string }

    if (agent === 'writer') {
      result = company_id ? await runWriter(company_id, prompt, url) : await runForAllCompanies('writer')
    } else if (agent === 'citation') {
      result = company_id ? await runCitationCheck(company_id) : await runForAllCompanies('citation')
    } else if (agent === 'refresh') {
      result = { message: 'Content refresh agent coming soon.' }
    } else if (agent === 'publisher') {
      // company_id here is actually a post id
      const publishResult = await runPublisher(company_id)
      if (!publishResult) return NextResponse.json({ error: 'Post not found' }, { status: 404 })
      result = publishResult
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

function buildArticleSchema(post: {
  title: string
  meta_description: string | null
  created_at?: string
  published_at?: string | null
}, company: { name: string; domain: string; wp_url: string }) {
  return {
    '@context': 'https://schema.org',
    '@type': 'Article',
    headline: post.title,
    description: post.meta_description ?? '',
    datePublished: post.published_at ?? post.created_at ?? new Date().toISOString(),
    dateModified: new Date().toISOString(),
    author: { '@type': 'Organization', name: company.name, url: company.wp_url },
    publisher: {
      '@type': 'Organization',
      name: company.name,
      url: company.wp_url,
      logo: { '@type': 'ImageObject', url: `${company.wp_url}/wp-content/uploads/logo.png` },
    },
    mainEntityOfPage: { '@type': 'WebPage', '@id': company.wp_url },
  }
}

function buildLocalBusinessSchema(company: {
  name: string
  domain: string
  wp_url: string
  industry: string
}) {
  // Generic LocalBusiness schema built from company data — works for any company
  return {
    '@context': 'https://schema.org',
    '@type': 'LocalBusiness',
    name: company.name,
    url: company.wp_url || `https://${company.domain}`,
    description: `${company.name} — ${company.industry} services.`,
    sameAs: [`https://${company.domain}`],
  }
}

function buildFAQSchema(content: string) {
  // Extract FAQ pairs from common patterns: <strong>Q</strong> followed by answer,
  // or consecutive <h3> + <p> pairs inside a FAQ section
  const faqSection = content.match(/(?:faq|frequently asked|common questions?)[\s\S]{0,5000}/i)?.[0] ?? content

  // Match <h3>Question?</h3> followed by content up to next <h3> or end
  const pairs: Array<{ question: string; answer: string }> = []
  const h3Matches = [...faqSection.matchAll(/<h3[^>]*>([\s\S]*?)<\/h3>([\s\S]*?)(?=<h3|$)/gi)]

  for (const m of h3Matches) {
    const question = m[1].replace(/<[^>]+>/g, '').trim()
    const answer = m[2].replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 300)
    if (question.length > 10 && answer.length > 20) {
      pairs.push({ question, answer })
    }
  }

  if (pairs.length < 2) return null

  return {
    '@context': 'https://schema.org',
    '@type': 'FAQPage',
    mainEntity: pairs.slice(0, 8).map(p => ({
      '@type': 'Question',
      name: p.question,
      acceptedAnswer: { '@type': 'Answer', text: p.answer },
    })),
  }
}

function buildHowToSchema(title: string, content: string) {
  if (!/\bhow to\b/i.test(title)) return null

  // Extract steps from <h3> or <li> tags in the content
  const stepMatches = content.match(/<(?:h3|li)[^>]*>(.*?)<\/(?:h3|li)>/gi) ?? []
  const steps = stepMatches
    .slice(0, 10)
    .map((s, i) => ({
      '@type': 'HowToStep',
      position: i + 1,
      name: s.replace(/<[^>]+>/g, '').trim(),
    }))
    .filter(s => s.name.length > 3)

  if (steps.length < 3) return null

  return {
    '@context': 'https://schema.org',
    '@type': 'HowTo',
    name: title,
    step: steps,
  }
}

function injectSchemas(content: string, schemas: object[]): string {
  const scriptTags = schemas
    .map(s => `<script type="application/ld+json">\n${JSON.stringify(s, null, 2)}\n</script>`)
    .join('\n')
  return content + '\n' + scriptTags
}

async function publishToWordPress(post: {
  id: string
  title: string
  content: string
  meta_description: string | null
  created_at?: string
  published_at?: string | null
  companies: { name: string; wp_url: string; wp_user: string; wp_app_password: string; domain: string; industry: string }
}) {
  const supabase = getSupabaseAdmin()
  const { wp_url, wp_user, wp_app_password } = post.companies
  const credentials = Buffer.from(`${wp_user}:${wp_app_password}`).toString('base64')
  const authHeader = `Basic ${credentials}`

  // Derive a clean slug from the title
  const slug = post.title
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, '')
    .trim()
    .split(/\s+/)
    .slice(0, 6)
    .join('-')

  // SEO title: prefer stored seo_title field if available, otherwise trim H1 to 60 chars
  const seoTitle = post.title.length <= 60 ? post.title : post.title.slice(0, 57) + '...'

  // Build and inject structured data schemas
  const schemas: object[] = []
  schemas.push(buildArticleSchema(post, post.companies))
  const localSchema = buildLocalBusinessSchema(post.companies)
  if (localSchema) schemas.push(localSchema)
  const howToSchema = buildHowToSchema(post.title, post.content)
  if (howToSchema) schemas.push(howToSchema)
  const faqSchema = buildFAQSchema(post.content)
  if (faqSchema) schemas.push(faqSchema)
  const contentWithSchemas = injectSchemas(post.content, schemas)

  const body = JSON.stringify({
    title: post.title,
    content: contentWithSchemas,
    status: 'publish',
    slug,
    excerpt: post.meta_description ?? '',
    // Yoast SEO meta fields
    meta: {
      _yoast_wpseo_title: seoTitle,
      _yoast_wpseo_metadesc: post.meta_description ?? '',
    },
  })

  const res = await fetch(`${wp_url}/wp-json/wp/v2/posts`, {
    method: 'POST',
    headers: { Authorization: authHeader, 'Content-Type': 'application/json' },
    body,
  })

  if (!res.ok) {
    const err = await res.text()
    await supabase.from('posts').update({ status: 'failed' }).eq('id', post.id)
    return { error: `WordPress error: ${err}` }
  }

  const wpPost = await res.json()

  // Try RankMath as fallback if Yoast isn't active
  try {
    await fetch(`${wp_url}/wp-json/wp/v2/posts/${wpPost.id}`, {
      method: 'POST',
      headers: { Authorization: authHeader, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        meta: {
          rank_math_title: seoTitle,
          rank_math_description: post.meta_description ?? '',
          rank_math_focus_keyword: '',
        },
      }),
    })
  } catch { /* RankMath not installed — fine */ }

  await supabase
    .from('posts')
    .update({ status: 'published', published_at: new Date().toISOString(), wp_post_id: wpPost.id, schema_injected: true })
    .eq('id', post.id)

  return { message: `Published to WordPress (post #${wpPost.id}, slug: ${slug}).` }
}
