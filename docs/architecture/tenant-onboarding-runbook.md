# Tenant onboarding runbook — how to bring on a new customer

A step-by-step procedure for onboarding a new customer through Console's real onboarding flow. Written so anyone (not just whoever built the flow) can follow it. Matches the actual Console UI labels and button text as of `VIBEVERK_VERSION 0.34.7` — Console's own checklist uses the exact same 1–11 numbering as this document, on purpose.

Before starting, read the last few `docs/project/CHANGELOG.md` entries — this flow changes as bugs are found and fixed, and this document can drift out of date.

## Prerequisites

- Access to the Supabase organisation (to create a new project) and its Management API / a Personal Access Token if you need CLI access.
- Access to Console, logged in as an operator with `role = 'superadmin'` in `vibeverk-control`.
- The Supabase CLI available via `npx supabase` from the repo root.
- If this customer has their own real domain: access to that domain's DNS provider (not needed for an internal demo — see step 9).
- **Before onboarding the first REAL (non-demo) paying customer: upgrade Vercel's "vibeverk" team to Pro.** Decided/deferred deliberately 2026-07-16 (see `docs/compliance/data-map-vibeverk.md` section 4a) — the account is on the free Hobby plan today, which is fine for Vibeverk's own site + internal demos, but Vercel's own DPA only auto-applies to Pro/Enterprise customers. A real customer's end-user personal data routing through Vercel without that in place is a genuine, not-just-theoretical compliance gap. Self-serve, $20/month per developer seat (not per end-customer), no sales call needed — see the same doc section for the full reasoning. Not needed for Sunnvask or any other internal demo tenant.

## Step 1 — Console: register the tenant

Console → Kundar → "+ Ny kunde":

- **Slug**: a short, unique, lowercase identifier (e.g. `kundenamn`). Pick something that won't collide with a future real customer of the same name if this is a demo — see the "demo vs. real" note at the end.
- **Domenenamn**: comma-separated hostnames this tenant will eventually be reachable at (e.g. `kunde.no, www.kunde.no`, or for a demo, a `<namn>.vercel.app` alias — see step 9). Can be edited later.
- **Lagringsnøkkel**: the `storageKey` value from that customer's own `config.js` (must match exactly — this is how the tenant's Supabase rows/localStorage are namespaced).

Submit → the tenant row is created with `status = 'provisioning'`.

## Step 2 — Create the Supabase project

