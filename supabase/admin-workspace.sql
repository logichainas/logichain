-- ============================================================
--  Logichain · Admin workspace: to-do list + quick links
--  Run in Supabase → SQL Editor. Safe to run multiple times.
--  Requires admin-dashboard.sql (public.is_admin()).
-- ============================================================

create table if not exists admin_todos (
  id bigint generated always as identity primary key,
  text text not null,
  done boolean not null default false,
  priority text not null default 'normal' check (priority in ('high','normal','low')),
  due date,
  created_at timestamptz not null default now(),
  done_at timestamptz
);

create table if not exists admin_links (
  id bigint generated always as identity primary key,
  title text not null,
  url text not null,
  grp text default 'General',
  sort int not null default 100,
  created_at timestamptz not null default now()
);

alter table admin_todos enable row level security;
alter table admin_links enable row level security;

drop policy if exists "todos_admin_all" on admin_todos;
create policy "todos_admin_all" on admin_todos for all
  using (public.is_admin()) with check (public.is_admin());
drop policy if exists "links_admin_all" on admin_links;
create policy "links_admin_all" on admin_links for all
  using (public.is_admin()) with check (public.is_admin());

-- Default links (only if the table is empty)
insert into admin_links (title, url, grp, sort)
select * from (values
  ('logichain.no',          'https://logichain.no',                                        'Logichain', 10),
  ('MacGregor portal',      'macgregor-dashboard.html',                                    'Logichain', 20),
  ('Data import',           'last-opp.html',                                               'Logichain', 30),
  ('Demo dashboard',        'logichain-dashboard-demo-en.html',                            'Logichain', 40),
  ('Claude Console',        'https://platform.claude.com',                                 'Tools',     50),
  ('Supabase',              'https://supabase.com/dashboard/project/iksnoymoqvweudilfuzy', 'Tools',     60),
  ('Cloudflare',            'https://dash.cloudflare.com',                                 'Tools',     70),
  ('GitHub repo',           'https://github.com/logichainas/logichain',                    'Tools',     80),
  ('Outlook',               'https://outlook.office.com',                                  'Tools',     90),
  ('domene.no',             'https://www.domene.no/klient/clientarea.php',                 'Tools',    100)
) v(title, url, grp, sort)
where not exists (select 1 from admin_links);
