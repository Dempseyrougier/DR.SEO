-- Supabase flagged rls_disabled_in_public on 2026-09-27.
-- All DR.SEO access goes through the service role key (web/lib/supabase.ts
-- getSupabaseAdmin), which bypasses RLS, so no policies are needed.
-- The browser key can no longer read or write these tables.
-- public.leads is untouched: it already has RLS and its insert-only policy.

alter table public.companies            enable row level security;
alter table public.posts                enable row level security;
alter table public.citation_logs        enable row level security;
alter table public.content_refreshes    enable row level security;
alter table public.keywords             enable row level security;
alter table public.keyword_rank_history enable row level security;

-- Self check: fails loudly if any public table is still open.
do $$
declare open_tables text;
begin
  select string_agg(tablename, ', ') into open_tables
  from pg_tables where schemaname = 'public' and not rowsecurity;
  if open_tables is not null then
    raise exception 'RLS still off on: %', open_tables;
  end if;
end $$;
