-- ============================================================
--  Logichain · Agent pipeline: Nora → Planner → approval → dashboard
--  Run in Supabase → SQL Editor. Safe to run multiple times.
--  Requires admin-dashboard.sql (public.is_admin()).
-- ============================================================

-- One row per incoming Excel file, tracking it through the pipeline
create table if not exists analysis_runs (
  id bigint generated always as identity primary key,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  status text not null default 'analysing'
    check (status in ('analysing','report_ready','planning','awaiting_approval','applying','applied','rejected','failed')),
  file_name text,
  sender text,
  subject text,
  source_file_id text,
  nora_session_id text unique,
  nora_report_file_id text,
  nora_report_name text,
  planner_session_id text unique,
  proposal jsonb,
  proposal_summary text,
  kunde_id uuid references kunder(id) on delete set null,
  decided_by uuid,
  decided_at timestamptz,
  applied_at timestamptz,
  apply_result jsonb,
  error text
);
create index if not exists analysis_runs_status_idx on analysis_runs (status, created_at desc);

alter table analysis_runs enable row level security;
drop policy if exists "runs_admin_read" on analysis_runs;
create policy "runs_admin_read" on analysis_runs for select using (public.is_admin());
-- (writes happen only from Edge Functions with the service role key)

-- Nora's findings shown in the customer dashboard (only after approval)
create table if not exists dashboard_insights (
  id bigint generated always as identity primary key,
  kunde_id uuid not null references kunder(id) on delete cascade,
  run_id bigint references analysis_runs(id) on delete set null,
  published_at timestamptz not null default now(),
  title text not null,
  summary text,
  savings_low numeric,
  savings_high numeric,
  currency text default 'NOK',
  findings jsonb not null default '[]'::jsonb,
  actions jsonb not null default '[]'::jsonb,
  data_quality jsonb not null default '[]'::jsonb
);
create index if not exists dashboard_insights_kunde_idx on dashboard_insights (kunde_id, published_at desc);

alter table dashboard_insights enable row level security;
drop policy if exists "insights_read_own" on dashboard_insights;
create policy "insights_read_own" on dashboard_insights for select using (
  kunde_id in (select id from kunder where user_id = auth.uid()) or public.is_admin()
);
