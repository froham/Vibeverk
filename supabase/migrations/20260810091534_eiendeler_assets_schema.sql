-- Eiendeler (Fase 1) — ny fane i Workspace sin eksisterande "Organisasjon &
-- drift"-modul (module-orgdrift.js). Dei fem andre fanene i den modulen
-- lagrar alt som éin JSON-blob (App.store("wsp-orgdrift")) med berre grov,
-- admin-only tilgangsstyring -- Eiendeler treng derimot ekte per-rad RLS,
-- difor eigne tabellar i staden for å utvide blobben.
--
-- Kjelde: ekstern overleveringspakke (prototype + forslag til skjema),
-- eksplisitt merkt "ikkje ein blind fasit". Arkitekt-konsultert tilpassing
-- til faktisk Vibeverk-arkitektur (2026-08-10), sjå docs/project/CHANGELOG.md:
--   - image_path -> image_url (Media.put() i core.js returnerer full URL)
--   - responsible_person_id -> responsible_user_id (ekte users-FK; det finst
--     ikkje noko eige "personregister" med stabile FK-bare ID-ar -- orgdrift
--     sin eigen "Personer"-fane er blob-rader med lokalt genererte strengar)
--   - ingen deleted_at/soft-delete (ingen anna Workspace-tabell brukar det)
--   - ingen eigen rate-konfig-tabell -- depreciation-rata bur på kategorien
--   - tilgang er is_admin_or_owner() (admin-only), IKKJE can_edit_content(),
--     for å vere konsekvent med resten av "Organisasjon & drift" (brukarvedtak)

CREATE TABLE IF NOT EXISTS asset_categories (
  id                       uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  name                     text        NOT NULL,
  annual_depreciation_rate numeric(5,4) NOT NULL DEFAULT 0.18,
  created_at               timestamptz NOT NULL DEFAULT now(),
  updated_at               timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT asset_categories_name_not_blank CHECK (length(trim(name)) > 0),
  CONSTRAINT asset_categories_name_unique UNIQUE (name),
  CONSTRAINT asset_categories_rate_range CHECK (annual_depreciation_rate BETWEEN 0 AND 1)
);

-- Postgres har ingen CREATE TYPE ... IF NOT EXISTS-syntaks (ulikt CREATE
-- TABLE/INDEX over) -- DO-blokk med exception-fangst gjer migrasjonen trygg
-- å køyre om att (Security Auditor-funn, LOW, 2026-08-10).
DO $$ BEGIN
  CREATE TYPE asset_ownership AS ENUM ('owned', 'leased', 'borrowed');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
DO $$ BEGIN
  CREATE TYPE asset_status AS ENUM ('in_use', 'in_storage', 'in_service');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS assets (
  id                    uuid            PRIMARY KEY DEFAULT gen_random_uuid(),
  name                  text            NOT NULL,
  category_id           uuid            REFERENCES asset_categories(id) ON DELETE SET NULL,
  model                 text,
  ownership             asset_ownership NOT NULL DEFAULT 'owned',
  status                asset_status    NOT NULL DEFAULT 'in_use',
  acquisition_date      date,
  purchase_price        numeric(12,2),
  estimated_value       numeric(12,2),
  estimated_value_at    date,
  location              text,
  note                  text,
  image_url             text,
  supplier              text,
  agreement_number      text,
  rent_per_month        numeric(12,2),
  agreement_start       date,
  agreement_end         date,
  notice_date           date,
  responsible_user_id   uuid            REFERENCES users(id) ON DELETE SET NULL,
  responsible_name      text,
  return_terms          text,
  purchase_option       text,
  created_by            uuid            NOT NULL REFERENCES users(id),
  updated_by            uuid            REFERENCES users(id) ON DELETE SET NULL,
  created_at            timestamptz     NOT NULL DEFAULT now(),
  updated_at            timestamptz     NOT NULL DEFAULT now(),
  CONSTRAINT assets_name_not_blank CHECK (length(trim(name)) > 0),
  CONSTRAINT assets_purchase_price_nonnegative CHECK (purchase_price IS NULL OR purchase_price >= 0),
  CONSTRAINT assets_estimated_value_nonnegative CHECK (estimated_value IS NULL OR estimated_value >= 0),
  CONSTRAINT assets_rent_nonnegative CHECK (rent_per_month IS NULL OR rent_per_month >= 0)
);

CREATE TRIGGER assets_updated_at           BEFORE UPDATE ON assets           FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER asset_categories_updated_at BEFORE UPDATE ON asset_categories FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE INDEX IF NOT EXISTS assets_category_idx    ON assets(category_id);
CREATE INDEX IF NOT EXISTS assets_ownership_idx    ON assets(ownership);
CREATE INDEX IF NOT EXISTS assets_status_idx       ON assets(status);
CREATE INDEX IF NOT EXISTS assets_name_search_idx  ON assets
  USING gin (to_tsvector('simple', coalesce(name, '') || ' ' || coalesce(model, '') || ' ' || coalesce(location, '')));

ALTER TABLE asset_categories ENABLE ROW LEVEL SECURITY;
ALTER TABLE assets           ENABLE ROW LEVEL SECURITY;

-- Alle autentiserte (admin/editor/member) les; berre admin skriv -- konsekvent
-- med resten av "Organisasjon & drift" (isAdminRole() i UI-et), ikkje
-- can_edit_content() (som ville gjeve editor skrivetilgang, slik tasks/
-- kb_articles gjer det -- eksplisitt IKKJE valt her, brukarvedtak 2026-08-10).
DROP POLICY IF EXISTS asset_categories_read  ON asset_categories;
DROP POLICY IF EXISTS asset_categories_write ON asset_categories;
CREATE POLICY asset_categories_read  ON asset_categories FOR SELECT TO authenticated USING (true);
CREATE POLICY asset_categories_write ON asset_categories FOR ALL    TO authenticated USING (is_admin_or_owner()) WITH CHECK (is_admin_or_owner());

DROP POLICY IF EXISTS assets_read  ON assets;
DROP POLICY IF EXISTS assets_write ON assets;
CREATE POLICY assets_read  ON assets FOR SELECT TO authenticated USING (true);
CREATE POLICY assets_write ON assets FOR ALL    TO authenticated USING (is_admin_or_owner()) WITH CHECK (is_admin_or_owner());

-- Forsvar i djupna (Security Auditor-funn, LOW, 2026-08-10): RLS default-
-- nektar allereie anon heilt (ingen policy matchar den rolla), men eksplisitt
-- REVOKE følgjer same "stol aldri på ein anteke default"-disiplin som resten
-- av CLAUDE.md sine Supabase-reglar krev.
REVOKE ALL ON asset_categories FROM anon;
REVOKE ALL ON assets           FROM anon;

NOTIFY pgrst, 'reload schema';
