-- Eiendeler — fiks: manglande GRANT til authenticated (produksjonsfunn,
-- 2026-08-10). Dei tre tidlegare Eiendeler-migrasjonane oppretta RLS-
-- policyar for "authenticated" på alle fire tabellane, men REVOKE ALL ...
-- FROM anon var det einaste eksplisitte privilegie-steget -- ingen
-- tilsvarande GRANT til "authenticated" vart nokon gong gjeve.
--
-- Postgres sjekkar table-level GRANT FØR RLS i det heile vert evaluert --
-- ein perfekt RLS-policy hjelper ingenting utan denne. Stadfesta live: ekte
-- brukar fekk "permission denied for table asset_categories" ved fyrste
-- reelle bruk i produksjon, og eit direkte information_schema.role_table_
-- grants-oppslag synte at "authenticated" berre hadde REFERENCES/TRIGGER/
-- TRUNCATE på alle fire tabellane (Supabase sin eigen, ikkje-fullstendige
-- platform-standard for nyoppretta tabellar -- same feilklasse CLAUDE.md
-- alt dokumenterer for service_role på "store"-tabellen, ADR-0009).
--
-- Ingen sekvensar involvert (alle fire brukar uuid PRIMARY KEY DEFAULT
-- gen_random_uuid(), ikkje serial/bigserial) -- treng difor ikkje
-- tilsvarande "sequence USAGE"-steget CLAUDE.md nemner for det andre,
-- ueigna tilfellet.

GRANT SELECT, INSERT, UPDATE, DELETE ON asset_categories          TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON assets                    TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON asset_ownership_history   TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON asset_valuation_history   TO authenticated;

NOTIFY pgrst, 'reload schema';
