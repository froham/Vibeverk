# Storage and Data Flow

## localStorage namespace

All localStorage access is namespaced with the prefix `nordpunkt:`. This prefix is set by `storageKey: "nordpunkt"` in `config.js`.

**This prefix MUST NEVER be changed.** All existing Supabase `store` rows have `key` values prefixed with `nordpunkt:`. All localStorage entries in existing users' browsers are keyed this way. Renaming the prefix requires a full atomic data migration and would break hydration for all existing sessions.

## App.store API

Modules must use `App.store` for all persistent key/value storage. Never use `localStorage` directly.

| Method | Behaviour |
|---|---|
| `App.store.get(key, defaultValue)` | Reads from localStorage. Returns `defaultValue` if key is absent. |
| `App.store.set(key, value)` | Writes to localStorage immediately. Triggers a debounced (~300ms) write-through to Supabase `store` table. |
| `App.store.remove(key)` | Removes from localStorage and queues deletion from Supabase. |

The write-through to Supabase only occurs when an authenticated session is active. Unauthenticated visitors do not write to Supabase.

## Supabase store table

Schema (simplified):
```sql
store (
  id          uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  tenant_id   text DEFAULT 'default',  -- kept for backward compatibility
  key         text NOT NULL,
  value       jsonb,
  updated_at  timestamptz DEFAULT now()
)
```

The `tenant_id` column is retained for backward compatibility. All other tables in the schema are single-tenant (one Supabase project per customer, so no tenant_id needed elsewhere). The `store` table's `tenant_id` must not be removed.

RLS on `store` as defined in `supabase/migration.sql` (verified 2026-07-02): anon has `SELECT` on all rows (`store_anon_read`, `USING (true)`) — this is a known, separately-tracked finding (`docs/project/CURRENT_STATE.md` "Still open" — resolved for all known private customer data as of 2026-07-03). **CRM data, leads and bookings were all moved out 2026-07-03, see below** — all three migrations (schema/RLS + one-time data migration) have been run against production and confirmed. The old `store` rows for these keys have not been deleted yet (a separate, explicit approval is required first) but are no longer the live data path. Authenticated users get `SELECT` on all rows via `store_read_authenticated`. Writes to `store` are split across three command-specific policies (`store_insert_auth`, `store_update_auth`, `store_delete_auth` — previously one combined `FOR ALL` policy called `store_auth`, replaced 2026-07-02 for the reason below). INSERT/UPDATE require `is_admin_or_owner()` for the `superconfig` and `wsp-orgdrift` keys, `can_edit_content()` (admin/editor) for most other keys. `store_read_authenticated` and the `wsp-orgdrift` write carve-out were added 2026-07-02 (`supabase/hotfix_role_enforcement_2026-07-02.sql`) — **run against production and confirmed by the user 2026-07-02** (see `docs/security/security-baseline.md`).

**CRM data, leads and bookings moved out of `store` 2026-07-03 (fixes the CRITICAL anon-SELECT finding for these keys):** `crm-customers`/`crm-bedrifter`/`crm-comms` (first pass), `leads` (second pass — Kontakt AND Tilbud submissions, previously distinguished only by message-text sniffing, not a real field) and `booking-bookings` (third and final pass) are no longer `store` keys in code. The `CASE` branches referencing them in `store_insert_auth`/`store_update_auth` are now dead (harmless, kept until the old `store` rows are verified-and-deleted in a follow-up cleanup). This data now lives in real tables — see "CRM tables", "leads table" and "bookings table" below. `crm-settings` (templates/snippets/signatures — no PII) and `booking-assets` (the resources themselves) remain in `store`, unaffected.

## leads table (Kontakt + Tilbud)

Real table, added 2026-07-03 to replace the `leads` `store` blob. Schema (simplified):
```sql
leads (id text PRIMARY KEY, kind text CHECK (kind IN ('kontakt','tilbud')), name, email, message, status, reference_number, source, chat_id, created_at)
```
`id` is `text` for the same reason as the CRM tables (client-generated, synchronous). `kind` replaces a previously-undocumented pattern: Tilbud (quote) submissions and Kontakt (contact form) submissions both went through the same `App.addLead()` and were told apart purely by checking whether `message` started with `"Tilbudsforespørsel"` — string-prefix sniffing duplicated across 15+ call sites in `core.js`, `module-quote.js`, `module-crm.js`, and several intranet modules. A shared helper, `App.isTilbud(lead)`, now centralizes this: it trusts `kind` when present, and falls back to the same text-sniffing rule for older data that hasn't been migrated or doesn't have `kind` set yet.

