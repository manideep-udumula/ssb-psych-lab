-- SSB Psych Lab · OIR attempts. Kept apart from public.sessions so OIR marks never mix with OLQ scores.
-- Additive only: safe to apply before the OIR feature is live.
create table if not exists public.oir_attempts (
  id         text primary key,
  user_id    uuid not null default auth.uid() references auth.users(id) on delete cascade,
  set_no     integer not null,
  date       date not null,
  percent    numeric not null,
  rating     integer not null check (rating between 1 and 5),
  result     jsonb not null,            -- per-booklet scores, topics and the candidate's answers
  created_at timestamptz not null default now()
);
create index if not exists oir_attempts_user on public.oir_attempts (user_id, created_at);
alter table public.oir_attempts enable row level security;
drop policy if exists "own oir attempts" on public.oir_attempts;
create policy "own oir attempts" on public.oir_attempts for all to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
