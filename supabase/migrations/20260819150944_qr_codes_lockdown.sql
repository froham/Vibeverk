-- QR-modul (module-qrcode.js, 2026-08-19) — låser ned `qr-codes`-nøkkelen i
-- den delte `store`-tabellen og legg til ei trong, anon-kallbar oppslags-
-- funksjon for den offentlege redirect-en (api/qr-redirect.js).
--
-- PROBLEM (fanga av Security Auditor, HIGH, same runde -- fiksa før merge,
-- aldri deployert i den usikre forma): den opphavlege implementasjonen let
-- api/qr-redirect.js gjere eit rått anon SELECT mot heile `qr-codes`-rada
-- via den eksisterande store_anon_read-policyen (20260707000001, linje 582),
-- som IKKJE hadde 'qr-codes' i utelatingslista. Det gjorde HEILE lista av
-- QR-kodar -- kvar code, target_url og den interne label-teksten -- bulk-
-- lesbar for kven som helst med anon-nøkkelen, uavhengig av /qr/<code>-
-- gjetting. Retta ved å (1) leggje 'qr-codes' til utelatingslista, slik at
-- direkte anon SELECT på nøkkelen no vert avvist akkurat som for CRM/leads/
-- booking-nøklane, og (2) gje redirect-funksjonen ei eiga, trong
-- SECURITY DEFINER-funksjon som berre returnerer target_url for ÉIN
-- konkret, aktiv kode -- aldri heile lista, aldri label eller andre felt.
DROP POLICY IF EXISTS store_anon_read ON store;
CREATE POLICY store_anon_read ON store FOR SELECT TO anon
  USING (key NOT IN (
    'crm-customers', 'crm-bedrifter', 'crm-comms', 'leads', 'booking-bookings',
    'superconfig-private', 'qr-codes'
  ));

CREATE OR REPLACE FUNCTION get_qr_redirect_target(p_code text)
RETURNS text
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
  SELECT item->>'targetUrl'
  FROM store, jsonb_array_elements(store.value) AS item
  WHERE store.key = 'qr-codes'
    AND item->>'code' = p_code
    AND COALESCE((item->>'active')::boolean, true) = true
  LIMIT 1;
$$;

-- Eksplisitte signaturar (CLAUDE.md-regel): REVOKE frå PUBLIC/authenticated
-- fyrst, deretter EIN eksplisitt GRANT til akkurat den rolla som treng han
-- (api/qr-redirect.js kallar denne med anon-nøkkelen -- Workspace/Web-admin
-- sin vanlege, autentiserte lesing av heile qr-codes-lista via App.store er
-- UPÅVERKA av denne låsinga, sidan store_read_authenticated ikkje endra seg).
REVOKE ALL ON FUNCTION get_qr_redirect_target(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION get_qr_redirect_target(text) FROM authenticated;
GRANT EXECUTE ON FUNCTION get_qr_redirect_target(text) TO anon;

NOTIFY pgrst, 'reload schema';
