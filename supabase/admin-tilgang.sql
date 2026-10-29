-- ============================================================
--  Logichain · Admin-tilgang (Einar kan skrive til alle kunder)
--  Kjør i SQL Editor → Run
-- ============================================================

-- 1) Admin-flagg
alter table kunder add column if not exists admin boolean not null default false;
update kunder set admin = true where epost = 'einar.fredriksen@macgregor.com';

-- 2) Lese-policy: egen kunde ELLER admin (ser alle)
drop policy if exists "lev_read" on leverandorer;
create policy "lev_read" on leverandorer for select using (
  kunde_id in (select id from kunder where user_id = auth.uid())
  or exists (select 1 from kunder where user_id = auth.uid() and admin)
);
drop policy if exists "mat_read" on materialer;
create policy "mat_read" on materialer for select using (
  kunde_id in (select id from kunder where user_id = auth.uid())
  or exists (select 1 from kunder where user_id = auth.uid() and admin)
);
drop policy if exists "po_read" on po_linjer;
create policy "po_read" on po_linjer for select using (
  kunde_id in (select id from kunder where user_id = auth.uid())
  or exists (select 1 from kunder where user_id = auth.uid() and admin)
);

-- 3) Skrive-policy: kun admin kan sette inn / slette
drop policy if exists "lev_write" on leverandorer;
create policy "lev_write" on leverandorer for insert with check (
  exists (select 1 from kunder where user_id = auth.uid() and admin)
);
drop policy if exists "lev_del" on leverandorer;
create policy "lev_del" on leverandorer for delete using (
  exists (select 1 from kunder where user_id = auth.uid() and admin)
);
drop policy if exists "mat_write" on materialer;
create policy "mat_write" on materialer for insert with check (
  exists (select 1 from kunder where user_id = auth.uid() and admin)
);
drop policy if exists "mat_del" on materialer;
create policy "mat_del" on materialer for delete using (
  exists (select 1 from kunder where user_id = auth.uid() and admin)
);
drop policy if exists "po_write" on po_linjer;
create policy "po_write" on po_linjer for insert with check (
  exists (select 1 from kunder where user_id = auth.uid() and admin)
);
drop policy if exists "po_del" on po_linjer;
create policy "po_del" on po_linjer for delete using (
  exists (select 1 from kunder where user_id = auth.uid() and admin)
);

-- Flere admin-brukere senere:
-- update kunder set admin = true where epost = 'ny.admin@epost.no';
