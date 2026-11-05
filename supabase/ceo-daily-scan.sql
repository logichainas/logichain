-- Logichain · CEO daily market scan at 23:00 Oslo time
-- Needs the Edge Function "ceo-daily-scan" deployed (with "Verify JWT" turned off – it checks its own secret).
-- Safe to run more than once.

create extension if not exists pg_cron;
create extension if not exists pg_net;

-- secret shared between the cron job and the Edge Function (never leaves the database)
create schema if not exists private;
create table if not exists private.app_secrets (name text primary key, value text not null);
insert into private.app_secrets(name, value)
values ('ceo_cron', replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', ''))
on conflict (name) do nothing;

create or replace function public.check_app_secret(p_name text, p_value text)
returns boolean language sql security definer set search_path = private, public as $$
  select exists (select 1 from private.app_secrets where name = p_name and value = p_value);
$$;
revoke all on function public.check_app_secret(text, text) from public, anon, authenticated;
grant execute on function public.check_app_secret(text, text) to service_role;

-- one run per day
create table if not exists public.ceo_daily_runs (
  day        date primary key,
  session_id text,
  created_at timestamptz not null default now()
);
alter table public.ceo_daily_runs enable row level security;   -- no policies: only the Edge Function (service role) uses it

-- schedule: 21:00 and 22:00 UTC; the function only acts when it is 23:00 in Oslo (summer and winter time)
select cron.unschedule(jobid) from cron.job where jobname = 'ceo-daily-scan';
select cron.schedule('ceo-daily-scan', '0 21,22 * * *', $job$
  select net.http_post(
    url := 'https://iksnoymoqvweudilfuzy.supabase.co/functions/v1/ceo-daily-scan',
    headers := jsonb_build_object('Content-Type', 'application/json',
                                  'x-cron-secret', (select value from private.app_secrets where name = 'ceo_cron')),
    body := '{}'::jsonb,
    timeout_milliseconds := 30000
  );
$job$);
