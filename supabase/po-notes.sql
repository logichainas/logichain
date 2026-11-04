-- Logichain · notes on PO lines in the customer portal (PO Performance)
-- One note per (customer, PO, line). po = '*' and linjenr = 0 is the general notepad for the PO page.
-- Customers read/write only their own notes; Logichain admins can read/write all. Safe to run more than once.

create table if not exists public.po_notater (
  id            bigint generated always as identity primary key,
  kunde_id      uuid not null references public.kunder(id) on delete cascade,
  po            text not null,
  linjenr       int  not null default 0,
  tekst         text not null default '' check (char_length(tekst) <= 4000),
  updated_by    uuid default auth.uid(),
  updated_email text,
  updated_at    timestamptz not null default now(),
  unique (kunde_id, po, linjenr)
);
alter table public.po_notater enable row level security;

drop policy if exists "po_notater_rw" on public.po_notater;
create policy "po_notater_rw" on public.po_notater for all
  using      (public.is_admin() or kunde_id in (select id from public.kunder where user_id = auth.uid()))
  with check (public.is_admin() or kunde_id in (select id from public.kunder where user_id = auth.uid()));

grant select, insert, update, delete on public.po_notater to authenticated;
