-- =====================================================================
-- SSB Psych Lab · HQ (admin dashboard) — run after schema.sql
-- Admin functions are SECURITY DEFINER but each one checks is_admin()
-- first and raises "not authorised" for everyone else.
-- =====================================================================
create schema if not exists private;
revoke all on schema private from public, anon, authenticated;

create table if not exists private.admins (user_id uuid primary key references auth.users(id) on delete cascade);
-- add an admin:  insert into private.admins select id from auth.users where email = 'you@example.com';

create or replace function public.is_admin()
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from private.admins where user_id = (select auth.uid()));
$$;
revoke all on function public.is_admin() from public, anon;
grant execute on function public.is_admin() to authenticated;

-- site impressions (one row per screen view; anonymous visitors allowed to insert, nobody can read except admins via RPC)
create table if not exists public.page_views (
  id          bigint generated always as identity primary key,
  visitor_id  text not null check (char_length(visitor_id) between 8 and 40),
  user_id     uuid default auth.uid(),
  view        text not null check (char_length(view) <= 30),
  device      text check (device in ('mobile','tablet','desktop')),
  referrer    text check (char_length(referrer) <= 120),
  created_at  timestamptz not null default now()
);
create index if not exists page_views_created on public.page_views (created_at);
alter table public.page_views enable row level security;
create policy "anyone can log a view" on public.page_views for insert to anon, authenticated
  with check (user_id is null or user_id = (select auth.uid()));
grant insert on public.page_views to anon, authenticated;

-- admin_users() and admin_user_detail(uuid): see the live database; admin_overview(int): admin_overview.sql
