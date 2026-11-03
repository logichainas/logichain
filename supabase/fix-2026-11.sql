-- ============================================================
--  Logichain · Rettelser november 2026
--  Kjør i Supabase → SQL Editor → New query → Run.
--  Trygt å kjøre flere ganger (idempotent).
--  Forutsetter at setup.sql, data-schema.sql, tilgang-fix.sql
--  og admin-tilgang.sql allerede er kjørt.
-- ============================================================

-- 1) Portal-kolonne: innloggingen på forsiden leser "portal" for å
--    sende kunden til riktig dashboard. Kolonnen fantes ikke, så
--    spørringen feilet og alle havnet i demoen.
alter table kunder add column if not exists portal text;
update kunder set portal = 'macgregor-dashboard.html'
  where seed = 4211 and portal is null;

-- 2) Admin kan se alle innleveringer og oppdatere status
drop policy if exists "inn_admin_select" on innleveringer;
create policy "inn_admin_select" on innleveringer for select using (
  exists (select 1 from kunder where user_id = auth.uid() and admin)
);
drop policy if exists "inn_admin_update" on innleveringer;
create policy "inn_admin_update" on innleveringer for update using (
  exists (select 1 from kunder where user_id = auth.uid() and admin)
);

-- 3) Lagring: kunden kan lese egne filer, admin kan lese/slette alle
drop policy if exists "inn_read_own" on storage.objects;
create policy "inn_read_own" on storage.objects for select to authenticated
  using (bucket_id = 'innleveringer'
    and (storage.foldername(name))[1] in
      (select id::text from public.kunder where user_id = auth.uid()));
drop policy if exists "inn_admin_read" on storage.objects;
create policy "inn_admin_read" on storage.objects for select to authenticated
  using (bucket_id = 'innleveringer'
    and exists (select 1 from public.kunder where user_id = auth.uid() and admin));
drop policy if exists "inn_admin_delete" on storage.objects;
create policy "inn_admin_delete" on storage.objects for delete to authenticated
  using (bucket_id = 'innleveringer'
    and exists (select 1 from public.kunder where user_id = auth.uid() and admin));

-- 4) Fjern gamle skrive-policyer hvis data-schema.sql er kjørt på nytt
--    (de ga kundene skrivetilgang til egne data).
drop policy if exists "lev_own" on leverandorer;
drop policy if exists "mat_own" on materialer;
drop policy if exists "po_own"  on po_linjer;

-- 5) Rydd opp duplikater fra den gamle importfeilen
--    (last-opp.html opprettet leverandører/materialer på nytt ved hver import).
--    Sjekk først hvor mange det gjelder:
--      select kunde_id, lower(navn), count(*) from leverandorer group by 1,2 having count(*)>1;
--      select kunde_id, lower(kode), count(*) from materialer  group by 1,2 having count(*)>1;
--      select kunde_id, upper(po), linjenr, count(*) from po_linjer group by 1,2,3 having count(*)>1;

-- 5a) Leverandører: pek PO-linjer til laveste id, slett resten
with keep as (
  select id, min(id) over (partition by kunde_id, lower(navn)) as keep_id from leverandorer
)
update po_linjer p set leverandor_id = k.keep_id
  from keep k where p.leverandor_id = k.id and k.id <> k.keep_id;
delete from leverandorer l using (
  select id, min(id) over (partition by kunde_id, lower(navn)) as keep_id from leverandorer
) k where l.id = k.id and k.id <> k.keep_id;

-- 5b) Materialer: samme fremgangsmåte
with keep as (
  select id, min(id) over (partition by kunde_id, lower(kode)) as keep_id from materialer
)
update po_linjer p set material_id = k.keep_id
  from keep k where p.material_id = k.id and k.id <> k.keep_id;
delete from materialer m using (
  select id, min(id) over (partition by kunde_id, lower(kode)) as keep_id from materialer
) k where m.id = k.id and k.id <> k.keep_id;

-- 5c) PO-linjer: behold første forekomst av samme PO + linjenr
delete from po_linjer p using (
  select id, min(id) over (partition by kunde_id, upper(po), linjenr) as keep_id from po_linjer
) k where p.id = k.id and k.id <> k.keep_id;

-- 6) Unike indekser så duplikater ikke kan oppstå igjen
create unique index if not exists leverandorer_kunde_navn_uq on leverandorer (kunde_id, lower(navn));
create unique index if not exists materialer_kunde_kode_uq  on materialer  (kunde_id, lower(kode));
create unique index if not exists po_linjer_kunde_po_linje_uq on po_linjer (kunde_id, upper(po), linjenr);

-- Ferdig. Ny kunde med egen portal:
--   update kunder set portal = 'kundenavn-dashboard.html' where epost = 'kunde@firma.no';
