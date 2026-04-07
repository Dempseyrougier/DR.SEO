-- Keyword rank history — stores a snapshot every time rankings are checked
-- Run this in Supabase SQL Editor

create table if not exists public.keyword_rank_history (
  id uuid primary key default gen_random_uuid(),
  keyword_id uuid not null references public.keywords(id) on delete cascade,
  company_id uuid not null references public.companies(id) on delete cascade,
  rank integer,
  checked_at timestamptz not null default now()
);

create index if not exists idx_rank_history_keyword_id on public.keyword_rank_history(keyword_id);
create index if not exists idx_rank_history_company_id on public.keyword_rank_history(company_id);
create index if not exists idx_rank_history_checked_at on public.keyword_rank_history(checked_at desc);
