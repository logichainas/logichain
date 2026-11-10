-- Logichain · Admin only on the Logichain account.
-- The MacGregor work account keeps access to its own portal (macgregor-dashboard), but is no longer admin.
update public.kunder set admin = true  where epost = 'einar@logichain.no';
update public.kunder set admin = false where epost = 'einar.fredriksen@macgregor.com';
select epost, admin, portal from public.kunder order by admin desc;
