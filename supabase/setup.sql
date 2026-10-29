-- ============================================================
--  Logichain · Supabase-oppsett
--  Kjør dette i Supabase Dashboard → SQL Editor → New query → Run
-- ============================================================

-- 1) Tabell for kundeprofiler (kobler innlogget bruker til firma + dataseed)
create table if not exists kunder (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null unique references auth.users on delete cascade,
  epost text not null,
  firma text not null,
  seed bigint not null default 2026,
  opprettet timestamptz not null default now()
);

-- 2) Sikkerhet: hver bruker kan kun lese sin egen rad (RLS)
alter table kunder enable row level security;

drop policy if exists "kunder_read_own" on kunder;
create policy "kunder_read_own" on kunder
  for select using (auth.uid() = user_id);

-- 3) (Valgfritt) Automatisk profil ved nye brukere:
--    oppretter kunder-rad automatisk når en bruker legges til i Auth
create or replace function public.handle_new_kunde()
returns trigger language plpgsql security definer as $$
begin
  insert into public.kunder (user_id, epost, firma, seed)
  values (new.id, new.email, split_part(new.email,'@',1), floor(random()*9000+1000)::bigint)
  on conflict (user_id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_kunde();

-- 4) Slik legger du til en kunde (etter at brukeren er opprettet i Auth):
--    Authentication -> Users -> Add user (e-post + passord, huk av Auto Confirm)
--    Profilraden opprettes automatisk av triggeren over.
--    Vil du endre firmanavn/seed senere:
--    update kunder set firma = 'Nytt Firmanavn AS', seed = 4211
--      where epost = 'kunde@firma.no';
