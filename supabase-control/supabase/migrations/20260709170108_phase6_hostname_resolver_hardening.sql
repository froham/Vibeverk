-- Phase 6 (SaaS-scaling plan): real hostname->tenant resolver. This
-- migration fixes two things the Architect's design consult (2026-07-09)
-- found were needed before a resolver could work at all -- see
-- docs/decisions/ADR-0007-multi-tenant-hosting-architecture.md's Phase 6
-- addendum for the full design.

-- =============================================================================
-- Fix 1: resolve_tenant_by_hostname() only ever returned rows where
-- status = 'active'. But activate_tenant (tenant-admin Edge Function)
-- refuses until routing_verified_at is set, and the only credible way to
-- SET routing_verified_at is a real HTTP round-trip through the tenant's
-- public hostname -- which requires resolve_tenant_by_hostname to already
-- return the row. As written this was circular: a 'provisioning' tenant is
-- unresolvable, so routing can never be verified, so it can never activate.
-- Widened to also resolve 'provisioning' tenants (deliberately NOT
-- 'suspended'/'archived' -- those must stay unresolvable).
--
-- Also: hostname comparison is now case-insensitive (lower() on both
-- sides) -- HTTP Host headers are case-insensitive per spec, array
-- membership was previously a literal string comparison.
--
-- Also adds data_plane_storage_key to the returned columns -- the
-- Phase 6 /api/tenant-config.js function needs it to populate the
-- generated config.js's storageKey field, which the baseline design
-- (ADR-0008) never anticipated a caller outside the control plane itself
-- needing. Still an explicit column list, not SELECT * -- adding a new
-- tenants column in the future still can't leak through this function
-- without a deliberate edit here.
--
-- Postgres can't CREATE OR REPLACE a function into a different return
-- type, so this is a DROP + CREATE rather than a plain REPLACE.
-- =============================================================================
DROP FUNCTION IF EXISTS resolve_tenant_by_hostname(text);
CREATE FUNCTION resolve_tenant_by_hostname(p_hostname text)
RETURNS TABLE (
  data_plane_url text,
  data_plane_anon_key text,
  data_plane_storage_key text,
  theme jsonb,
  product_mode text,
  enabled_modules jsonb,
  custom_modules_manifest jsonb
)
SECURITY DEFINER STABLE SET search_path = public
LANGUAGE sql AS $$
  SELECT data_plane_url, data_plane_anon_key, data_plane_storage_key, theme, product_mode, enabled_modules, custom_modules_manifest
  FROM tenants
  WHERE lower(p_hostname) = ANY(hostnames) AND status IN ('active', 'provisioning');
$$;
-- Because this is DROP + CREATE (not CREATE OR REPLACE), the function's
-- previous grants are gone -- these are NOT just restated for clarity,
-- they're required again from scratch. Per this repo's own standing rule,
-- Supabase's default ACLs re-grant EXECUTE to anon on any newly created
-- function regardless of this REVOKE FROM PUBLIC -- confirmed harmless here
-- since anon access is exactly what this function is for, but the GRANT
-- below is still the thing actually making it callable, intentionally.
REVOKE ALL ON FUNCTION resolve_tenant_by_hostname(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION resolve_tenant_by_hostname(text) TO anon;

-- =============================================================================
-- Fix 2: no uniqueness guard existed on hostnames across tenants -- only
-- `slug` is UNIQUE. Nothing stopped two rows from listing the same
-- hostname, which would make resolve_tenant_by_hostname's result
-- (RETURNS TABLE, effectively "first match" to a caller expecting one row)
-- ambiguous -- an accidental hostname collision between two tenants would
-- be a real cross-tenant config leak, not just a bookkeeping bug.
--
-- Enforced as a trigger (not a simpler UNIQUE constraint, since hostnames
-- is an array column -- Postgres has no native "unique array elements
-- across rows" constraint) using the && (overlap) operator. Also
-- normalizes hostnames to lowercase on write, so the case-insensitive
-- resolver above and this overlap check always compare on the same footing.
--
-- Security Auditor finding M1 (Phase 6 pre-merge review, 2026-07-09): the
-- EXISTS check below only sees COMMITTED rows under Postgres's default
-- READ COMMITTED isolation -- two concurrent INSERT/UPDATEs with
-- overlapping hostnames could each pass the check before either commits,
-- landing exactly the collision this trigger exists to prevent. Fixed
-- with a fixed-key advisory transaction lock (pg_advisory_xact_lock)
-- taken BEFORE the check, serializing all hostname-mutating transactions
-- against each other. Coarse-grained (one lock for all tenants, not
-- per-hostname), but hostname registration/reconnection is a rare,
-- superadmin-only operation -- contention is a non-issue, and this is far
-- simpler than a separate unique-per-hostname junction table.
-- =============================================================================
CREATE OR REPLACE FUNCTION check_tenant_hostname_overlap()
RETURNS trigger
SECURITY DEFINER SET search_path = public
LANGUAGE plpgsql AS $$
BEGIN
  PERFORM pg_advisory_xact_lock(729014); -- arbitrary constant, unique to this guard
  NEW.hostnames := (SELECT array_agg(lower(h)) FROM unnest(NEW.hostnames) AS h);
  IF NEW.hostnames IS NULL THEN
    NEW.hostnames := '{}';
  END IF;
  IF EXISTS (
    SELECT 1 FROM tenants
    WHERE id <> NEW.id AND hostnames && NEW.hostnames
  ) THEN
    RAISE EXCEPTION 'one or more hostnames are already registered to another tenant';
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION check_tenant_hostname_overlap() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS tenants_hostname_overlap_guard ON tenants;
CREATE TRIGGER tenants_hostname_overlap_guard
  BEFORE INSERT OR UPDATE OF hostnames ON tenants
  FOR EACH ROW EXECUTE FUNCTION check_tenant_hostname_overlap();

-- Normalize any existing hostnames to lowercase (idempotent, no-op if
-- already lowercase) -- run once so the new case-insensitive resolver and
-- the overlap trigger above see consistent data immediately, not just for
-- future writes.
UPDATE tenants SET hostnames = (SELECT array_agg(lower(h)) FROM unnest(hostnames) AS h)
WHERE hostnames <> (SELECT array_agg(lower(h)) FROM unnest(hostnames) AS h);

-- Security Auditor finding L1: resolve_tenant_by_hostname() was DROP+CREATE'd
-- above with a new return signature -- without this, PostgREST could keep
-- serving its previously cached function signature/plan until its schema
-- cache naturally refreshes, per CLAUDE.md's standing rule for any
-- function add/replace.
NOTIFY pgrst, 'reload schema';