RLS: no anon access at all. Admin/editor: full access. Member: SELECT/INSERT/UPDATE, no DELETE — anonymous form submissions (the public Kontakt/Tilbud forms) are **not** part of this table's write path today; that's the separate, already-documented "anonymous submissions never reach Supabase" finding (`docs/project/CURRENT_STATE.md` "Still open").

`core.js` owns the data layer (both Kontakt, built into `core.js`, and Tilbud, in `module-quote.js`, write to the same table) via `_leads` (a local cache) and `loadLeads()`. Unlike the CRM tables — which `module-crm.js` exclusively owns — `leads` can be written directly via `App.store.set("leads", …)` from elsewhere (e.g. test setup), so `getLeads()`/`addLead()`/`updateLead()`/`deleteLead()` always read fresh from `Store` (not the cache) whenever Supabase isn't configured or the session isn't authenticated, exactly matching pre-2026-07-03 behaviour; the async cache is only used once Supabase writes are actually active.

Migration for existing production data: `supabase/hotfix_leads_data_migration_2026-07-03.sql`, idempotent, sets `kind` for existing rows via the old text-sniffing rule, does not delete the old `store` row. **Both the table DDL and the data migration were run against production and confirmed 2026-07-03** via `npx supabase db query --linked` (row counts verified: 2/2, split 1 `kontakt`/1 `tilbud`). Old `store` row not deleted yet.

## bookings table

Real table, added 2026-07-03 to replace the `booking-bookings` `store` blob (the third and final of the three private datasets identified in the Fase 1 audit). Schema (simplified):
```sql
bookings (id text PRIMARY KEY, asset_id text NOT NULL, date date NOT NULL, time text NOT NULL, name, email, phone, message, instant boolean, status, reference_number, created_at)
```
`id` is `text`, same reasoning as the CRM/leads tables (client-generated, e.g. `"bk-"+Date.now()+...`, needed back synchronously). `booking-assets` (the bookable resources themselves — cars, meeting rooms, hours) is **not** part of this migration and stays in `store` — low sensitivity, admin config, not customer data.

RLS: no anon access at all. Admin/editor: full access. Member: SELECT/INSERT/UPDATE, no DELETE — same pattern as CRM/leads. Anonymous public booking-form submissions are, like Kontakt/Tilbud, not part of this table's write path today (the same already-documented "anonymous submissions never reach Supabase" finding).

`module-booking.js` (public/Web-admin) and `intranet/module-booking.js` (Workspace) are two independent files that read/write this table — unlike CRM (one file, exclusively owning the data), these two files never load simultaneously (different pages), so each maintains its **own** independent local cache (`_bookings`/`loadBookings()`/`getBookings()`) rather than sharing one coordination layer. A new `window.BookingAdmin` accessor (`getBookings()`, `deleteBookingsByEmail()`), exposed by the root `module-booking.js`, mirrors `window.CrmAdmin` and is used by `core.js` (dashboard count, GDPR erasure, search/analytics, CSV export), `module-crm.js` (`autoImport()`, `getLegacyHistory()`, `deleteAllForEmail()`) and the Workspace's `intranet-core.js`/`module-dashboard.js` tab badges/counts, so none of them read the stale `store` key directly once Supabase is active.

**Regression found and fixed during this pass, not caught by the leads-phase sweep**: `module-crm.js`'s GDPR `deleteAllForEmail()` (invoked when a CRM customer is deleted) wrote lead deletions directly via `App.store.set("leads", …)`, bypassing the Supabase-aware `deleteLead()` entirely — which also wasn't exposed on the `App` object. Once Supabase is active this would silently fail to remove the row from the production `leads` table (a real GDPR gap). Fixed: `deleteLead` is now exposed on `App`, and `deleteAllForEmail()` calls it per matching lead (the equivalent booking-deletion call in the same function already went through `window.BookingAdmin.deleteBookingsByEmail()` from the start of this pass).

Migration for existing production data: `supabase/hotfix_bookings_data_migration_2026-07-03.sql`, idempotent, does not delete the old `store` row. **Both the table DDL and the data migration were run against production and confirmed 2026-07-03** via `npx supabase db query --linked` (row count verified: 1/1). Old `store` row not deleted yet.

