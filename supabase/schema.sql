-- ============================================================
-- DR.SEO — Supabase Schema
-- ============================================================

-- Companies (one row per managed website)
create table if not exists public.companies (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  domain text not null unique,
  cms_type text not null check (cms_type in ('wordpress', 'nextjs', 'manus')),
  industry text not null,
  voice_guidelines text,
  target_keywords text[],
  auto_publish boolean not null default false,
  posts_per_week integer not null default 2,
  wp_url text,
  wp_user text,
  wp_app_password text,
  active boolean not null default true,
  created_at timestamptz not null default now()
);

-- Posts (generated blog posts for each company)
create table if not exists public.posts (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  title text not null,
  content text not null,
  meta_description text,
  target_keyword text,
  status text not null default 'draft' check (status in ('draft', 'approved', 'published', 'failed')),
  published_at timestamptz,
  wp_post_id integer,
  schema_injected boolean not null default false,
  created_at timestamptz not null default now()
);

create index if not exists idx_posts_company_id on public.posts(company_id);
create index if not exists idx_posts_status on public.posts(status);

-- Citation logs (brand mentions in AI search)
create table if not exists public.citation_logs (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  query text not null,
  source text not null check (source in ('chatgpt', 'perplexity', 'google_ai')),
  cited boolean not null default false,
  snippet text,
  checked_at timestamptz not null default now()
);

create index if not exists idx_citations_company_id on public.citation_logs(company_id);

-- Content refresh queue (pages flagged for rewriting)
create table if not exists public.content_refreshes (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  page_url text not null,
  page_title text,
  last_published timestamptz,
  refresh_status text not null default 'pending' check (refresh_status in ('pending', 'in_progress', 'done', 'skipped')),
  created_at timestamptz not null default now()
);

-- Keyword tracking (competitor gap analysis)
create table if not exists public.keywords (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  keyword text not null,
  search_volume integer,
  difficulty integer,
  current_rank integer,
  target_rank integer,
  status text not null default 'tracking' check (status in ('tracking', 'content_planned', 'published')),
  created_at timestamptz not null default now(),
  unique(company_id, keyword)
);

create index if not exists idx_keywords_company_id on public.keywords(company_id);

-- Seed the four companies
insert into public.companies (name, domain, cms_type, industry, voice_guidelines, posts_per_week, auto_publish, wp_url, active)
values
  (
    'Experience Aloha',
    'experiencealoha.co',
    'wordpress',
    'Luxury experiential events / destination proposal planning',
    'Romantic, sophisticated, and premium. Use aspirational language. Words like "masterpiece", "thoughtfully hosted", "unforgettable". Target affluent couples planning engagements or romantic occasions in Hawaii.',
    2,
    false,
    'https://experiencealoha.co',
    true
  ),
  (
    'Lowtide Sailing',
    'lowtidesailing.com',
    'wordpress',
    'Luxury group travel / yacht charters',
    'Aspirational and adventurous but accessible. Balance luxury with approachability. Emphasize "no experience needed", "expert captains", "bucket list". Target affluent friend groups and corporate offsites.',
    2,
    false,
    'https://lowtidesailing.com',
    true
  ),
  (
    'Vincent Rougier',
    'vincentrougier.com',
    'manus',
    'Luxury artisan jewelry / upcycled vintage timepieces',
    'Minimalist, introspective, and quietly elegant. Let the work speak. No hard selling. Use phrases like "quietly bold", "unmistakably you", "built around your story". Target design-conscious affluent buyers.',
    1,
    false,
    null,
    true
  ),
  (
    'Art Party Radar',
    'artpartyradar.com',
    'nextjs',
    'Arts & culture / local event discovery',
    'Community-forward, casual, and creative. Not corporate. Short sentences. Approachable tone. Target grassroots art enthusiasts and culture seekers in Honolulu.',
    1,
    false,
    null,
    true
  )
on conflict (domain) do nothing;
