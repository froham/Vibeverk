-- Real, pre-existing gap found during Phase 8 (control-plane broker):
-- `service_role` never had SELECT/INSERT/UPDATE/DELETE on `store`, only
-- REFERENCES/TRIGGER/TRUNCATE (confirmed via information_schema.role_table_grants
-- against production). Nothing needed service_role access to `store` before —
-- Console previously wrote via the customer's own OTP-authenticated
-- `authenticated` client, never service_role. The new control-plane broker
-- Edge Function (supabase-control/supabase/functions/broker) now needs it,
-- since it acts as service_role when crossing into this project.
GRANT SELECT, INSERT, UPDATE, DELETE ON store TO service_role;