Deliberately manual, not automated (Console's own "2. Opprett Supabase-prosjekt" card says why: automating project creation would need an org-wide, create/delete/billing-capable Management API token — a much bigger secret than anything else this system holds).

1. Supabase Dashboard → New project. Same organisation as the other Vibeverk projects. Pick a region matching the others (consistency only, no functional difference). A strong database password — **save it somewhere durable**, you'll need it for step 4 and possibly future debugging.
2. **Plan**: Free tier pauses a project automatically after about a week of no API traffic — a real risk for a demo/showcase tenant that's meant to always look presentable on demand. Pick Pro (or be ready to manually "wake" the project before every demo) if that matters here.
3. Wait for the project to finish provisioning.
4. Note down: the project ref (from its URL, `https://supabase.com/dashboard/project/<ref>`), and its pooler connection string (Project Settings → Database → Connection string → **Session pooler** tab specifically — not "Direct connection", which resolves to an IPv6-only host that often fails outright on Windows/networks without IPv6).

## Step 3 — Console: connection and keys ("3. Kopling og nøklar")

Paste just the project URL into the "Hent nøklar automatisk" field and submit — this fetches the `anon` and `service_role` keys directly from Supabase's Management API and stores all three (URL, anon key as a plain column, service_role key via Vault) in one action. Uses the same platform-level Management API token the SMTP step (7) relies on; doesn't touch or need the raw database password.

If that fails for some reason (or you'd rather not rely on it), expand "…eller lim inn nøklane manuelt" — the original two manual fields (project URL + `anon` key, then `service_role` key separately) are still there as a fallback. Get these from Supabase Dashboard → Project Settings → API. The `service_role` key is a secret — never paste it anywhere except this field (which stores it via Vault, not a plain column).

## Step 4 — Run the migrations

From the repo root, or use Console's own generator (expand "Generer kommandoen frå tilkoplingsstrengen" under this same card) — paste the full connection string Supabase's Dashboard shows you (Session pooler, with the real password in it, exactly as displayed) and it builds the exact, correctly URL-encoded command for you, without you having to think about URL-encoding special characters yourself:

```
npx supabase db push --db-url "postgresql://postgres.<ref>:<password>@aws-0-<region>.pooler.supabase.com:5432/postgres"
```

This applies every migration in `supabase/migrations/` in order, including the baseline schema and every fix since (schema-fingerprint grants, the invite-role-timing fix, the `service_role` grant on `users`, etc. — a fresh project gets all of these automatically, no manual workarounds needed). Still a manual CLI step — Console generates the command but does not execute it (see "What's deliberately not automated" below for why).

## Step 5 — Console: verify schema ("5. Verifiser skjema")

**Verify, don't trust a clean exit** — this repo's standing rule. Click "Verifiser skjema" — this calls `verify_schema_fingerprint()` on the customer's own project and confirms it matches what's expected, rather than just trusting that step 4's command printed no error. Must pass before the admin invite (step 10) is enabled.

If you want to double-check directly yourself too:

```sql
SELECT table_name FROM information_schema.tables WHERE table_schema='public' ORDER BY table_name;
```

You should see the full set: `announcements, bookings, chat_conversations, chat_messages, crm_bedrifter, crm_comms, crm_customers, kb_articles, leads, links, notes, store, tasks, users`.

## Step 6 — Deploy the customer's own Edge Functions

**Easy to miss** (found live during a real onboarding — `db push` in step 4 only applies database migrations, it does NOT deploy Edge Functions; those are a completely separate deploy step). Without this, Workspace's own "invite a new user" feature (`module-users.js`, used by an already-logged-in admin to invite additional staff — different from step 10's first-admin invite) fails with a CORS error that looks unrelated (`manage-user` simply doesn't exist yet on the project, so its OPTIONS preflight itself 404s).

From the repo root:

```
npx supabase functions deploy manage-user --project-ref <ref>
npx supabase functions deploy send-reply --project-ref <ref>
```

`manage-user` needs no extra configuration — it only uses the `SUPABASE_URL`/`SUPABASE_SERVICE_ROLE_KEY`/`SUPABASE_ANON_KEY` env vars every Supabase project auto-injects into its own Edge Functions. `send-reply` (chat/contact-form email replies) additionally needs its own `RESEND_API_KEY` secret set via `npx supabase secrets set RESEND_API_KEY=... --project-ref <ref>` before it'll actually send anything — not needed just to get Workspace login/user-management working, only relevant once you're testing chat/contact-form replies.

## Step 7 — Console: set up email ("7. Set opp e-post (SMTP)")

Click "Set opp e-post". This configures the tenant's Supabase Auth SMTP to use the shared Resend sender via the Supabase Management API, and updates `site_url`/the redirect allow-list to the tenant's own hostnames (both are confirmed via a follow-up read, not just a clean response) — without this, the tenant is stuck on Supabase's default 2-emails/hour mailer and invite links redirect to whatever `site_url` was left at (`localhost` on a fresh project).

## Step 8 — Console: set up customer configuration ("8. Set opp kundekonfigurasjon")

Company name, colors/fonts, actual page text (hero/about/contact/news/services), privacy policy, the web-admin password, which modules are enabled — done in Console's other tabs ("Produkt", "Web", "Workspace", "Modular", "Analyse", "Personvern"), not on this checklist card. **Do this before step 10** (the real admin invite) so the customer's own admin sees a finished setup immediately, not defaults.

A fresh tenant with none of this filled in shows a console warning (`SITE_CONFIG manglar felt: company, colors, fonts, privacy, admin, workspace, hero, about, contact, news, services, contactSection`) — that warning is effectively this step's own checklist.

## Step 9 — Point a hostname at Vercel, then verify routing ("9. Peik hostname mot Vercel og verifiser ruting")

Routing verification needs at least one of this tenant's hostnames to actually resolve to Vercel and answer for that Host header — the check makes a real HTTP call.

- **For an internal demo/dry-run with no real domain of its own**: add an available `<name>.vercel.app` alias to the Vercel project (Vercel dashboard → Project → Settings → Domains → **Add**, entering the full `name.vercel.app` string — typing just the bare name without `.vercel.app` makes Vercel treat it as a real, purchasable domain search and shows "Buy" instead). This is free — no registrar, no purchase, just claiming an available name under Vercel's own shared namespace. Use that same exact string as the tenant's hostname (step 1).
- **For a real customer with their own domain**: this step becomes an actual DNS cutover at that domain's registrar/DNS provider (an A record or CNAME pointing at Vercel, per Vercel's own domain-setup instructions). This touches real, live traffic and possibly email (MX) if not done carefully — **treat as its own separate, explicitly-approved action**, never bundled into the rest of this checklist. Verify DNS records (A/MX/TXT/NS) before and after with a read-only DNS-over-HTTPS lookup rather than guessing.

Then click "Verifiser ruting" — a real HTTP check against each configured hostname, confirming it actually reaches this tenant's config. Can also be re-run later (e.g. after moving DNS providers) without affecting live traffic — it's read-only.

## Step 10 — Console: invite the first admin ("10. Inviter admin-brukar")

Enter the intended admin's real email and send. This sends a genuine Supabase Auth invite (via the tenant's own `service_role` key) — the recipient clicks the link, is taken to a **"Vel ditt passord"** screen (not straight into Workspace), sets their own password, and lands in Workspace with `role = 'admin'` already correctly set. Can be re-sent as many times as needed (e.g. if the email doesn't arrive) — nothing about re-sending is destructive.

**Don't skip step 7 (email) or step 8 (customer configuration) before this** — if SMTP/redirect config wasn't set up yet, the email can still send successfully (if the project already had some working mailer) but the link will redirect to the stale/default `site_url` instead of the real Workspace URL; and if step 8 isn't done, the customer's real admin sees an unfinished-looking setup on first login.

## Step 11 — Console: activate ("11. Set aktiv")

Only enabled once routing, admin-invite, and email are all ✓. This is the point where the tenant's Workspace/site genuinely starts answering for real visitors at its configured hostnames — read the warning text on the button before clicking; there's no staged/preview state after this.

## Confirm it actually works

Log in as the new admin (using the password they just set) and confirm:
- Workspace loads and shows the correct company name/branding.
- Their role shows as admin (full access, user-management visible).
- The public site (if applicable) resolves correctly at the configured hostname.

## Demo vs. real customer — naming and isolation

A demo/showcase tenant (like an internal "Sunnvask" example) should get its **own dedicated Supabase project**, not share one with `vibeverk-staging` or any other test tenant — a shared project means a future migration test against staging could disrupt a demo that's meant to always look presentable, and vice versa. If a demo tenant with a given name is later superseded by a real paying customer of the same name, archive the demo tenant and free up its slug/hostname first (Console supports renaming a tenant's slug via its own edit field), rather than trying to convert the demo row into the real one in place.

## Cleanup / rollback

- Archiving a tenant (Console's "Arkiver kunde") is reversible in the sense that the row and its data stay intact — but it stops resolving, and its hostnames become free for reassignment (verified this session: `resolve_tenant_by_hostname()` matches neither `archived` nor a not-yet-verified `provisioning` row).
- There is currently no automated way to delete a customer's actual Supabase project — that remains a manual Dashboard action, done deliberately outside this flow.

## What's deliberately not automated (and why)

- **Creating the Supabase project itself** (step 2) — would need an org-wide, project-create/delete/billing-capable Management API token, a categorically bigger secret than the tenant-scoped access everything else in this flow uses. See ADR-0010.
- **Actually running the migrations** (step 4) — Console can generate the exact command for you, but doesn't execute it. Running migrations from Console would mean bundling migration SQL into the Edge Function itself (it has no runtime access to the repo), replicating `supabase db push`'s own migration-history tracking, and — the real reason — introducing a genuinely new category of risk: arbitrary SQL execution against any customer project via a platform-wide credential, unlike everything else in `tenant-admin`, which uses either a narrow Management-API config endpoint or the tenant's own scoped key. Worth revisiting with a proper Architect/security pass if this becomes a recurring pain point, not a quick add.
