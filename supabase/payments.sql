-- SSB Psych Lab · ₹300 full-program pass, paid by UPI and approved by hand in HQ.
-- Part 1 (this file) only ADDS objects, so it is safe to apply before the feature is live.
-- Part 2 (payments_enforce.sql) locks the server down and is applied when the branch is merged.

-- Launch offer: the first 100 passes (approved or awaiting approval) are ₹300; after that the regular ₹999 applies.
insert into private.settings(key, value) values ('pass_price', '300'), ('pass_regular_price', '999'), ('launch_seats', '100')
  on conflict (key) do nothing;

create table if not exists public.payments (
  id          bigint generated always as identity primary key,
  user_id     uuid not null references auth.users(id) on delete cascade,
  amount      integer not null,
  utr         text not null,
  status      text not null default 'pending' check (status in ('pending','approved','rejected')),
  note        text,
  created_at  timestamptz not null default now(),
  reviewed_at timestamptz,
  reviewed_by uuid
);
-- a UTR can only be used once, unless that claim was rejected
create unique index if not exists payments_utr_live on public.payments (utr) where status <> 'rejected';
create index if not exists payments_user on public.payments (user_id, created_at desc);
alter table public.payments enable row level security;
drop policy if exists "own payments" on public.payments;
create policy "own payments" on public.payments for select to authenticated using (user_id = (select auth.uid()));
-- no insert/update policy: candidates write through submit_payment(), admins through admin_review_payment()

create or replace function private.has_pass(uid uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.payments where user_id = uid and status = 'approved');
$$;

-- Current offer, counted from real payments. Public, so the landing page can show it.
create or replace function private.pass_offer() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare launch int := coalesce((select value from private.settings where key = 'pass_price')::int, 300);
        regular int := coalesce((select value from private.settings where key = 'pass_regular_price')::int, launch);
        seats int := coalesce((select value from private.settings where key = 'launch_seats')::int, 0);
        used int := (select count(*) from public.payments where status in ('approved','pending'));
        lft int := greatest(seats - used, 0);
begin
  return jsonb_build_object('price', case when lft > 0 then launch else regular end, 'regular', regular, 'launch_price', launch,
    'seats', seats, 'left', lft, 'launch', lft > 0);
end $$;
create or replace function public.pass_offer() returns jsonb
language sql stable security definer set search_path = '' as $$ select private.pass_offer(); $$;

-- What the app needs to know about the signed-in candidate's pass
create or replace function public.my_pass() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare uid uuid := auth.uid(); p record; offer jsonb := private.pass_offer();
begin
  if uid is null then raise exception 'not signed in'; end if;
  if private.has_pass(uid) then
    select * into p from public.payments where user_id = uid and status = 'approved' order by reviewed_at desc nulls last limit 1;
    return offer || jsonb_build_object('status','paid','paid_amount',p.amount,'since',p.reviewed_at);
  end if;
  select * into p from public.payments where user_id = uid order by created_at desc limit 1;
  if not found then return offer || jsonb_build_object('status','none'); end if;
  -- a claim keeps the price it was made at
  return offer || jsonb_build_object('status', p.status, 'price', p.amount, 'utr', p.utr, 'note', p.note, 'submitted', p.created_at);
end $$;

-- Candidate submits the UPI reference (UTR) after paying
create or replace function public.submit_payment(p_utr text) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare uid uuid := auth.uid(); u text := regexp_replace(coalesce(p_utr,''), '\s', '', 'g'); price int;
begin
  if uid is null then raise exception 'not signed in'; end if;
  if u !~ '^[0-9]{12}$' then raise exception 'utr_format' using hint = 'The UPI reference (UTR) is a 12-digit number.'; end if;
  if private.has_pass(uid) then raise exception 'already_paid'; end if;
  if exists (select 1 from public.payments where user_id = uid and status = 'pending') then raise exception 'already_pending'; end if;
  if (select count(*) from public.payments where user_id = uid and created_at > now() - interval '1 day') >= 5 then raise exception 'too_many'; end if;
  if exists (select 1 from public.payments where utr = u and status <> 'rejected') then raise exception 'utr_used'; end if;
  price := (private.pass_offer()->>'price')::int;
  insert into public.payments(user_id, amount, utr) values (uid, price, u);
  return public.my_pass();
end $$;

