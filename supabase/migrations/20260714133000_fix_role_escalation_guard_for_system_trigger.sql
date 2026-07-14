-- Regression introduced by 20260714131500 (same day): fixing handle_new_user()
-- to also fire on the invited_at UPDATE (closing the invite-role-timing bug)
-- means it now does an UPDATE public.users SET role=... from within a
-- trigger. That nested UPDATE hits prevent_self_role_escalation() (BEFORE
-- UPDATE ON users), which unconditionally blocks any role change unless the
-- CURRENT session is already an admin (is_admin_or_owner(), based on
-- auth.uid()) -- but this system-internal update runs with no authenticated
-- session at all (GoTrue talks to Postgres directly, not through PostgREST),
-- so auth.uid() is null and the guard rejected it outright. Confirmed live:
-- every inviteUserByEmail() call started failing with "Berre admin kan endre
-- rolle" (HTTP 500) as soon as GoTrue tried to set invited_at, rolling back
-- the whole transaction.
--
-- Fixed by letting the guard skip only when the update is nested inside
-- another trigger (pg_trigger_depth() > 1 at the point this fires) -- a
-- direct client UPDATE via PostgREST always fires this trigger at depth 1
-- (nothing else on that request path writes to `users` first), so this
-- keeps blocking the exact self-escalation path prevent_self_role_escalation
-- was built to stop, while letting our own system-driven role-sync through.
CREATE OR REPLACE FUNCTION prevent_self_role_escalation()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.role IS DISTINCT FROM OLD.role AND NOT is_admin_or_owner() AND pg_trigger_depth() <= 1 THEN
    RAISE EXCEPTION 'Berre admin kan endre rolle';
  END IF;
  RETURN NEW;
END;
$$;

NOTIFY pgrst, 'reload schema';
