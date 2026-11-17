create or replace function public.admin_overview(days int default 30)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  today date := (now() at time zone 'Asia/Kolkata')::date;
  d0 date := ((now() at time zone 'Asia/Kolkata')::date - (greatest(days,1) - 1));
  res jsonb;
begin
  if not public.is_admin() then raise exception 'not authorised' using errcode = '42501'; end if;
  select jsonb_build_object(
    'generated_at', now(),
    'totals', jsonb_build_object(
      'candidates',     (select count(*) from public.profiles),
      'new_7d',         (select count(*) from public.profiles where created_at > now() - interval '7 days'),
      'active_today',   (select count(distinct user_id) from public.sessions where date = today),
      'active_7d',      (select count(distinct user_id) from public.sessions where date > today - 7),
      'tests',          (select count(*) from public.sessions),
      'tests_today',    (select count(*) from public.sessions where date = today),
      'avg_score',      (select round(avg(overall),1) from public.sessions),
      'completion',     (select round(100.0 * sum((select count(*) from jsonb_array_elements_text(s.responses) r where btrim(r) <> '')) / nullif(sum(s.count),0), 0) from public.sessions s),
      'minutes',        (select coalesce(round(sum(time_used)/60.0),0) from public.sessions),
      'views',          (select count(*) from public.page_views),
      'views_today',    (select count(*) from public.page_views where (created_at at time zone 'Asia/Kolkata')::date = today),
      'visitors',       (select count(distinct visitor_id) from public.page_views),
      'visitors_7d',    (select count(distinct visitor_id) from public.page_views where created_at > now() - interval '7 days'),
      'feedback',       (select count(*) from public.feedback),
      'avg_rating',     (select round(avg(rating),2) from public.feedback where rating is not null)),
    'daily', (select coalesce(jsonb_agg(jsonb_build_object(
        'date', g.d,
        'views',    (select count(*) from public.page_views v where (v.created_at at time zone 'Asia/Kolkata')::date = g.d),
        'visitors', (select count(distinct visitor_id) from public.page_views v where (v.created_at at time zone 'Asia/Kolkata')::date = g.d),
        'signups',  (select count(*) from public.profiles p where (p.created_at at time zone 'Asia/Kolkata')::date = g.d),
        'tat', (select count(*) from public.sessions s where s.date = g.d and s.test='tat'),
        'wat', (select count(*) from public.sessions s where s.date = g.d and s.test='wat'),
        'srt', (select count(*) from public.sessions s where s.date = g.d and s.test='srt'),
        'sd',  (select count(*) from public.sessions s where s.date = g.d and s.test='sd')) order by g.d), '[]'::jsonb)
      from (select gs::date as d from generate_series(d0::timestamp, today::timestamp, interval '1 day') gs) g),
    'by_test', (select coalesce(jsonb_object_agg(test, jsonb_build_object('n', n, 'avg', a)), '{}'::jsonb)
                from (select test, count(*) n, round(avg(overall),1) a from public.sessions group by test) t),
    'score_buckets', (select coalesce(jsonb_object_agg(b, n), '{}'::jsonb) from (
        select case when overall < 4 then 'Weak' when overall < 5.5 then 'Below average' when overall < 7 then 'Average' when overall < 8 then 'Recommendable' else 'Strong' end b, count(*) n
        from public.sessions where overall is not null group by 1) t),
    'olq', (select coalesce(jsonb_object_agg(olq, a), '{}'::jsonb) from (select olq, round(avg(score),1) a from public.olq_scores group by olq) t),
    'entries', (select coalesce(jsonb_object_agg(entry, n), '{}'::jsonb) from (select entry, count(*) n from public.profiles group by entry) t),
    'devices', (select coalesce(jsonb_object_agg(coalesce(device,'unknown'), n), '{}'::jsonb) from (select device, count(distinct visitor_id) n from public.page_views group by device) t),
    'views_by_page', (select coalesce(jsonb_object_agg(view, n), '{}'::jsonb) from (select view, count(*) n from public.page_views group by view) t),
    'referrers', (select coalesce(jsonb_agg(jsonb_build_object('ref', r, 'n', n) order by n desc), '[]'::jsonb) from (select coalesce(nullif(referrer,''),'Direct') r, count(*) n from public.page_views group by 1 order by 2 desc limit 6) t),
    'heatmap', (select coalesce(jsonb_agg(jsonb_build_object('dow', dow, 'hour', hr, 'n', n)), '[]'::jsonb) from (
        select extract(isodow from created_at at time zone 'Asia/Kolkata')::int dow, extract(hour from created_at at time zone 'Asia/Kolkata')::int hr, count(*) n
        from public.sessions group by 1,2) t),
    'ratings', (select coalesce(jsonb_object_agg(rating, n), '{}'::jsonb) from (select rating, count(*) n from public.feedback where rating is not null group by rating) t),
    'recommend', (select coalesce(jsonb_object_agg(recommend, n), '{}'::jsonb) from (select recommend, count(*) n from public.feedback where coalesce(recommend,'') <> '' group by recommend) t),
    'funnel', jsonb_build_object(
        'visitors',   (select count(distinct visitor_id) from public.page_views),
        'registered', (select count(*) from public.profiles),
        'took_1',     (select count(*) from (select user_id from public.sessions group by user_id) t),
        'took_5',     (select count(*) from (select user_id from public.sessions group by user_id having count(*) >= 5) t),
        'active_3d',  (select count(*) from (select user_id from public.sessions group by user_id having count(distinct date) >= 3) t)),
    'latest_feedback', (select coalesce(jsonb_agg(x order by x->>'created_at' desc), '[]'::jsonb) from (
        select jsonb_build_object('chest_no', f.chest_no, 'name', p.name, 'rating', f.rating, 'recommend', f.recommend, 'liked', f.liked, 'improve', f.improve, 'issues', f.issues, 'created_at', f.created_at) x
        from public.feedback f left join public.profiles p on p.id = f.user_id order by f.created_at desc limit 12) t)
  ) into res;
  return res;
end $$;
revoke all on function public.admin_overview(int) from public, anon;
grant execute on function public.admin_overview(int) to authenticated;
