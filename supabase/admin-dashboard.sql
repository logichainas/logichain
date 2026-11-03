-- ============================================================
--  Logichain · Admin-dashboard (Jarvis)
--  Kjør i Supabase → SQL Editor → Run. Trygt å kjøre flere ganger.
-- ============================================================

-- 1) Hjelpefunksjon: er innlogget bruker admin?
--    (security definer så den kan brukes i policyer på kunder uten rekursjon)
create or replace function public.is_admin()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.kunder where user_id = auth.uid() and admin);
$$;
grant execute on function public.is_admin() to authenticated;

-- 2) Admin kan se alle kunderader
drop policy if exists "kunder_admin_read" on kunder;
create policy "kunder_admin_read" on kunder for select using (public.is_admin());

-- 3) Alle tall til admin-dashboardet i én spørring
create or replace function public.admin_overview()
returns json language plpgsql stable security definer set search_path = public as $$
begin
  if not public.is_admin() then
    raise exception 'Ingen tilgang';
  end if;
  return json_build_object(
    'generert', now(),
    'totalt', json_build_object(
      'kunder',        (select count(*) from kunder where portal is distinct from 'admin.html'),
      'po_linjer',     (select count(*) from po_linjer),
      'spend',         (select coalesce(sum(verdi),0) from po_linjer),
      'leverandorer',  (select count(*) from leverandorer),
      'materialer',    (select count(*) from materialer),
      'levert',        (select count(*) from po_linjer where leveringsdato is not null and love_dato is not null),
      'i_tide',        (select count(*) from po_linjer where leveringsdato is not null and love_dato is not null
                          and abs(leveringsdato - love_dato) <= 5),
      'apne',          (select count(*) from po_linjer where leveringsdato is null),
      'brukere',       (select count(*) from auth.users),
      'innlogget_7d',  (select count(*) from auth.users where last_sign_in_at > now() - interval '7 days'),
      'nye_innleveringer', (select count(*) from innleveringer where status = 'ny')
    ),
    'kunder', (select coalesce(json_agg(k order by k.spend desc), '[]'::json) from (
      select ku.id, ku.firma, ku.epost, ku.portal, ku.admin, ku.opprettet,
             u.last_sign_in_at as sist_innlogget,
             count(p.id) as po_linjer,
             coalesce(sum(p.verdi),0) as spend,
             count(p.id) filter (where p.leveringsdato is not null and p.love_dato is not null) as levert,
             count(p.id) filter (where p.leveringsdato is not null and p.love_dato is not null
                                   and abs(p.leveringsdato - p.love_dato) <= 5) as i_tide,
             count(p.id) filter (where p.leveringsdato is null) as apne,
             (select count(*) from leverandorer l where l.kunde_id = ku.id) as leverandorer,
             (select max(mottatt) from innleveringer i where i.kunde_id = ku.id) as siste_innlevering
        from kunder ku
        left join auth.users u on u.id = ku.user_id
        left join po_linjer p on p.kunde_id = ku.id
       group by ku.id, u.last_sign_in_at) k),
    'innleveringer', (select coalesce(json_agg(x), '[]'::json) from (
      select i.id, i.fil, i.rader, i.spend, i.status, i.mottatt, ku.firma
        from innleveringer i join kunder ku on ku.id = i.kunde_id
       order by i.mottatt desc limit 15) x),
    'spend_mnd', (select coalesce(json_agg(x order by x.mnd), '[]'::json) from (
      select to_char(date_trunc('month', bestillingsdato), 'YYYY-MM') as mnd,
             sum(verdi) as spend, count(*) as linjer
        from po_linjer where bestillingsdato is not null
       group by 1) x),
    'forsinket_lev', (select coalesce(json_agg(x), '[]'::json) from (
      select l.navn, ku.firma, count(*) as sene, round(avg(p.leveringsdato - p.love_dato), 1) as snitt_dager
        from po_linjer p
        join leverandorer l on l.id = p.leverandor_id
        join kunder ku on ku.id = p.kunde_id
       where p.leveringsdato - p.love_dato > 5
       group by l.navn, ku.firma
       order by count(*) desc limit 6) x)
  );
end;
$$;
revoke all on function public.admin_overview() from public, anon;
grant execute on function public.admin_overview() to authenticated;

-- 4) Ny admin-bruker (opprett den først: Authentication → Users → Add user, huk av Auto Confirm)
update kunder
   set admin = true, portal = 'admin.html', firma = 'Logichain'
 where epost = 'einar@logichain.no';
