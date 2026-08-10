-- Eiendeler (Fase 4) — verdiberegningshistorikk. Kvar rad er éin godkjent
-- verdiestimering (enkeltvis "Beregn verdi på nytt", som krev eksplisitt
-- godkjenning FØR lagring, eller samla "Rekalkuler verdi i dag" med éin
-- confirm() for heile operasjonen) -- IKKJE ein automatisk, uovervaka
-- bakgrunnsjobb. `method` er alltid 'category_depreciation' i denne fasen
-- (ein enkel kjøpspris × (1-rate)^alder-kalkyle, EKSPLISITT IKKJE AI,
-- marknadspris eller rekneskapsmessig avskriving -- sjå UI-teksten i
-- workspace/module-orgdrift.js), men kolonnen er fritekst for å ikkje
-- hardkode denne eine metoden inn i eit CHECK-constraint.
--
-- Same admin-only tilgangsmønster som resten av Eiendeler (Fase 1/2).

CREATE TABLE IF NOT EXISTS asset_valuation_history (
  id           uuid          PRIMARY KEY DEFAULT gen_random_uuid(),
  asset_id     uuid          NOT NULL REFERENCES assets(id) ON DELETE CASCADE,
  value        numeric(12,2) NOT NULL,
  valued_on    date          NOT NULL DEFAULT current_date,
  method       text          NOT NULL DEFAULT 'category_depreciation',
  assumptions  jsonb,
  approved_by  uuid          REFERENCES users(id) ON DELETE SET NULL,
  created_at   timestamptz   NOT NULL DEFAULT now(),
  CONSTRAINT asset_valuation_history_value_nonnegative CHECK (value >= 0)
);

CREATE INDEX IF NOT EXISTS asset_valuation_history_asset_idx ON asset_valuation_history(asset_id);

ALTER TABLE asset_valuation_history ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS asset_valuation_history_read  ON asset_valuation_history;
DROP POLICY IF EXISTS asset_valuation_history_write ON asset_valuation_history;
CREATE POLICY asset_valuation_history_read  ON asset_valuation_history FOR SELECT TO authenticated USING (true);
CREATE POLICY asset_valuation_history_write ON asset_valuation_history FOR ALL    TO authenticated USING (is_admin_or_owner()) WITH CHECK (is_admin_or_owner());

REVOKE ALL ON asset_valuation_history FROM anon;

NOTIFY pgrst, 'reload schema';
