-- ============================================================
--  Logichain · New customers get the shared customer portal
--  Run in Supabase → SQL Editor → Run. Safe to run more than once.
--  A customer only exists when Einar creates the user in Supabase (Authentication → Users → Add user);
--  open sign-up is switched off. Each customer only ever sees rows with their own kunde_id (RLS).
-- ============================================================

-- 1) New users: portal = kunde-dashboard.html. Firma starts as the e-mail domain (e.g. "firma.no"); rename in Jarvis.
create or replace function public.handle_new_kunde()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.kunder (user_id, epost, firma, seed, portal)
  values (new.id, new.email, coalesce(nullif(split_part(new.email,'@',2),''), new.email),
          floor(random()*9000+1000)::bigint, 'kunde-dashboard.html')
  on conflict (user_id) do nothing;
  return new;
end;
$$;

-- 2) Existing customers without a portal
update public.kunder set portal = 'kunde-dashboard.html' where portal is null and not admin;

-- 3) Jarvis: admin can rename a customer and choose its portal (nobody else can change kunder)
create or replace function public.admin_update_kunde(p_id uuid, p_firma text, p_portal text)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() then raise exception 'not allowed'; end if;
  if char_length(trim(coalesce(p_firma,''))) < 2 then raise exception 'firma missing'; end if;
  if p_portal not in ('kunde-dashboard.html','macgregor-dashboard.html') then raise exception 'unknown portal'; end if;
  update public.kunder set firma = left(trim(p_firma),120), portal = p_portal where id = p_id and not admin;
end $$;
revoke all on function public.admin_update_kunde(uuid, text, text) from public, anon;
grant execute on function public.admin_update_kunde(uuid, text, text) to authenticated;
