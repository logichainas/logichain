-- Logichain · store the supplier number (Leverandørnr) from the upload file so customers can search by it.
-- Safe to run more than once.
alter table public.leverandorer add column if not exists nummer text;
create index if not exists leverandorer_nummer_idx on public.leverandorer (kunde_id, nummer);
