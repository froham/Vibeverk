-- INCIDENT-fiks, same dag, oppdaga live i produksjon (2026-08-12): sidan
-- 20260810234227_tenant_site_lock.sql bytte tenants frå eit tabellnivå-GRANT
-- til ei eksplisitt KOLONNENIVÅ-tillatingsliste for `authenticated` (for å
-- skjerme site_lock_password_hash), må KVART nytt felt lagt til på tenants
-- etterpå eksplisitt inn i den lista -- 20260811081551 gjorde dette rett for
-- site_lock_ever_enabled, men 20260812210000_add_dpa_tracking_and_document_
-- history.sql gløymde det for dpa_sent_at/dpa_signed_at/dpa_document_path.
-- loadTenants() (console-core.js) spør etter alle desse felta i éin og same
-- SELECT -- manglande kolonnenivå-SELECT på berre TRE av dei fekk heile
-- spørringa til å feile (42501), og sidan loadTenants() aldri sjekka
-- r.error, synte Kundar-fana ei stille TOM liste i staden for ein feil.
-- Ingen ny tilgang -- berre attgjeving av det som alt var meint å vere der.
grant select (dpa_sent_at, dpa_signed_at, dpa_document_path) on tenants to authenticated;

notify pgrst, 'reload schema';
