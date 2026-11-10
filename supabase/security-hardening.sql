-- ============================================================
--  Logichain · Security hardening (November 2026)
--  Run in Supabase → SQL Editor → Run. Safe to run more than once.
-- ============================================================

-- 1) Admin may UPDATE supplier rows (needed so uploads can fill in the supplier number).
--    Customers still cannot write anything to dashboard data.
drop policy if exists "lev_admin_update" on public.leverandorer;
create policy "lev_admin_update" on public.leverandorer for update to authenticated
  using (public.is_admin()) with check (public.is_admin());

-- 2) The sign-up trigger runs with elevated rights: pin its search_path so it cannot be hijacked.
create or replace function public.handle_new_kunde()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.kunder (user_id, epost, firma, seed)
  values (new.id, new.email, split_part(new.email,'@',1), floor(random()*9000+1000)::bigint)
  on conflict (user_id) do nothing;
  return new;
end;
$$;
revoke execute on function public.handle_new_kunde() from public, anon, authenticated;

-- 3) Visitors without a login (the public "anon" key) never need direct table access:
--    the website only uses log_visit() and log_demo_lead(). Remove the default grants
--    so a future table can never be exposed by a missing RLS policy.
revoke all on all tables in schema public from anon;
revoke all on all sequences in schema public from anon;
alter default privileges in schema public revoke all on tables from anon;
alter default privileges in schema public revoke all on sequences from anon;

-- 4) Demo sign-up form: also cap the total per hour, so random e-mail addresses cannot flood
--    the lead list (and the e-mail notifications). Over the cap the form still says "ok".
create or replace function public.log_demo_lead(p_name text, p_email text, p_company text, p_lang text, p_page text, p_referrer text, p_country text)
returns bigint language plpgsql security definer set search_path = public as $$
declare new_id bigint;
begin
  if p_email !~* '^[^@\s]+@[^@\s]+\.[^@\s]+$' then raise exception 'invalid email'; end if;
  if (select count(*) from public.demo_leads where lower(email) = lower(trim(p_email)) and created_at > now() - interval '1 day') >= 5 then
    return null;
  end if;
  if (select count(*) from public.demo_leads where created_at > now() - interval '1 hour') >= 30 then
    return null;
  end if;
  insert into public.demo_leads(name, email, company, lang, page, referrer, country)
  values (left(regexp_replace(trim(p_name), '[<>]', '', 'g'),120), left(lower(trim(p_email)),200),
          left(regexp_replace(trim(p_company), '[<>]', '', 'g'),160), left(p_lang,5), left(p_page,120), left(p_referrer,200), left(p_country,2))
  returning id into new_id;
  return new_id;
end $$;
revoke all on function public.log_demo_lead(text, text, text, text, text, text, text) from public;
grant execute on function public.log_demo_lead(text, text, text, text, text, text, text) to anon, authenticated;

-- 5) Visit counter: cap writes per visitor code per day so the public function cannot be used to flood the table.
create or replace function public.log_visit(p_visitor text, p_path text, p_referrer text, p_country text)
returns void language plpgsql security definer set search_path = public as $$
begin
  if p_visitor is null or p_visitor !~ '^[0-9a-f]{16,64}$' then return; end if;
  if (select count(*) from public.site_visits where visitor = p_visitor and day = (now() at time zone 'Europe/Oslo')::date) >= 200 then return; end if;
  insert into public.site_visits(visitor, path, referrer, country)
  values (p_visitor, left(coalesce(nullif(p_path, ''), '/'), 200), nullif(left(coalesce(p_referrer, ''), 200), ''), nullif(left(coalesce(p_country, ''), 2), ''));
  delete from public.site_visits where day < (now() at time zone 'Europe/Oslo')::date - 400 and random() < 0.01;
end $$;
revoke all on function public.log_visit(text, text, text, text) from public;
grant execute on function public.log_visit(text, text, text, text) to anon, authenticated;

-- 6) Read-only helpers for logged-in admins only (they already check is_admin() inside).
revoke execute on function public.visit_stats(int) from anon;
revoke execute on function public.visit_top(int) from anon;
