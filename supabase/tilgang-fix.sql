-- ============================================================
--  Logichain · Tilgangsstramming + innleveringsflyt
--  Kunder kan KUN lese data og SENDE innleveringer.
--  Kun Logichain (Einar via SQL) skriver dashboard-data.
-- ============================================================

-- 1) Fjern skriverettigheter fra kunder på dashboard-data
drop policy if exists "lev_own" on leverandorer;
create policy "lev_read" on leverandorer for select
  using (kunde_id in (select id from kunder where user_id = auth.uid()));

drop policy if exists "mat_own" on materialer;
create policy "mat_read" on materialer for select
  using (kunde_id in (select id from kunder where user_id = auth.uid()));

drop policy if exists "po_own" on po_linjer;
create policy "po_read" on po_linjer for select
  using (kunde_id in (select id from kunder where user_id = auth.uid()));

-- 2) Innleveringer: kunder sender filer til karantene
create table if not exists innleveringer (
  id uuid primary key default gen_random_uuid(),
  kunde_id uuid not null references kunder(id) on delete cascade,
  fil text not null,
  rader int,
  spend numeric,
  status text not null default 'ny',
  mottatt timestamptz not null default now()
);
alter table innleveringer enable row level security;
drop policy if exists "inn_insert" on innleveringer;
create policy "inn_insert" on innleveringer for insert to authenticated
  with check (kunde_id in (select id from kunder where user_id = auth.uid()));
drop policy if exists "inn_select" on innleveringer;
create policy "inn_select" on innleveringer for select
  using (kunde_id in (select id from kunder where user_id = auth.uid()));

-- 3) Lager for innleveringsfiler (privat)
insert into storage.buckets (id, name, public)
values ('innleveringer', 'innleveringer', false)
on conflict (id) do nothing;

drop policy if exists "inn_up" on storage.objects;
create policy "inn_up" on storage.objects for insert to authenticated
  with check (bucket_id = 'innleveringer'
    and (storage.foldername(name))[1] in
      (select id::text from kunder where user_id = auth.uid()));
