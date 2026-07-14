# Tenant onboarding runbook — how to bring on a new customer

A step-by-step procedure for onboarding a new customer through Console's real onboarding flow. Written so anyone (not just whoever built the flow) can follow it. Matches the actual Console UI labels and button text as of `VIBEVERK_VERSION 0.34.5`.

Before starting, read the last few `docs/project/CHANGELOG.md` entries — this flow changes as bugs are found and fixed, and this document can drift out of date.

## Prerequisites

- Access to the Supabase organisation (to create a new project) and its Management API / a Personal Access Token if you need CLI access.
- Access to Console, logged in as an operator with `role = 'superadmin'` in `vibeverk-control`.
- The Supabase CLI available via `npx supabase` from the repo root.
- If this customer has their own real domain: access to that domain's DNS provider (not needed for an internal demo — see step 9).

## Step 1 — Create the Supabase project

Deliberately manual, not automated (Console's own "2. Opprett Supabase-prosjekt" card says why: automating project creation would need an org-wide, create/delete/billing-capable Management API token — a much bigger secret than anything else this system holds).

1. Supabase Dashboard → New project. Pick a name, region, and a strong database password — **save that password somewhere durable**, you'll need it for the migration push below and possibly future debugging.
2. Wait for the project to finish provisioning.
3. Note down: the project ref (from its URL, `https://supabase.com/dashboard/project/<ref>`), and its pooler connection string (Project Settings → Database → Connection string → Session pooler).

## Step 2 — Apply the full schema

From the repo root:

```
npx supabase db push --db-url "postgresql://postgres.<ref>:<password>@aws-0-<region>.pooler.supabase.com:5432/postgres"
```

This applies every migration in `supabase/migrations/` in order, including the baseline schema and every fix since (schema-fingerprint grants, the invite-role-timing fix, the `service_role` grant on `users`, etc. — a fresh project gets all of these automatically, no manual workarounds needed).

**Verify, don't trust a clean exit** — this repo's standing rule. At minimum, confirm the tables exist:

```sql
SELECT table_name FROM information_schema.tables WHERE table_schema='public' ORDER BY table_name;
```

You should see the full set: `announcements, bookings, chat_conversations, chat_messages, crm_bedrifter, crm_comms, crm_customers, kb_articles, leads, links, notes, store, tasks, users`.

## Step 3 — Get the project's API keys

Supabase Dashboard → Project Settings → API. Note the project URL, the `anon` key, and the `service_role` key. The `service_role` key is a secret — never paste it anywhere except Console's own "3b" field below (which stores it via Vault, not a plain column).

## Step 4 — Console: register the tenant

Console → Kundar → "+ Ny kunde":

- **Slug**: a short, unique, lowercase identifier (e.g. `kundenamn`). Pick something that won't collide with a future real customer of the same name if this is a demo — see the "demo vs. real" note at the end.
- **Domenenamn**: comma-separated hostnames this tenant will eventually be reachable at (e.g. `kunde.no, www.kunde.no`). Can be edited later.
- **Lagringsnøkkel**: the `storageKey` value from that customer's own `config.js` (must match exactly — this is how the tenant's Supabase rows/localStorage are namespaced).

Submit → the tenant row is created with `status = 'provisioning'`.

## Step 5 — Console: save the connection ("3. Kopling")

Paste the project URL into `data_plane_url` and the `anon` key into `data_plane_anon_key`. Save.

## Step 6 — Console: store the service_role key ("3b")

Paste the `service_role` key into the password field and save. It's written to Supabase Vault via a `SECURITY DEFINER` function, never stored as a plain column, and the UI never shows it again after this.

## Step 7 — Console: set up email ("3c. Set opp e-post")

Click "Set opp e-post". This configures the tenant's Supabase Auth SMTP to use the shared Resend sender via the Supabase Management API, and updates `site_url`/the redirect allow-list to the tenant's own hostnames (both are confirmed via a follow-up read, not just a clean response) — without this, the tenant is stuck on Supabase's default 2-emails/hour mailer and invite links redirect to whatever `site_url` was left at (`localhost` on a fresh project).

