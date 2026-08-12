-- Fase 2 av retention-sweep (Console-synlegheit). Same fallgruve som
-- INCIDENT-fiksen i 20260812235500 -- fanga her FØR han vart live, ikkje
-- etterpå: `tenants` har brukt ei eksplisitt kolonnenivå-SELECT-tillatingsliste
-- for `authenticated` sidan 20260810234227_tenant_site_lock.sql, så
-- `retention_policy` (lagt til i 20260812233000, utan tilhøyrande grant) ville
-- ha slått ut heile Kundar-lista på same måte den 12. august-hendelsen gjorde,
-- i det augneblinken loadTenants() byrja å spørje etter kolonnen.
grant select (retention_policy) on tenants to authenticated;

notify pgrst, 'reload schema';
