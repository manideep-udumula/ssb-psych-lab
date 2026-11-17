-- =====================================================================
-- SSB Psych Lab — Supabase schema
-- Run once in the Supabase SQL editor (or as a migration).
-- Every table has Row Level Security: a candidate can only see and
-- change their own rows. Chest numbers come from a sequence and can't
-- be edited by users.
-- =====================================================================

create sequence if not exists public.chest_no_seq start 1;

-- ---------- profiles (one row per registered candidate) ----------
create table if not exists public.profiles (
  id          uuid primary key references auth.users(id) on delete cascade,
  chest_no    bigint not null unique default nextval('public.chest_no_seq'),
  name        text   not null default '',
  email       text,
  entry       text   not null default 'NDA',
  start_date  date   not null default ((now() at time zone 'Asia/Kolkata')::date),
  created_at  timestamptz not null default now()
);

-- create the profile automatically when someone signs up
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, email, name, entry)
  values (new.id, new.email,
          coalesce(new.raw_user_meta_data->>'name', ''),
          coalesce(new.raw_user_meta_data->>'entry', 'NDA'))
  on conflict (id) do nothing;
  return new;
end $$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ---------- sessions (one row per test taken) ----------
create table if not exists public.sessions (
  id          text primary key,
  user_id     uuid not null default auth.uid() references auth.users(id) on delete cascade,
  test        text not null check (test in ('wat','srt','tat','sd')),
  set_no      int  not null,
  day         int  not null,
  date        date not null,
  count       int  not null,
  responses   jsonb not null,
  time_used   int  not null default 0,
  overall     numeric(3,1),
  assessment  jsonb,
  created_at  timestamptz not null default now()
);
create index if not exists sessions_user_created on public.sessions (user_id, created_at);

-- ---------- olq_scores (15 rows per test, filled by trigger, for fast stats) ----------
create table if not exists public.olq_scores (
  session_id  text not null references public.sessions(id) on delete cascade,
  user_id     uuid not null references auth.users(id) on delete cascade,
  olq         text not null,
  score       numeric(3,1) not null,
  primary key (session_id, olq)
);

create or replace function public.sync_olq_scores()
returns trigger language plpgsql as $$
begin
  delete from public.olq_scores where session_id = new.id;
  if new.assessment ? 'olq' then
    insert into public.olq_scores (session_id, user_id, olq, score)
    select new.id, new.user_id, key, value::numeric
    from jsonb_each_text(new.assessment->'olq');
  end if;
  return new;
end $$;

drop trigger if exists sessions_sync_olq on public.sessions;
create trigger sessions_sync_olq
  after insert or update of assessment on public.sessions
  for each row execute function public.sync_olq_scores();

-- ---------- overall_reports (latest overall assessment per candidate) ----------
create table if not exists public.overall_reports (
  user_id     uuid primary key default auth.uid() references auth.users(id) on delete cascade,
  report      jsonb not null,
  updated_at  timestamptz not null default now()
);

-- ---------- Row Level Security ----------
alter table public.profiles        enable row level security;
alter table public.sessions        enable row level security;
alter table public.olq_scores      enable row level security;
alter table public.overall_reports enable row level security;

drop policy if exists "own profile read"   on public.profiles;
drop policy if exists "own profile update" on public.profiles;
create policy "own profile read"   on public.profiles for select using (id = (select auth.uid()));
create policy "own profile update" on public.profiles for update using (id = (select auth.uid())) with check (id = (select auth.uid()));

-- users may only change these profile columns (never chest_no, email or id)
revoke update on public.profiles from authenticated, anon;
grant  update (name, entry, start_date) on public.profiles to authenticated;

drop policy if exists "own sessions" on public.sessions;
create policy "own sessions" on public.sessions for all using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

drop policy if exists "own olq" on public.olq_scores;
create policy "own olq" on public.olq_scores for all using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

drop policy if exists "own overall" on public.overall_reports;
create policy "own overall" on public.overall_reports for all using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

-- ---------- admin view (use from the Supabase dashboard / service role only) ----------
create or replace view public.candidate_summary with (security_invoker = true) as
select p.chest_no, p.name, p.email, p.entry, p.start_date,
       count(s.id)                  as tests_taken,
       round(avg(s.overall), 1)     as avg_score,
       max(s.created_at)            as last_test_at
from public.profiles p
left join public.sessions s on s.user_id = p.id
group by p.id
order by p.chest_no;

-- ---------- hardening (applied as a second migration) ----------
revoke execute on function public.handle_new_user() from public, anon, authenticated;
revoke execute on function public.sync_olq_scores() from public, anon;
revoke all on public.candidate_summary from anon, authenticated;