## Step 8 — Console: verify schema ("4. Køyr og verifiser skjema")

Click "Verifiser skjema" — this calls `verify_schema_fingerprint()` on the customer's own project and confirms it matches what's expected. Must pass before the admin invite (step 9) is enabled.

## Step 9 — Point a hostname at Vercel

Routing verification (step 10) needs at least one of this tenant's hostnames to actually resolve to Vercel and answer for that Host header — the check makes a real HTTP call.

- **For an internal demo/dry-run with no real domain of its own**: add an available `<name>.vercel.app` alias to the Vercel project (Vercel dashboard → Project → Settings → Domains → Add). Anyone can claim any not-yet-taken `*.vercel.app` name this way; no external DNS provider involved. Use that as the tenant's hostname in step 4/Console's hostname field.
- **For a real customer with their own domain**: this step becomes an actual DNS cutover at that domain's registrar/DNS provider (an A record or CNAME pointing at Vercel, per Vercel's own domain-setup instructions). This touches real, live traffic and possibly email (MX) if not done carefully — **treat as its own separate, explicitly-approved action**, never bundled into the rest of this checklist. Verify DNS records (A/MX/TXT/NS) before and after with a read-only DNS-over-HTTPS lookup rather than guessing.

## Step 10 — Console: verify routing ("5. Verifiser ruting")

Click "Verifiser ruting" — a real HTTP check against each configured hostname, confirming it actually reaches this tenant's config. Can also be re-run later (e.g. after moving DNS providers) without affecting live traffic — it's read-only.

## Step 11 — Console: invite the first admin ("4b. Inviter admin-brukar")

Enter the intended admin's real email and send. This sends a genuine Supabase Auth invite (via the tenant's own `service_role` key) — the recipient clicks the link, is taken to a **"Vel ditt passord"** screen (not straight into Workspace), sets their own password, and lands in Workspace with `role = 'admin'` already correctly set. Can be re-sent as many times as needed (e.g. if the email doesn't arrive) — nothing about re-sending is destructive.

**Don't skip step 7 before this** — if the email account exists but SMTP/redirect config wasn't set up yet, the email can still send successfully (if the project already had some working mailer) but the link will redirect to the stale/default `site_url` instead of the real Workspace URL.

## Step 12 — Console: activate ("6. Set aktiv")

Only enabled once ruting, admin-invite, and e-post are all ✓. This is the point where the tenant's Workspace/site genuinely starts answering for real visitors at its configured hostnames — read the warning text on the button before clicking; there's no staged/preview state after this.

## Step 13 — Confirm it actually works

Log in as the new admin (using the password they just set) and confirm:
- Workspace loads and shows the correct company name/branding.
- Their role shows as admin (full access, user-management visible).
- The public site (if applicable) resolves correctly at the configured hostname.

## Demo vs. real customer — naming and isolation

A demo/showcase tenant (like an internal "Sunnvask" example) should get its **own dedicated Supabase project**, not share one with `vibeverk-staging` or any other test tenant — a shared project means a future migration test against staging could disrupt a demo that's meant to always look presentable, and vice versa. If a demo tenant with a given name is later superseded by a real paying customer of the same name, archive the demo tenant and free up its slug/hostname first (Console supports renaming a tenant's slug via its own edit field), rather than trying to convert the demo row into the real one in place.

## Cleanup / rollback

- Archiving a tenant (Console's "Arkiver kunde") is reversible in the sense that the row and its data stay intact — but it stops resolving, and its hostnames become free for reassignment (verified this session: `resolve_tenant_by_hostname()` matches neither `archived` nor a not-yet-verified `provisioning` row).
- There is currently no automated way to delete a customer's actual Supabase project — that remains a manual Dashboard action, done deliberately outside this flow.
