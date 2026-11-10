-- Logichain · subscriptions the company pays for (tools, domain, software) – shown in Jarvis, used by Anna.
-- Admin only. Safe to run more than once.
create table if not exists public.subscriptions (
  id         bigint generated always as identity primary key,
  created_at timestamptz not null default now(),
  name       text not null check (char_length(name) between 1 and 120),
  price      numeric(12,2),
  currency   text not null default 'NOK' check (currency in ('NOK','USD','EUR','SEK','DKK','GBP')),
  cycle      text not null default 'month' check (cycle in ('month','year')),
  next_date  date,
  note       text,
  active     boolean not null default true
);
alter table public.subscriptions enable row level security;
drop policy if exists "subscriptions_admin" on public.subscriptions;
create policy "subscriptions_admin" on public.subscriptions for all using (public.is_admin()) with check (public.is_admin());
grant select, insert, update, delete on public.subscriptions to authenticated;

-- starting list (fill in price and next payment date in Jarvis)
insert into public.subscriptions(name, cycle, note)
select v.name, v.cycle, v.note from (values
  ('Claude (abonnement)', 'month', null),
  ('Anthropic API – agentene', 'month', 'bruksbasert, varierer'),
  ('Supabase', 'month', null),
  ('Cloudflare Pages', 'month', 'gratisplan?'),
  ('logichain.no – domene.no', 'year', null),
  ('Microsoft 365 – einar@logichain.no', 'month', null)
) as v(name, cycle, note)
where not exists (select 1 from public.subscriptions);
