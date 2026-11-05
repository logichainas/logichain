-- Logichain · keep Einar's own visits out of the SITE TRAFFIC numbers in Jarvis.
-- When Jarvis is opened, the browser logs a marker visit with path '__admin'. The visitor code is a daily hash of
-- network + browser, so every visit from the same device and network that day is treated as "me" and excluded.
-- Safe to run more than once.

create or replace function public.visit_stats(p_days int default 14)
returns table(day date, visitors bigint, views bigint) language plpgsql security definer set search_path = public as $$
declare today date := (now() at time zone 'Europe/Oslo')::date; n int := least(greatest(coalesce(p_days, 14), 1), 90);
begin
  if not public.is_admin() then raise exception 'not allowed'; end if;
  return query
    with me as (select distinct m.day, m.visitor from public.site_visits m where m.path = '__admin')
    select d::date, count(distinct v.visitor), count(v.id)
    from generate_series(today - (n - 1), today, interval '1 day') d
    left join public.site_visits v on v.day = d::date and v.path <> '__admin'
      and not exists (select 1 from me where me.day = v.day and me.visitor = v.visitor)
    group by d order by d;
end $$;

create or replace function public.visit_top(p_days int default 7)
returns table(kind text, label text, visitors bigint) language plpgsql security definer set search_path = public as $$
declare since date := (now() at time zone 'Europe/Oslo')::date - (least(greatest(coalesce(p_days, 7), 1), 90) - 1);
begin
  if not public.is_admin() then raise exception 'not allowed'; end if;
  return query
    with me as (select distinct m.day, m.visitor from public.site_visits m where m.path = '__admin'),
    v as (select s.* from public.site_visits s where s.day >= since and s.path <> '__admin'
          and not exists (select 1 from me where me.day = s.day and me.visitor = s.visitor))
    (select 'source'::text, coalesce(v.referrer, 'Direct'), count(distinct v.visitor) from v group by 2 order by 3 desc limit 5)
    union all
    (select 'page'::text, v.path, count(distinct v.visitor) from v group by 2 order by 3 desc limit 5)
    union all
    (select 'country'::text, coalesce(v.country, '??'), count(distinct v.visitor) from v group by 2 order by 3 desc limit 5);
end $$;
