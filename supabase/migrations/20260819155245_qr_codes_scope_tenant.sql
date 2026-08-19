-- Retting av 20260819150944_qr_codes_lockdown.sql, same runde -- fanga under
-- eigen manuell verifisering rett etter deploy til vibeverk-staging (FØR
-- nokon reell kunde brukte funksjonen), ikkje av Security Auditor.
--
-- PROBLEM: get_qr_redirect_target(p_code) filtrerte IKKJE på `store.tenant_id`
-- -- berre på `key = 'qr-codes'`. `store` sin unike nøkkel er (tenant_id, key),
-- så meir enn éin rad KAN i prinsippet eksistere med same `key` men ulik
-- `tenant_id` (legacy-felt frå før einskild-tenant-arkitekturen, sjå CLAUDE.md
-- sin eigen merknad om at `store` framleis har `tenant_id` "for bakoverkomp-
-- atibilitet"). Utan filter ville LIMIT 1 -- utan ORDER BY -- returnert ei
-- VILKÅRLEG rad viss to slike fanst, uavhengig av kva tenant som faktisk
-- eig raden App.store() skreiv (NS = CFG.storageKey). Retta ved å leggje ein
-- eksplisitt p_tenant_id-parameter til, som api/qr-redirect.js no sender inn
-- (tenant.data_plane_storage_key, same verdi App.store() alt brukar som
-- tenant_id ved skriving -- sjå core.js sin NS-konstant).
DROP FUNCTION IF EXISTS get_qr_redirect_target(text);

CREATE OR REPLACE FUNCTION get_qr_redirect_target(p_code text, p_tenant_id text)
RETURNS text
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
  SELECT item->>'targetUrl'
  FROM store, jsonb_array_elements(store.value) AS item
  WHERE store.key = 'qr-codes'
    AND store.tenant_id = p_tenant_id
    AND item->>'code' = p_code
    AND COALESCE((item->>'active')::boolean, true) = true
  LIMIT 1;
$$;

REVOKE ALL ON FUNCTION get_qr_redirect_target(text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION get_qr_redirect_target(text, text) FROM authenticated;
GRANT EXECUTE ON FUNCTION get_qr_redirect_target(text, text) TO anon;

NOTIFY pgrst, 'reload schema';
