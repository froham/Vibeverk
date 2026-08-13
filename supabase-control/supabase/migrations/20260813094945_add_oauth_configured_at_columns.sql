-- Console-feature (2026-08-13, Architect-designed): status-badge for den nye
-- configure_tenant_oauth-handlinga i tenant-admin/index.ts, same form som
-- smtp_configured_at (20260713184846).
--
-- `tenants` har brukt ei eksplisitt kolonnenivå-SELECT-tillatingsliste for
-- `authenticated` sidan 20260810234227_tenant_site_lock.sql -- KVART nytt
-- felt må difor eksplisitt inn i den lista i SAME migrasjon dei vert lagt
-- til, elles feilar heile loadTenants()-spørjinga (42501) og Kundar-fana
-- syner ei stille tom liste. Gløymt to gonger alt (dpa_*-felta 2026-08-12,
-- retention_policy 2026-08-12) -- gjort rett her frå fyrste forsøk.
ALTER TABLE tenants ADD COLUMN oauth_microsoft_configured_at timestamptz;
ALTER TABLE tenants ADD COLUMN oauth_google_configured_at timestamptz;

GRANT SELECT (oauth_microsoft_configured_at, oauth_google_configured_at) ON tenants TO authenticated;

NOTIFY pgrst, 'reload schema';
