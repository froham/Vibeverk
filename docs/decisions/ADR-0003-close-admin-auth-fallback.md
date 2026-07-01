# ADR-0003: Close the web-admin password fallback whenever Supabase is configured

**Status:** Accepted
**Date:** 2026-07-01

## Context

`config.js → admin.password` (a plaintext value, currently the placeholder `"test"`) was originally the sole gate for the public-site web-admin panel. Investigation this session showed the actual runtime behavior in `core.js` (`renderAdminLogin()`) is more nuanced: `useSupabase = !!_sb`, where `_sb` is the Supabase client, instantiated whenever `config.js` has valid `supabase.url`/`anonKey` and the Supabase JS SDK loaded successfully. In any real, configured deployment, this means the login form normally requires Supabase Auth (email + password against a real user with a role in the `users` table) — the config-password comparison is dead code under normal conditions.

However, `_sb` could also be `null` for a narrower, unintended reason: the Supabase SDK script failing to load for a given visitor (CDN outage, network hiccup, blocked request) even though Supabase *is* configured. In that edge case, the code fell back to the plaintext config-password check — meaning a trivially-guessable placeholder password could grant admin access under a condition outside the operator's control, for any deployment.

The user's explicit requirement, after this was surfaced and discussed: *"Det skal ikke være bakveier eller risikofaktorerer. Man skal kun kunne autorisere seg via bruker/supabase."* (There must be no backdoors or risk factors. One should only be able to authorize via user/Supabase.)

## Decision

`renderAdminLogin()` now distinguishes two conditions explicitly:
- `supabaseConfigured = !!(CFG.supabase && CFG.supabase.url && CFG.supabase.anonKey)` — is this deployment meant to use Supabase at all?
- `useSupabase = !!_sb` — did the Supabase client actually instantiate?

If `supabaseConfigured` is true but `useSupabase` is false (the SDK failed to load), the login modal now shows an explicit "couldn't load the login service, try again" state with a retry action — **never** the password form. The config-password fallback is only ever reachable when Supabase isn't configured at all (`supabaseConfigured` is false), which is exclusively a local/offline test-environment scenario, not any real customer deployment.

Net effect: for every real, configured Vibeverk deployment, admin authentication can only ever succeed via Supabase Auth. There is no code path, however narrow, where a client-side password comparison can grant access.

## Consequences

- Closes a genuine, if narrow, latent risk without removing the local/test convenience of a config-password fallback when there's no Supabase project to authenticate against at all.
- `config.js → admin.password` remains present (for the local/test case) and should still eventually be changed from the `"test"` placeholder — a weak fallback password is still bad practice in local/test contexts, even though it's now unreachable in production. See `docs/project/CURRENT_STATE.md` "Known limitations".
- No visible behavior change for the normal case (SDK loads fine) — this only changes what happens in the rare SDK-load-failure case, from "silently offer a weak password" to "show a retry prompt."

## Evidence

`core.js` (`renderAdminLogin()`, `supabaseConfigured`/`useSupabase` split, and the `_sb` instantiation IIFE near the top of the file). `docs/project/CHANGELOG.md` 0.3.0 entry.