## CRM tables (`crm_bedrifter`, `crm_customers`, `crm_comms`)

Real normalized Postgres tables, added 2026-07-03 to replace the `crm-bedrifter`/`crm-customers`/`crm-comms` `store` blobs. Schema (simplified):
```sql
crm_bedrifter (id text PRIMARY KEY, name, customer_number, org_nr, website, phone, address, invoice_email, invoice_address, note, created_at, updated_at)
crm_customers (id text PRIMARY KEY, email, alt_emails text[], name, phone, address, note, customer_number, bedrift_id text REFERENCES crm_bedrifter, created_at, updated_at)
crm_comms     (id text PRIMARY KEY, customer_id text NOT NULL REFERENCES crm_customers ON DELETE CASCADE, type, title, data jsonb, created_at)
```
`id` is `text`, not `uuid` — the client generates it (same format as the old blob-array IDs, e.g. `"cust-"+Date.now()+...`), matching the existing `chat_conversations`/`chat_messages` pattern in this schema, since `module-crm.js`'s existing code (e.g. `findOrCreateBedrift()`) needs the ID back synchronously, not via an async round-trip. `crm_comms` is polymorphic — phone notes, internal notes, tasks, documents and emails each have different extra fields (`callDate`/`contact`/`followup` vs. `subject`/`to`/`threadId` vs. `dueDate`/`done`, etc.) — known columns (`id`/`customer_id`/`type`/`title`/`created_at`) are real, everything else lives in the `data` jsonb column, same pattern as `announcements.attachments jsonb` elsewhere in this schema. As of 2026-07-03 (v0.13.0), `document`-type comms can carry an `attachment: {name, ref, type, size}` field (populated via `App.media.putFile()`, the same upload path the mediabank module uses) — it's just another type-specific field in `data`, no schema change needed. All four editable comm types (`phone_note`, `internal_note`, `task`, `document`) can be reopened for editing from the timeline (`updateComm(id, patch)`), not just created.

RLS: **no anon access at all** (the actual fix). Admin/editor: full access via `can_edit_content()`. Member: `SELECT`/`INSERT`/`UPDATE` open, `DELETE` requires `can_edit_content()` — the same rule the old `store` CRM carve-out had, now enforced on the tables themselves rather than via a `CASE` on `store.key`. A `merge_crm_customers(p_ids, p_primary_id)` `SECURITY DEFINER` RPC handles the customer-merge feature atomically (avoiding a client-orchestrated multi-step delete/update that could leave duplicate or orphaned rows on a network failure), with a user-chosen primary customer, and moves `crm_comms` rows to the surviving customer before deleting the others.

`module-crm.js`'s data layer reads/writes these tables via a synchronous local cache (`_customers`/`_bedrifter`/`_comms`, populated by `loadCrmData()`), matching `intranet/module-tasks.js`'s established `_tasks`/`loadTasks()` pattern, so the ~60 existing call sites in that module continue to work unchanged. `core.js` (dashboard count, GDPR erasure, search/analytics, CSV export) and `module-chat.js` (CRM customer lookup for a chat visitor) no longer read `store`/`localStorage` directly for this data — they go through a `window.CrmAdmin` accessor API (`getCustomers()`, `getBedrifter()`, `deleteCustomersByEmail()`) that reads the same cache.

Migration for existing production data: `supabase/hotfix_crm_data_migration_2026-07-03.sql`, idempotent, does not delete the old `store` rows (a separate, explicitly-approved cleanup step is included but commented out). **Both the table DDL and the data migration were run against production and confirmed 2026-07-03** via `npx supabase db query --linked` — row counts verified directly (`crm_bedrifter` 3/3, `crm_comms` 8/8, `crm_customers` 22/23; the one-row gap is a pre-existing duplicate-id collision in the old test data, not a migration bug — confirmed acceptable by the user). Old `store` rows for these three keys have not been deleted yet.

## superconfig

`superconfig` is a special key in the `store` table, written by the Vibeverk Console. It holds Vibeverk operator overrides that apply to a customer deployment:

- `workspace.colors` — custom color palette overrides
- `workspace.fonts` — custom font overrides
- `features` — feature flag overrides
- `analytics` — analytics configuration (Plausible domain, etc.)
- `privacy` — privacy settings
- `productMode` — "web" / "workspace" / "full"

