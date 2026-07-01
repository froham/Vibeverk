# ADR-0005: Extend the closed admin-auth fallback (ADR-0003) to the intranet login

**Status:** Accepted
**Date:** 2026-07-01

## Context

ADR-0003 closed a narrow backdoor in the web-admin (`/#admin`) login: when Supabase is configured but its SDK fails to load for a given visitor, the code now shows a retry prompt instead of silently falling back to the plaintext `config.js` password.

While investigating a related Console UI question the same day, it was found that `intranet/intranet-core.js`'s own login (`renderLogin()`/`attempt()`) has the exact same class of gap, never patched: it only checks `if (_sb)` (whether the Supabase client instantiated) to decide between Supabase Auth and the config-password fallback — with no distinction between "Supabase not configured at all" (fine, local/test only) and "Supabase configured but the SDK failed to load" (should never fall back to the password). This is the identical narrow backdoor ADR-0003 was written to close, just on a second UI surface that was missed at the time.

While making this fix, a related fail-open issue was also found and corrected: three places in `intranet-core.js` (login, password-reset, session-restore) and one in `core.js` defaulted the user's role to `"admin"` (in `intranet-core.js`) or `"owner"` (in `core.js`) when a role lookup against Supabase failed (`(r.data && r.data.role) || "admin"`). This fails open to elevated trust on a lookup failure, rather than fail-closed to least privilege. Changed to default to `"member"` in all four places.

## Decision

Applied the identical `supabaseConfigured`/`_sb`-instantiated split from ADR-0003 to `intranet/intranet-core.js`'s `renderLogin()`: when Supabase is configured but the client failed to instantiate, show a retry prompt, never the password form. The config-password fallback remains available only when Supabase isn't configured at all.

Also changed the fail-open role defaults (`|| "admin"` / `|| "owner"` on failed role lookups) to `|| "member"` in both `core.js` and `intranet-core.js`, consistent with the "no backdoors, fail toward least privilege" principle established across today's auth work (ADR-0003, ADR-0004).

## Consequences

- Closes the same narrow, rare backdoor on the second (intranet) login surface, for consistency and completeness — a determined attacker shouldn't find a working bypass just by trying the surface ADR-0003 didn't cover.
- If a role lookup ever fails for a legitimate authenticated user (network blip, transient RLS issue), they will now see reduced (member-level) access rather than elevated (admin) access until the lookup succeeds — a deliberate trade-off favoring safety over convenience in a failure case that should be rare.

## Evidence

`intranet/intranet-core.js` (`renderLogin()`, `attempt()`, the three role-lookup callbacks), `core.js` (`onAuthStateChange` callback). Supersedes/extends `docs/decisions/ADR-0003-close-admin-auth-fallback.md` (does not replace it — that ADR's web-admin fix stands unchanged, this one covers the second surface).
