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

RLS on `store`: `auth_only` policy — only `authenticated` role can read or write. Anon visitors have no access to the `store` table.

## superconfig

`superconfig` is a special key in the `store` table, written by the Vibeverk Console. It holds Vibeverk operator overrides that apply to a customer deployment:

- `workspace.colors` — custom color palette overrides
- `workspace.fonts` — custom font overrides
- `features` — feature flag overrides
- `analytics` — analytics configuration (Plausible domain, etc.)
- `privacy` — privacy settings
- `productMode` — "web" / "workspace" / "full"

`superconfig` is read early in the page lifecycle by `earlyApplySuperConfig()`, an IIFE in `core.js` that runs before `DOMContentLoaded`. This ensures that theme colors, fonts, and productMode are applied before any modules render.

`superconfig` is readable by all authenticated workspace users (intranet members). It must not contain per-user secrets or sensitive customer data.

## Hydration

After a user logs in via Supabase Auth, `hydrateFromSupabase()` is called. This function fetches all matching `store` rows for the current session and merges them into localStorage, overwriting local values with the server-authoritative values. This keeps localStorage in sync with the Supabase store after login.

## Chat data flow

Chat is the most sensitive data flow because it involves unauthenticated visitors:

```
Visitor → (anon RPC) → chat_conversations / chat_messages → (authenticated RPC) → Admin
```

1. Visitor sends a message: browser calls `send_visitor_msg` RPC with `visitor_id`, name, email, message. The RPC validates visitor_id ownership and inserts into `chat_messages`.
2. Visitor retrieves messages: browser calls `get_visitor_msgs` RPC with `visitor_id`. The RPC returns only messages belonging to that visitor_id.
3. Admin polls for new conversations and messages via authenticated RPCs. The authenticated session provides a JWT that is verified by Supabase RLS.

Visitor's `visitor_id` is a random string stored in localStorage. It is not a cryptographic identity. Ownership is validated inside every visitor-scoped RPC — if a visitor presents someone else's `visitor_id`, the RPC denies access.

## Anon access constraint

Anon role NEVER gets direct `SELECT` on `chat_messages` or `chat_conversations`. All visitor access is via `SECURITY DEFINER` RPCs. This is a hard security constraint — violating it would expose all chat history to any anonymous user who knows a conversation UUID.

## Data tables

| Table | What it stores | Access |
|---|---|---|
| `store` | Key/value config, superconfig | Authenticated only (RLS) |
| `users` | User accounts, roles | RLS: owner/admin can manage, users see own row |
| `notes` | Private user notes | RLS: `user_id = auth.uid()` — never shared |
| `tasks` | Tasks with assignments | RLS: all authenticated read, admin/owner write, assigned user can update status |
| `announcements` | News/announcements with images and attachments | RLS: admin/owner write, all authenticated read |
| `kb_articles` | Knowledge base articles | RLS: admin/owner write, all authenticated read; published articles visible to all |
| `links` | Intranet quick links | RLS: admin/owner write, all authenticated read |
| `chat_conversations` | Chat sessions with visitor metadata | RLS: authenticated only; anon via SECURITY DEFINER RPC only |
| `chat_messages` | Chat messages | RLS: authenticated only; anon via SECURITY DEFINER RPC only |

## Google Fonts

Loaded client-side via a `<link>` element that is dynamically built from the font configuration in `config.js`. The URL is constructed and inserted into `<head>` at page load. This sends requests to Google's CDN (`fonts.googleapis.com`) and may log the visitor's IP address.
