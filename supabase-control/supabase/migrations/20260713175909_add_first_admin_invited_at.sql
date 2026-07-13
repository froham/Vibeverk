-- Architect design (2026-07-13): closes a real onboarding gap discovered
-- during vibeverk-as-tenant dry-run testing -- a freshly-provisioned
-- tenant's own Supabase project has zero Auth users, so nobody can log
-- into Workspace/Admin for it until someone manually creates a user via
-- the dashboard. This column lets activate_tenant require that at least
-- one admin invite was actually sent (necessary-but-not-sufficient --
-- confirms an invite was SENT, not accepted, same class of cached-check
-- as schema_verified_at/routing_verified_at) before a tenant can go live
-- with literally no path to log in.
ALTER TABLE tenants ADD COLUMN first_admin_invited_at timestamptz;

NOTIFY pgrst, 'reload schema';
