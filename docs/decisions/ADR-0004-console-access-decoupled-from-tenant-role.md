# ADR-0004: Console access is governed solely by the superadmin email allowlist, not by tenant role

**Status:** Accepted
**Date:** 2026-07-01

## Context

The Vibeverk Operator Console (`/console/`) authenticates via a two-step OTP flow: (1) the entered email is checked against a hardcoded `SUPERADMIN_EMAILS` allowlist *before* an OTP is even sent, and (2) after a valid OTP is verified, `console-core.js` additionally looked up the authenticated user's row in that Supabase project's `users` table and required `role === "owner"`.

This second check was a leftover from before `SUPERADMIN_EMAILS` existed. It broke real usage: the Vibeverk operator's own account had a `users` row with `role = "admin"` (not `"owner"`) in the current production project, so Console access was denied with "Tilgang nekta — ikkje owner-konto" despite the account being the legitimate, allowlisted Vibeverk operator. More fundamentally, this check was conceptually wrong: Console is explicitly documented as being for the Vibeverk operator, "ikkje ein kundebrukar" (not a customer user, see the code comment at `console-core.js:19` predating this fix) — yet it required that operator to hold a specific tenant-scoped role (`owner`) inside each individual customer's own `users` table. This does not scale (every new customer's Supabase project would need a manually-inserted `owner` row for the Vibeverk operator) and conflates two unrelated concepts: "who is allowed to operate Console" vs. "who owns this specific customer's business."

Investigation confirmed `role` was not read anywhere else in `console-core.js` — the tenant-role check served no purpose beyond this single gate.

## Decision

Remove the `users.role` lookup from Console's OTP verification entirely. `SUPERADMIN_EMAILS` (checked before OTP send) plus a successfully verified OTP is the complete and sufficient authorization for Console access. No tenant-role dependency, no per-customer `owner`/`superadmin` row needs to be provisioned.

## Consequences

- Fixes the immediate blocker: the Vibeverk operator's own account (`role = "admin"` in the current tenant) can now access Console.
- Scales correctly to future customers: standing up a new customer's Supabase project (Fase 2 in `docs/roadmap/ROADMAP.md`) no longer requires manually inserting an operator row into that customer's `users` table just for Console access.
- Security posture is unchanged, not weakened: `SUPERADMIN_EMAILS` was already the real authorization boundary (a customer's own `owner`-role user was never going to be in that hardcoded list anyway). The removed check added no real defense-in-depth, only an operational footgun.
- No separate "superadmin" role or column was introduced, and none is needed — the allowlist already fully serves that purpose. If a future need arises to give multiple named individuals distinct, auditable Console-operator identities (rather than one shared hardcoded list), that would warrant a new ADR at that time — not implemented now.

## Evidence

`console/console-core.js` (`SUPERADMIN_EMAILS`, OTP verification handler), `docs/architecture/roles-and-tenants.md` ("The three admin surfaces" → Console section, updated alongside this ADR).
