-- SSB Psych Lab · Part 2 of the ₹300 pass: server-side lock.
-- Apply ONLY when feature/upi-pass is merged and live, together with deploying supabase/functions/ai-review.
-- Before this, the lock is only in the app; afterwards, saving a test from set 02–30 needs an approved payment,
-- even if someone calls the API directly. Day 1 (set 01) stays free.

alter policy "own sessions" on public.sessions
  using (user_id = (select auth.uid()))
  with check (
    user_id = (select auth.uid())
    and (set_no <= 1 or exists (select 1 from public.payments pm where pm.user_id = (select auth.uid()) and pm.status = 'approved'))
  );

-- To undo:
-- alter policy "own sessions" on public.sessions using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
