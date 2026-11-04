-- Logichain · people who opened the demo (name, e-mail, company)
-- Written only through /api/lead (Cloudflare Pages Function) via log_demo_lead(); readable only by Logichain admins.
-- Requires admin-dashboard.sql (public.is_admin()). Safe to run more than once.

create table if not exists public.demo_leads (
  id         bigint generated always as identity primary key,
  created_at timestamptz not null default now(),
  name       text not null check (char_length(name) between 2 and 120),
  email      text not null check (char_length(email) between 5 and 200),
  company    text not null check (char_length(company) between 2 and 160),
  lang       text,
  page       text,
  referrer   text,
  country    text,
  handled    boolean not null default false
);
create index if not exists demo_leads_created_idx on public.demo_leads(created_at desc);
alter table public.demo_leads enable row level security;

drop policy if exists "demo_leads_admin" on public.demo_leads;
create policy "demo_leads_admin" on public.demo_leads for all using (public.is_admin()) with check (public.is_admin());
grant select, update, delete on public.demo_leads to authenticated;

create or replace function public.log_demo_lead(p_name text, p_email text, p_company text, p_lang text, p_page text, p_referrer text, p_country text)
returns bigint language plpgsql security definer set search_path = public as $$
declare new_id bigint;
begin
  if p_email !~* '^[^@\s]+@[^@\s]+\.[^@\s]+$' then raise exception 'invalid email'; end if;
  -- simple flood guard: max 5 sign-ups per e-mail per day
  if (select count(*) from public.demo_leads where lower(email) = lower(trim(p_email)) and created_at > now() - interval '1 day') >= 5 then
    return null;
  end if;
  insert into public.demo_leads(name, email, company, lang, page, referrer, country)
  values (left(trim(p_name),120), left(lower(trim(p_email)),200), left(trim(p_company),160), left(p_lang,5), left(p_page,120), left(p_referrer,200), left(p_country,2))
  returning id into new_id;
  return new_id;
end $$;
revoke all on function public.log_demo_lead(text, text, text, text, text, text, text) from public;
grant execute on function public.log_demo_lead(text, text, text, text, text, text, text) to anon, authenticated;
