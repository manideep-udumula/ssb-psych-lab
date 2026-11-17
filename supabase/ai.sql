-- Psychologist Review (AI) storage + HQ usage stats. Applied to the live project as migration ai_reviews_v2.
create table public.ai_reviews (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  kind text not null check (kind in ('battery','single')),
  battery_id text, session_id text, test text,
  date date not null, day int,
  status text not null default 'processing' check (status in ('processing','done','error')),
  result jsonb, models text, tokens int not null default 0, error text,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create unique index ai_reviews_battery_uq on public.ai_reviews (user_id, battery_id) where kind='battery';
create unique index ai_reviews_session_uq on public.ai_reviews (user_id, session_id) where kind='single';
create index ai_reviews_user_idx on public.ai_reviews (user_id, created_at);
create index ai_reviews_created_idx on public.ai_reviews (created_at);
alter table public.ai_reviews enable row level security;
create policy "own ai reviews" on public.ai_reviews for select to authenticated using (user_id = (select auth.uid()));
-- Writes happen only in the ai-review Edge Function (service role). See functions/ai-review/index.ts.
-- public.admin_ai_usage(days int) : admin-only usage summary for HQ (is_admin() gated, SECURITY DEFINER).
