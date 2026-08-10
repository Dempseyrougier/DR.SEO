import { NextRequest, NextResponse } from 'next/server'
import { getSupabaseAdmin } from '../../../../../lib/supabase'
import Anthropic from '@anthropic-ai/sdk'
import { getKeywordIdeas, getSearchVolumes, selectBestKeyword, analyzeSerpIntent, classifyIntent, type SerpIntent } from '../../../../../lib/dataforseo'

export const maxDuration = 300
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
  // money_page_url column may not exist yet; site_context can declare it with a "MONEY_PAGE_URL: <url>" line
  const ctxMoneyPage: string | null = company.site_context?.match(/MONEY_PAGE_URL:\s*(\S+)/)?.[1] ?? null
  const moneyPageUrl: string | null = (company as { money_page_url?: string | null }).money_page_url ?? ctxMoneyPage
  // Author identity, same site_context marker idiom as MONEY_PAGE_URL. A real
  // named author is an E-E-A-T requirement, not decoration: posts published
  // with a blank byline were part of what got this pipeline flagged.
  const authorName: string | null = company.site_context?.match(/AUTHOR_NAME:\s*(.+)/)?.[1]?.trim() ?? null
  const authorCreds: string | null = company.site_context?.match(/AUTHOR_CREDENTIALS:\s*(.+)/)?.[1]?.trim() ?? null

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
${company.site_context ? `\n## Website audit — reference these specifics in your post\n${company.site_context}` : ''}

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
- Word count: 1,400–1,800 words
- Structure: H1 title, 4–6 H2 sections, H3 subsections where appropriate
- Include a FAQ section at the end ONLY if the topic genuinely raises questions a reader would ask (3–6 questions with direct answers in <h3>/<p> format). A destination guide usually earns one; not every post does.
- Weave in 3–5 secondary/related keywords naturally throughout
- Write with E-E-A-T in mind: real expertise, specific details, data points — no generic filler
- End with a clear call-to-action relevant to the business
${moneyPageUrl ? `- MONEY PAGE LINK: Naturally include one contextual link to ${moneyPageUrl} — this is the most important page on the site. Anchor text should be descriptive and keyword-rich, never generic ("click here").` : ''}
- Match the brand voice guidelines exactly

## GEO (Generative Engine Optimization) requirements — CRITICAL
AI assistants (Perplexity, ChatGPT, Google AI Overview) cite content that is structured for direct extraction. Follow ALL of these:

1. DIRECT ANSWER FIRST: The very first paragraph after the H1 must directly answer the core question implied by the keyword in 2–3 sentences. No preamble, no "In this article we'll explore..." — just the answer.

2. NATURAL H2 HEADINGS: Mix question-form headings ("How Long Does It Take to Get a Sailing Certificate?") with plain statement headings. All-questions is a template fingerprint; use a question only where the section truly answers one.

3. TRUTHFULNESS OVER STATISTICS — THIS OUTRANKS EVERY OTHER CONTENT RULE:
   - Facts about the company (credentials, prices, locations, experience) may ONLY come from the Company and Website audit sections above. Use them — they are your specifics.
   - NEVER cite an external study, statistic, percentage, or organization claim unless the exact figure appears in the material provided above. No "According to..." and no "Studies show..." from memory: invented or unverifiable citations are the single fastest way to get this site demoted by Google's spam systems.
   - If no real data point fits a section, write it without one. Concrete practical detail (what a maneuver feels like, what a day on the course looks like, what a mistake costs) beats a number.
   - Never state the same fact two different ways in one article. Reread your claims for internal consistency before finishing.

4. ENTITY SIGNALS: In the introduction or a dedicated section, clearly establish WHO the business is, WHAT they do, WHERE they operate, and WHY they are authoritative (years in business, certifications, notable credentials). This helps AI models correctly identify and cite ${company.name}.${authorName ? `\n   Write in the first-person-plural voice of the team where natural. The article is bylined ${authorName}${authorCreds ? ` (${authorCreds})` : ''}; you may reference the author's direct experience where it is supported by the company facts above.` : ''}

5. DEFINITION BOXES: For any technical term or concept central to the topic, include a bolded definition sentence immediately after first use: e.g., <p><strong>[Term]</strong> is defined as...</p>

6. FAQ SECTION STRUCTURE: If you include a FAQ, it MUST use <h3> tags for each question and <p> tags for each answer, formatted so each Q&A pair is immediately extractable.