`superconfig` is read early in the page lifecycle by `earlyApplySuperConfig()`, an IIFE in `core.js` that runs before `DOMContentLoaded`. This ensures that theme colors, fonts, and productMode are applied before any modules render.

`superconfig` is readable by all authenticated workspace users (Workspace members). It must not contain per-user secrets or sensitive customer data.

## Hydration

After a user logs in via Supabase Auth, `hydrateFromSupabase()` is called. This function fetches all matching `store` rows for the current session and merges them into localStorage, overwriting local values with the server-authoritative values. This keeps localStorage in sync with the Supabase store after login.

## Chat data flow

Chat is the most sensitive data flow because it involves unauthenticated visitors:

```
Visitor → (anon RPC) → chat_conversations / chat_messages → (authenticated RPC) → Admin
```

1. Visitor sends a message: browser calls `send_visitor_msg` RPC with `visitor_id`, name, email, message. The RPC validates visitor_id ownership and inserts into `chat_messages`.
2. Visitor retrieves messages: browser calls `get_visitor_msgs` RPC with `visitor_id`. The RPC returns only messages belonging to that visitor_id.
3. Admin polls for new conversations and messages via authenticated RPCs. The authenticated session provides a JWT that is verified by Supabase RLS. As of 2026-07-02, the admin poll loop (`module-chat.js`) fetches conversation-list changes and the active conversation's new messages as two independent checks per cycle (previously an if/else-if structure could let a conversation-metadata change swallow that round's message fetch). Supabase Realtime (`postgres_changes` on both tables) is the live-update path; polling is the explicit fallback guarantee.

Visitor's `visitor_id` is a random string stored in localStorage. It is not a cryptographic identity. Ownership is validated inside every visitor-scoped RPC — if a visitor presents someone else's `visitor_id`, the RPC denies access.

## Anon access constraint

Anon role NEVER gets direct `SELECT` on `chat_messages` or `chat_conversations`. All visitor access is via `SECURITY DEFINER` RPCs. This is a hard security constraint — violating it would expose all chat history to any anonymous user who knows a conversation UUID.

## Data tables

| Table | What it stores | Access |
|---|---|---|
| `store` | Key/value config, superconfig, `booking-assets`, `crm-settings` — CRM customers/leads/bookings all moved out to real tables 2026-07-03, confirmed run against production (old rows not yet deleted) | See "Supabase store table" above — as designed: anon `SELECT` on all rows (known finding, resolved in practice for private data since it's moved out), authenticated `SELECT` on all rows, writes gated by key |
| `leads` | Kontakt + Tilbud submissions | RLS: no anon access; admin/editor full; member SELECT/INSERT/UPDATE, no DELETE |
| `bookings` | Booking requests | RLS: no anon access; admin/editor full; member SELECT/INSERT/UPDATE, no DELETE |
| `crm_customers`/`crm_bedrifter`/`crm_comms` | CRM customers, companies, communication history | RLS: no anon access; admin/editor full; member SELECT/INSERT/UPDATE, no DELETE |
| `users` | User accounts, roles (`admin`/`editor`/`member` — no `owner`, see `docs/decisions/ADR-0006-remove-owner-role-references.md`) | RLS: admin can manage, users see own row |
| `notes` | Private user notes | RLS: `user_id = auth.uid()` — never shared |
| `tasks` | Tasks with assignments | RLS: all authenticated read, admin write, assigned user can update status. Only admin can assign a task to another user. |
| `announcements` | News/announcements with images and attachments | RLS: admin write, all authenticated read |
| `kb_articles` | Knowledge base articles | RLS: admin write, all authenticated read; published articles visible to all |
| `links` | Workspace quick links | RLS: admin write, all authenticated read |
| `chat_conversations` | Chat sessions with visitor metadata | RLS: authenticated only; anon via SECURITY DEFINER RPC only |
| `chat_messages` | Chat messages | RLS: authenticated only; anon via SECURITY DEFINER RPC only |

## Google Fonts

Loaded client-side via a `<link>` element that is dynamically built from the font configuration in `config.js`. The URL is constructed and inserted into `<head>` at page load. This sends requests to Google's CDN (`fonts.googleapis.com`) and may log the visitor's IP address.
