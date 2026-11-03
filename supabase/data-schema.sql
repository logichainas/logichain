-- ============================================================
--  Logichain · Data-skjema for EKTE kundedata
--  Kjør i SQL Editor (etter setup.sql). Idempotent.
-- ============================================================

create table if not exists leverandorer (
  id bigint generated always as identity primary key,
  kunde_id uuid not null references kunder(id) on delete cascade,
  navn text not null,
  gruppe text,
  land text,
  rating text default 'C'
);

create table if not exists materialer (
  id bigint generated always as identity primary key,
  kunde_id uuid not null references kunder(id) on delete cascade,
  kode text not null,
  beskrivelse text not null,
  kategori text,
  enhet text default 'stk',
  standardpris numeric default 0
);

create table if not exists po_linjer (
  id bigint generated always as identity primary key,
  kunde_id uuid not null references kunder(id) on delete cascade,
  po text not null,
  linjenr int default 1,
  leverandor_id bigint references leverandorer(id) on delete cascade,
  material_id bigint references materialer(id) on delete cascade,
  prosjekt text,
  antall numeric default 1,
  enhet text default 'stk',
  enhetspris numeric default 0,
  verdi numeric not null,
  bestillingsdato date,
  love_dato date,
  leveringsdato date
);

-- RLS: kunder kan KUN lese egne rader. Skriving gjøres av admin
-- (se admin-tilgang.sql). Ingen "for all"-policyer her – de ga kundene skrivetilgang.
alter table leverandorer enable row level security;
alter table materialer  enable row level security;
alter table po_linjer   enable row level security;

drop policy if exists "lev_own" on leverandorer;
drop policy if exists "mat_own" on materialer;
drop policy if exists "po_own"  on po_linjer;

drop policy if exists "lev_read" on leverandorer;
create policy "lev_read" on leverandorer for select
  using (kunde_id in (select id from kunder where user_id = auth.uid()));
drop policy if exists "mat_read" on materialer;
create policy "mat_read" on materialer for select
  using (kunde_id in (select id from kunder where user_id = auth.uid()));
drop policy if exists "po_read" on po_linjer;
create policy "po_read" on po_linjer for select
  using (kunde_id in (select id from kunder where user_id = auth.uid()));

-- Kjør admin-tilgang.sql og fix-2026-11.sql etterpå (admin-lesing, skriving og unike indekser).
