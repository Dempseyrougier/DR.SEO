export type CmsType = 'wordpress' | 'nextjs' | 'manus'

export type Company = {
  id: string
  name: string
  domain: string
  cms_type: CmsType
  industry: string
  voice_guidelines: string | null
  target_keywords: string[] | null
  auto_publish: boolean
  posts_per_week: number
  wp_url: string | null
  wp_user: string | null
  wp_app_password: string | null
  location_code: number
  money_page_url: string | null
  active: boolean
  created_at: string
}

export type Post = {
  id: string
  company_id: string
  title: string
  content: string
  meta_description: string | null
  target_keyword: string | null
  status: 'draft' | 'approved' | 'published' | 'failed'
  published_at: string | null
  wp_post_id: number | null
  schema_injected: boolean
  created_at: string
  companies?: { name: string; domain: string }
}

export type CitationLog = {
  id: string
  company_id: string
  query: string
  source: 'chatgpt' | 'perplexity' | 'google_ai'
  cited: boolean
  snippet: string | null
  checked_at: string
  companies?: { name: string }
}

export type ContentRefresh = {
  id: string
  company_id: string
  page_url: string
  page_title: string | null
  last_published: string | null
  refresh_status: 'pending' | 'in_progress' | 'done' | 'skipped'
  created_at: string
}