-- HQ: every payment claim, newest first, pending on top
create or replace function public.admin_payments() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  if not public.is_admin() then raise exception 'not allowed'; end if;
  return coalesce((select jsonb_agg(r order by (r->>'status') <> 'pending', r->>'created_at' desc) from (
    select jsonb_build_object('id', pm.id, 'utr', pm.utr, 'amount', pm.amount, 'status', pm.status, 'note', pm.note,
      'created_at', pm.created_at, 'reviewed_at', pm.reviewed_at, 'user_id', pm.user_id,
      'name', pr.name, 'email', pr.email, 'chest', pr.chest_no) r
    from public.payments pm left join public.profiles pr on pr.id = pm.user_id) x), '[]'::jsonb);
end $$;

-- HQ: approve or reject a claim after checking the bank app
create or replace function public.admin_review_payment(pid bigint, approve boolean, reason text default null) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare p record;
begin
  if not public.is_admin() then raise exception 'not allowed'; end if;
  select * into p from public.payments where id = pid for update;
  if not found then raise exception 'not found'; end if;
  update public.payments set status = case when approve then 'approved' else 'rejected' end,
    note = nullif(trim(coalesce(reason,'')), ''), reviewed_at = now(), reviewed_by = auth.uid() where id = pid;
  return public.admin_payments();
end $$;

-- Email ssbpsychlab@gmail.com when a candidate submits a payment
create or replace function private.email_payment() returns trigger
language plpgsql security definer set search_path = '' as $$
declare to_addr text := (select value from private.settings where key = 'feedback_email');
        site text := (select value from private.settings where key = 'site_url');
        rkey text; p record; subj text; body text;
begin
  select name, email, chest_no into p from public.profiles where id = new.user_id;
  subj := 'Payment to verify · Chest ' || coalesce(p.chest_no::text,'-') || ' · ₹' || new.amount || ' · UTR ' || new.utr;
  body := '<h2 style="font-family:sans-serif">New ₹' || new.amount || ' pass payment</h2><p style="font-family:sans-serif;font-size:14px">'
       || 'Name: <b>' || replace(replace(coalesce(p.name,''),'&','&amp;'),'<','&lt;') || '</b><br>Chest no: ' || coalesce(p.chest_no::text,'-')
       || '<br>Email: ' || coalesce(p.email,'') || '<br>UTR: <b>' || new.utr || '</b><br><br>'
       || 'Find this UTR in your bank or UPI app, then approve or reject it in HQ → Payments: ' || coalesce(rtrim(site,'/'),'') || '/admin.html</p>';
  begin select decrypted_secret into rkey from vault.decrypted_secrets where name = 'resend_api_key' limit 1;
  exception when others then rkey := null; end;
  if rkey is not null and rkey <> '' then
    perform net.http_post(url := 'https://api.resend.com/emails',
      headers := jsonb_build_object('Content-Type','application/json','Authorization','Bearer ' || rkey),
      body := jsonb_build_object('from','SSB Psych Lab <onboarding@resend.dev>','to', jsonb_build_array(to_addr), 'subject', subj, 'html', body),
      timeout_milliseconds := 15000);
  else
    perform net.http_post(url := 'https://formsubmit.co/ajax/' || to_addr,
      headers := jsonb_build_object('Content-Type','application/json','Accept','application/json','Origin', rtrim(site,'/'),'Referer', site),
      body := jsonb_build_object('Name', coalesce(p.name,''), 'Chest No', coalesce(p.chest_no::text,''), 'Email', coalesce(p.email,''),
        'UTR', new.utr, 'Amount', new.amount, 'Next step', 'Approve or reject in HQ → Payments', '_subject', subj, '_template','table','_captcha','false'),
      timeout_milliseconds := 60000);
  end if;
  return new;
exception when others then return new;   -- never block a payment claim because the email failed
end $$;
drop trigger if exists payment_email on public.payments;
create trigger payment_email after insert on public.payments for each row execute function private.email_payment();

revoke all on function public.my_pass(), public.submit_payment(text), public.admin_payments(), public.admin_review_payment(bigint, boolean, text) from public, anon;
grant execute on function public.my_pass(), public.submit_payment(text), public.admin_payments(), public.admin_review_payment(bigint, boolean, text) to authenticated;
revoke all on function private.has_pass(uuid), private.pass_offer() from public, anon, authenticated;
grant execute on function public.pass_offer() to anon, authenticated;
