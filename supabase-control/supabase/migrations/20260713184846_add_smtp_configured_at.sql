-- Architect design (2026-07-13): closes the email-delivery gap found while
-- testing invite_tenant_admin -- a freshly-provisioned tenant defaults to
-- Supabase Auth's built-in mailer (2 emails/hour, see supabase/config.toml's
-- [auth.rate_limit] comment), so invite/support-access emails silently fail
-- to deliver reliably until custom SMTP is configured for that specific
-- project. This column lets activate_tenant require that SMTP was actually
-- configured (and confirmed via a GET after the PATCH, not just a clean
-- response) before a tenant can go live.
ALTER TABLE tenants ADD COLUMN smtp_configured_at timestamptz;

NOTIFY pgrst, 'reload schema';
