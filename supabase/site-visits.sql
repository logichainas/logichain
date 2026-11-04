-- Logichain · simple, cookie-free visitor statistics for logichain.no
-- Visitors are counted with a daily anonymous code (hash of IP + browser + date + secret salt, made in the
-- Cloudflare function). No IP addresses, cookies or personal data are stored. Only admins can read the numbers.
-- Requires admin-dashboard.sql (public.is_admin()). Safe to run more than once.

create table if not exists public.site_visits (
  id         bigint generated always as identity primary key,
  day        date not null default (now() at time zone 'Europe/Oslo')::date,
  visitor    text not null,
  path       text,
  referrer   text,
  country    text,
  created_at timestamptz not null default now()
);
create index if not exists site_visits_day_idx on public.site_visits(day);
alter table public.site_visits enable row level security;   -- no policies: access only through the functions below

-- called by /api/hit (Cloudflare Pages Function) with the public key
create or replace function public.log_visit(p_visitor text, p_path text, p_referrer text, p_country text)
returns void language plpgsql security definer set search_path = public as $$
begin
  if p_visitor is null or p_visitor !~ '^[0-9a-f]{16,64}$' then return; end if;
  insert into public.site_visits(visitor, path, referrer, country)
  values (p_visitor, left(coalesce(nullif(p_path, ''), '/'), 200), nullif(left(coalesce(p_referrer, ''), 200), ''), nullif(left(coalesce(p_country, ''), 2), ''));
  -- keep roughly 13 months
  delete from public.site_visits where day < (now() at time zone 'Europe/Oslo')::date - 400 and random() < 0.01;
end $$;
revoke all on function public.log_visit(text, text, text, text) from public;
grant execute on function public.log_visit(text, text, text, text) to anon, authenticated;

-- unique visitors and page views per day (admin only)
create or replace function public.visit_stats(p_days int default 14)
returns table(day date, visitors bigint, views bigint) language plpgsql security definer set search_path = public as $$
declare today date := (now() at time zone 'Europe/Oslo')::date; n int := least(greatest(coalesce(p_days, 14), 1), 90);
begin
  if not public.is_admin() then raise exception 'not allowed'; end if;
  return query
    select d::date, count(distinct v.visitor), count(v.id)
    from generate_series(today - (n - 1), today, interval '1 day') d
    left join public.site_visits v on v.day = d::date
    group by d order by d;
end $$;
revoke all on function public.visit_stats(int) from public;
grant execute on function public.visit_stats(int) to authenticated;

-- where visitors come from and what they look at (admin only)
create or replace function public.visit_top(p_days int default 7)
returns table(kind text, label text, visitors bigint) language plpgsql security definer set search_path = public as $$
declare since date := (now() at time zone 'Europe/Oslo')::date - (least(greatest(coalesce(p_days, 7), 1), 90) - 1);
begin
  if not public.is_admin() then raise exception 'not allowed'; end if;
  return query
    (select 'source'::text, coalesce(referrer, 'Direct'), count(distinct visitor) from public.site_visits where day >= since group by 2 order by 3 desc limit 5)
    union all
    (select 'page'::text, path, count(distinct visitor) from public.site_visits where day >= since group by 2 order by 3 desc limit 5)
    union all
    (select 'country'::text, coalesce(country, '??'), count(distinct visitor) from public.site_visits where day >= since group by 2 order by 3 desc limit 5);
end $$;
revoke all on function public.visit_top(int) from public;
grant execute on function public.visit_top(int) to authenticated;
