-- Eiendeler (Fase 2) — eierskapshistorikk. Kvar rad er éin registrert
-- overgang (Eid/Leid/Lånt -> ein annan verdi) for éin eigedel, stadfesta av
-- brukaren via confirm() i redigeringsskjemaet før lagring (Tier B-språk,
-- sjå workspace/module-orgdrift.js sin recordOwnershipChange()).
--
-- Same admin-only tilgangsmønster som assets/asset_categories (Fase 1,
-- 20260810091534_eiendeler_assets_schema.sql) -- konsekvent for heile
-- Eiendeler-fana, brukarvedtak frå Fase 1.

CREATE TABLE IF NOT EXISTS asset_ownership_history (
  id              uuid            PRIMARY KEY DEFAULT gen_random_uuid(),
  asset_id        uuid            NOT NULL REFERENCES assets(id) ON DELETE CASCADE,
  from_ownership  asset_ownership NOT NULL,
  to_ownership    asset_ownership NOT NULL,
  changed_on      date            NOT NULL DEFAULT current_date,
  note            text,
  snapshot        jsonb,
  changed_by      uuid            REFERENCES users(id) ON DELETE SET NULL,
  created_at      timestamptz     NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS asset_ownership_history_asset_idx ON asset_ownership_history(asset_id);

ALTER TABLE asset_ownership_history ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS asset_ownership_history_read  ON asset_ownership_history;
DROP POLICY IF EXISTS asset_ownership_history_write ON asset_ownership_history;
CREATE POLICY asset_ownership_history_read  ON asset_ownership_history FOR SELECT TO authenticated USING (true);
CREATE POLICY asset_ownership_history_write ON asset_ownership_history FOR ALL    TO authenticated USING (is_admin_or_owner()) WITH CHECK (is_admin_or_owner());

REVOKE ALL ON asset_ownership_history FROM anon;

NOTIFY pgrst, 'reload schema';