## HTML output requirements
- Use semantic HTML: <h2>, <h3>, <p>, <ul>, <ol>, <strong>
- FAQ section: use <h3> for each question, <p> for each answer (required for FAQPage schema extraction)
- Do NOT include <html>, <head>, or <body> tags — content only
- Do NOT add JSON-LD script tags — the publishing system handles schema injection automatically
- Do NOT include [INTERNAL_LINK: ...] placeholders — omit them entirely

## Formatting — vary it, never template it
Every post on this site sharing the same callout boxes, the same FAQ shape, and the same closing box is a scaled-content fingerprint Google's spam systems detect. Structure each article the way ITS topic demands:

- Use plain semantic HTML (<h2>, <h3>, <p>, <ul>, <ol>, <strong>, <blockquote>). Use single quotes for any style attributes.
- At most ONE visual callout per article, and only if something genuinely deserves the emphasis — many posts should have none.
- Vary the closing: end with a short, natural call-to-action paragraph (2–3 sentences) that links to ${moneyPageUrl ?? `https://${company.domain}`} with descriptive anchor text. Write it fresh for each article; never reuse a fixed layout or headline formula.

## Response format
Return the metadata as a JSON object, then the HTML article body after a line containing exactly ===CONTENT===. Do NOT put the HTML inside the JSON, and do NOT use markdown fences. After the delimiter the HTML is raw — it does not need to be escaped or quoted.
{
  "title": "exact H1 title (include primary keyword near the front)",
  "seo_title": "CTR-optimized title tag ≤60 chars for the <title> tag (can differ from H1)",
  "target_keyword": "primary keyword phrase",
  "secondary_keywords": ["kw1", "kw2", "kw3"],
  "meta_description": "compelling 150–160 char meta description with primary keyword",
  "slug": "url-friendly-slug-max-6-words"
}
===CONTENT===
<h2>...the full HTML article body goes here, raw...</h2>`

  const userMessage = customPrompt
    ? `Write an SEO blog post for ${company.name} about: ${customPrompt}. Make it genuinely useful — the kind of content that earns backlinks and ranks.`
    : `Write the next SEO blog post for ${company.name}. Use the research-validated keyword above. Make it genuinely useful — the kind of content that earns backlinks and ranks.`

  const message = await anthropic.messages.create({
    model: 'claude-sonnet-4-6',
    // Headroom for a full article; stays under the SDK's non-streaming HTTP timeout.
    max_tokens: 16000,
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
    // Metadata JSON and the HTML body are separated by a ===CONTENT=== delimiter so the
    // HTML never has to be JSON-escaped — unescaped quotes/newlines in the article body
    // used to break JSON.parse. Fall back to whole-blob JSON for any old-format response.
    const DELIM = '===CONTENT==='
    const idx = text.indexOf(DELIM)
    if (idx !== -1) {
      const metaRaw = text.slice(0, idx).replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/i, '').trim()
      const metaMatch = metaRaw.match(/\{[\s\S]*\}/)
      const meta = JSON.parse(metaMatch?.[0] ?? metaRaw)
      const content = text.slice(idx + DELIM.length).replace(/^\s*```\w*\s*/, '').replace(/```\s*$/i, '').trim()
      parsed = { ...meta, content }
    } else {
      const stripped = text.replace(/^```(?:json)?\s*/i, '').replace(/\s*```\s*$/i, '').trim()
      const jsonMatch = stripped.match(/\{[\s\S]*\}/)
      parsed = JSON.parse(jsonMatch?.[0] ?? stripped)
    }
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

async function runSiteAudit(companyId: string) {
  const supabase = getSupabaseAdmin()

  const { data: company } = await supabase
    .from('companies')
    .select('name, domain, industry')
    .eq('id', companyId)
    .single()

  if (!company) return { error: 'Company not found' }
  if (!company.domain) return { error: 'Company has no domain set' }

  const baseUrl = `https://${company.domain}`

  async function fetchPageText(url: string): Promise<string> {
    try {
      const res = await fetch(url, {
        headers: { 'User-Agent': 'Mozilla/5.0 (compatible; DR.SEO/1.0)' },
        signal: AbortSignal.timeout(8000),
      })
      if (!res.ok) return ''
      const html = await res.text()
      return html
        .replace(/<script[\s\S]*?<\/script>/gi, '')
        .replace(/<style[\s\S]*?<\/style>/gi, '')
        .replace(/<nav[\s\S]*?<\/nav>/gi, '')
        .replace(/<footer[\s\S]*?<\/footer>/gi, '')
        .replace(/<[^>]+>/g, ' ')
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, 3000)
    } catch {
      return ''
    }
  }

  function extractInternalLinks(html: string): string[] {
    const matches = html.match(/href=["']([^"'#?]+)["']/gi) ?? []
    const contentKeywords = ['about', 'service', 'package', 'course', 'sailing', 'offer', 'experience', 'tour', 'proposal', 'wedding', 'pricing', 'learn', 'certif', 'charter', 'beach', 'luxury']
    const links: string[] = []
    for (const m of matches) {
      const href = m.replace(/href=["']([^"'#?]+)["']/i, '$1')
      let full = ''
      if (href.startsWith('/') && !href.startsWith('//')) {
        full = baseUrl + href
      } else if (href.startsWith(baseUrl)) {
        full = href
      }
      if (full && contentKeywords.some(k => full.toLowerCase().includes(k))) {
        links.push(full)
      }
    }
    return [...new Set(links)].slice(0, 4)
  }

  // Fetch homepage
  let homepageHtml = ''
  try {
    const res = await fetch(baseUrl, {
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; DR.SEO/1.0)' },
      signal: AbortSignal.timeout(8000),
    })
    homepageHtml = res.ok ? await res.text() : ''
  } catch { /* non-fatal */ }

  const homepageText = homepageHtml
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 3000)

  // Discover and fetch key subpages
  const subpageLinks = extractInternalLinks(homepageHtml)
  const pageChunks: string[] = [`--- ${baseUrl} ---\n${homepageText}`]
  for (const link of subpageLinks) {
    const text = await fetchPageText(link)
    if (text) pageChunks.push(`--- ${link} ---\n${text}`)
  }

  const combinedContent = pageChunks.join('\n\n').slice(0, 12000)

  if (!combinedContent.trim()) {
    return { error: `Could not fetch any content from ${company.domain}` }
  }

  // Summarise with Haiku
  const summaryRes = await anthropic.messages.create({
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 1000,
    messages: [{
      role: 'user',
      content: `You are auditing a business website to build a reference document for an AI content writer.

Company: ${company.name}
Domain: ${company.domain}
Industry: ${company.industry}

Scraped website content:
${combinedContent}

Extract and summarise into a concise reference document under these headings:
1. Core offerings (specific service/package/course names, tiers, key details, prices if shown)
2. Locations served
3. Unique selling points and differentiators
4. Credentials, certifications, awards, or partnerships
5. Target customer profile
6. Specific details a content writer must reference (instructor names, signature experiences, booking process, key stats, etc.)

Be specific and factual. Only include what is evidenced on the website. Use bullet points.`,
    }],
  })

  const siteContext = summaryRes.content[0].type === 'text' ? summaryRes.content[0].text : ''
  if (!siteContext) return { error: 'Audit summary returned empty' }

  await supabase.from('companies').update({ site_context: siteContext }).eq('id', companyId)

  return { message: `Site audit complete for ${company.name}. Scanned ${pageChunks.length} page(s), saved ${siteContext.length} chars of context.` }
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

  if (!['writer', 'citation', 'refresh', 'publisher', 'audit'].includes(agent)) {
    return NextResponse.json({ error: 'Unknown agent' }, { status: 400 })
  }

  try {
    let result: { message?: string; error?: string }

    if (agent === 'writer') {
      result = company_id ? await runWriter(company_id, prompt, url) : await runForAllCompanies('writer')
    } else if (agent === 'citation') {
      result = company_id ? await runCitationCheck(company_id) : await runForAllCompanies('citation')
    } else if (agent === 'audit') {
      if (!company_id) return NextResponse.json({ error: 'company_id required for audit' }, { status: 400 })
      result = await runSiteAudit(company_id)
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
}, company: { name: string; domain: string; wp_url: string; site_context?: string | null }) {
  const authorName = company.site_context?.match(/AUTHOR_NAME:\s*(.+)/)?.[1]?.trim()
  return {
    '@context': 'https://schema.org',
    '@type': 'Article',
    headline: post.title,
    description: post.meta_description ?? '',
    datePublished: post.published_at ?? post.created_at ?? new Date().toISOString(),
    dateModified: new Date().toISOString(),
    author: authorName
      ? { '@type': 'Person', name: authorName, worksFor: { '@type': 'Organization', name: company.name, url: company.wp_url } }
      : { '@type': 'Organization', name: company.name, url: company.wp_url },
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
  companies: { name: string; wp_url: string; wp_user: string; wp_app_password: string; domain: string; industry: string; site_context?: string | null }
}) {
  const supabase = getSupabaseAdmin()
  const { wp_url, wp_user, wp_app_password } = post.companies
  const credentials = Buffer.from(`${wp_user}:${wp_app_password}`).toString('base64')
  const authHeader = `Basic ${credentials}`

  // Byline: WP_AUTHOR_ID in site_context names the WordPress user the post is
  // authored as (the API-credential user is a bot account and must not be the
  // public byline). AUTHOR_NAME feeds the Article schema as a Person.
  const wpAuthorId: number | null = (() => {
    const m = post.companies.site_context?.match(/WP_AUTHOR_ID:\s*(\d+)/)
    return m ? parseInt(m[1], 10) : null
  })()

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

  // Strip leading H1 — WordPress renders the post title as H1 itself
  const contentNoH1 = post.content
    .replace(/^\s*<h1[^>]*>[\s\S]*?<\/h1>\s*/i, '')
    // Remove [INTERNAL_LINK: ...] placeholders left by the writer
    .replace(/\[INTERNAL_LINK:[^\]]*\]/g, '')
    // Clean up any empty <p> tags that result
    .replace(/<p>\s*<\/p>/g, '')

  // Auto-fetch a featured image from Unsplash using the post keyword/title
  let featuredImageBlock = ''
  const unsplashKey = process.env.UNSPLASH_ACCESS_KEY
  if (unsplashKey) {
    try {
      const searchTerm = encodeURIComponent(post.title.split(' ').slice(0, 4).join(' '))
      const imgRes = await fetch(
        `https://api.unsplash.com/search/photos?query=${searchTerm}&per_page=1&orientation=landscape`,
        { headers: { Authorization: `Client-ID ${unsplashKey}` }, signal: AbortSignal.timeout(5000) }
      )
      if (imgRes.ok) {
        const imgData = await imgRes.json()
        const img = imgData.results?.[0]
        if (img) {
          const credit = `Photo by <a href="${img.user.links.html}?utm_source=dr_seo&utm_medium=referral" target="_blank" rel="noopener">${img.user.name}</a> on <a href="https://unsplash.com?utm_source=dr_seo&utm_medium=referral" target="_blank" rel="noopener">Unsplash</a>`
          featuredImageBlock = `<figure style="margin:0 0 32px 0;"><img src="${img.urls.regular}" alt="${post.title}" style="width:100%;border-radius:8px;" /><figcaption style="font-size:12px;color:#888;margin-top:8px;">${credit}</figcaption></figure>\n\n`
        }
      }
    } catch { /* non-fatal — publish without image */ }
  }

  const contentWithImage = featuredImageBlock + contentNoH1

  // Build and inject structured data schemas
  const schemas: object[] = []
  schemas.push(buildArticleSchema(post, post.companies))
  const localSchema = buildLocalBusinessSchema(post.companies)
  if (localSchema) schemas.push(localSchema)
  const howToSchema = buildHowToSchema(post.title, contentNoH1)
  if (howToSchema) schemas.push(howToSchema)
  const faqSchema = buildFAQSchema(contentNoH1)
  if (faqSchema) schemas.push(faqSchema)
  const contentWithSchemas = injectSchemas(contentWithImage, schemas)

  const body = JSON.stringify({
    title: post.title,
    content: contentWithSchemas,
    status: 'publish',
    ...(wpAuthorId ? { author: wpAuthorId } : {}),
    slug,
    excerpt: post.meta_description ?? '',
    comment_status: 'closed',
    ping_status: 'closed',
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
    signal: AbortSignal.timeout(30000),
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
      signal: AbortSignal.timeout(10000),
    })
  } catch { /* RankMath not installed — fine */ }

  await supabase
    .from('posts')
    .update({ status: 'published', published_at: new Date().toISOString(), wp_post_id: wpPost.id, schema_injected: true })
    .eq('id', post.id)

  return { message: `Published to WordPress (post #${wpPost.id}, slug: ${slug}).` }
}
