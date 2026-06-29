# Release Security Checklist

Use this checklist before pushing to `main` or applying a Supabase SQL change. All items must be verified. Mark each item as checked only after direct inspection, not by assumption.

---

## Auth and roles

- [ ] No change to `storageKey: "nordpunkt"` or the `store` table `tenant_id` column
- [ ] New intranet routes or module actions check `is_admin_or_owner()` or the appropriate role before performing privileged operations
- [ ] Console access still requires OTP validation and `role = 'owner'` check — no bypass paths introduced
- [ ] Web admin password not logged to console, not exposed in network requests, not added to any API call in new code

---

## Supabase / RLS

- [ ] Anon role has no direct `SELECT` on `chat_messages` or `chat_conversations` (verify RLS policies)
- [ ] All new functions exposed to anon are `SECURITY DEFINER STABLE SET search_path = public`
- [ ] `REVOKE EXECUTE ON FUNCTION f(sig) FROM PUBLIC` precedes `GRANT EXECUTE ON FUNCTION f(sig) TO anon` for every new anon-facing function, with explicit signatures
- [ ] `NOTIFY pgrst, 'reload schema';` is included after every `CREATE OR REPLACE FUNCTION` in the SQL change
- [ ] All new SQL is idempotent: uses `CREATE OR REPLACE`, `IF NOT EXISTS`, `DROP ... IF EXISTS` as appropriate
- [ ] `visitor_id` ownership is validated inside every new or modified visitor-scoped RPC — the RPC must reject requests where the visitor_id does not match the stored conversation's visitor_id
- [ ] New RLS policies on non-chat tables are reviewed: no unintended anon access, no overly permissive `authenticated` access to private data

---

## Input handling

- [ ] All user-supplied values passed through `C.esc()` before insertion into HTML strings (visitor name, email, message content, CRM fields, task/announcement/KB content, file names)
- [ ] Form inputs are trimmed and length-validated before Supabase writes — no arbitrarily large payloads accepted
- [ ] No raw SQL string concatenation anywhere in the changed code — all DB access via PostgREST API or parameterised RPC calls

---

## Data and privacy

- [ ] No customer PII added to `config.js` or to localStorage keys outside the `nordpunkt:` namespace
- [ ] No new third-party integrations (scripts, SDKs, APIs) added without review of what data they receive and whether consent is required
- [ ] `superconfig` does not store sensitive per-user data or secrets — it is readable by all authenticated workspace users
- [ ] If new browser metadata is collected in chat (beyond existing: page_url, referrer, language, browser, os, screen), this has been flagged for privacy review

---

## Cache and deployment

- [ ] `?v=N` in `index.html` incremented for every changed module file
- [ ] `?v=N` incremented in `intranet/index.html` for every changed intranet module file
- [ ] Only the files that actually changed had their version numbers bumped — unchanged files were not touched
- [ ] `node test.js` passes (acceptable pre-existing failures: "henvendelses-fanen heter «Kontakt»" and "sammenslåings-avhukingsbokser finst på kunderadene")
- [ ] `node test-intranet.js` passes (acceptable pre-existing failure: "o3: workspaceship via direkterute")
- [ ] No new test failures introduced

---

## Before deployment

- [ ] User has explicitly approved `git push` — propose the command and wait for confirmation
- [ ] If SQL changes are included: user has explicitly approved running the SQL in the Supabase Dashboard SQL Editor
- [ ] No production Supabase action (function create/replace, policy change, data modification) performed without user approval
