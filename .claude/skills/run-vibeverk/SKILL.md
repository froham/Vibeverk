---
name: run-vibeverk
description: Build, run, screenshot, and drive Vibeverk (public site, Web-admin, Workspace/intranet, Console) locally. Use when asked to start Vibeverk, serve it locally, take a screenshot of a page, or click through a real flow (Kontakt, Tilbud, Booking, chat widget) to confirm a change works, not just that tests pass.
---

Vibeverk is a static, no-bundler, vanilla-JS site (public site + `/admin/`
+ `/intranet/` + `/console/`, all sharing `core.js`/`components.js`) backed
by Supabase. There is no build step and no dev server built into the repo —
"running" it means serving the static files and driving a real headless
Chromium against them via the Playwright driver in this directory
(`.claude/skills/run-vibeverk/driver.js`). All paths below are relative to
the repo root.

**⚠️ `config.js` points at the REAL production Supabase project
(`clzczbyklgdtdhgjphup`).** There is no local/staging Supabase — driving any
form (Kontakt, Tilbud, Booking, chat) writes a REAL row into the customer's
live database. The driver tags every submission with a `PWTEST-<timestamp>`
name/email so it's identifiable, but **you must manually clean up test rows
afterward** (queries below) and get user approval before running a flow that
writes data, per this project's `CLAUDE.md` deployment-safeguard rule — this
is not optional caution, it already tripped an auto-mode permission denial
once for exactly this reason.

## Prerequisites

Node is already available (this repo's own `test.js`/`test-intranet.js` run
on it). Playwright is a devDependency; install its browser binary once:

```powershell
npm install -D playwright        # already in package.json after this; idempotent
npx playwright install chromium  # downloads Chrome for Testing, ~300MB, one-time
```

## Run (agent path)

1. **Serve the repo root as static files on :8080.** `npx http-server`
   prompts interactively on first use ("Ok to proceed? (y)") — that hangs
   forever in a non-interactive/background launch, so pass `--yes`:

   ```powershell
   Start-Process -FilePath "cmd.exe" `
     -ArgumentList "/c npx --yes http-server -p 8080 -c-1" `
     -WorkingDirectory "<repo-root>" -WindowStyle Hidden
   Start-Sleep -Seconds 3
   Invoke-WebRequest -Uri "http://localhost:8080/" -UseBasicParsing  # confirm 200
   ```

   (`Start-Process -FilePath "npx" ...` directly fails on Windows — `npx` is
   a `.cmd`/`.ps1` shim, not a raw executable; it must go through
   `cmd.exe /c`.)

2. **Run the driver** for one flow at a time (or `all`):

   ```powershell
   node .claude/skills/run-vibeverk/driver.js home      # just loads + screenshots, no writes
   node .claude/skills/run-vibeverk/driver.js kontakt   # WRITES a real lead — confirm with user first
   node .claude/skills/run-vibeverk/driver.js tilbud    # WRITES a real lead (if attachment upload RLS allows it — see Gotchas)
   node .claude/skills/run-vibeverk/driver.js booking   # WRITES a real booking, occupies a real calendar slot
   node .claude/skills/run-vibeverk/driver.js chat      # WRITES a real chat conversation+message (only if chat-availability is fresh — see Gotchas)
   node .claude/skills/run-vibeverk/driver.js all       # runs all five in sequence
   ```

   The driver must be run with `node` from the **repo root** (not from
   inside `.claude/skills/run-vibeverk/`) so Node's `require("playwright")`
   resolves via the repo's own `node_modules`.

3. **Screenshots** land in `.claude/skills/run-vibeverk/screenshots/`
   (`home.png`, `kontakt-before.png`/`kontakt-after.png`, etc. — one pair per
   flow, before and after submit where applicable). Look at them; a blank or
   error-page screenshot means the flow didn't actually work even if the
   script didn't throw.

4. **Console errors** are printed after every flow. Four `401`s to
   `crm_customers`/`crm_bedrifter`/`crm_comms`/`bookings` on `home`/any page
   load are **expected** (anon has no SELECT grant on those tables — a
   pre-existing, accepted limitation, not a driver bug). Anything else is a
   real finding.

| flow | writes real data? | what it proves |
|---|---|---|
| `home` | no | site loads, no console errors beyond the expected 401s |
| `kontakt` | yes — 1 lead | anonymous Kontakt form reaches Supabase |
| `tilbud` | yes — 1 lead, if attachment upload succeeds | anonymous Tilbud form + file attachment reaches Supabase |
| `booking` | yes — 1 booking, occupies a real slot | anonymous instant-booking reaches Supabase, matches the UI's claimed result |
| `chat` | yes — 1 conversation + message, only if `chat-availability` fresh | anon chat widget round-trips through the visitor RPCs |

### Cleanup after writing test data

```sql
-- run via: npx supabase db query --linked --file <this>.sql
SELECT id, name, email FROM leads WHERE email LIKE 'pwtest+%';       -- then DELETE FROM leads WHERE id = '...';
SELECT id, name, email FROM bookings WHERE email LIKE 'pwtest+%';    -- then DELETE FROM bookings WHERE id = '...';
SELECT id, visitor_name, visitor_email FROM chat_conversations WHERE visitor_email LIKE 'pwtest+%'; -- then DELETE (cascades to chat_messages)
```

Don't blanket-delete — confirm each row is actually one of your test rows
first (`pwtest+` prefix), then delete by explicit `id`.

## Run (human path)

Just open `http://localhost:8080/` (or `/admin/`, `/intranet/`, `/console/`)
in a real browser once the static server (step 1 above) is running. No
build step, no separate dev-mode.

## Test

```powershell
node test.js            # public site — expect "488 OK" or higher, 1 known FEIL ("henvendelses-fanen heter «Kontakt»")
node test-intranet.js   # intranet — expect "148 OK" of 149, 1 known FEIL ("o3: workspaceship via direkterute")
```

These are jsdom-based and never configure a real Supabase client — they
verify field-mapping/UI logic, not the actual network calls the driver
above exercises. Both are complementary, not redundant.

## Gotchas

- **Booking confirm form's name/phone/message inputs are all
  `type="text"`.** `input[type="text"]` resolves to 3 elements and
  Playwright throws a strict-mode violation. Target by id prefix instead:
  `input[id^="bkc-name-"]` (the phone/message fields aren't needed for a
  minimal submission).
- **Chat only shows the live-conversation form (`#vw-start-btn`) if
  `chat-availability` (a `store` table key) is "online" AND fresh** — the
  client enforces an 8-hour expiry (`Chat.getAvailability()` in
  `module-chat.js`) independent of whatever the stored value says. If it's
  stale, the widget silently falls back to the offline lead-capture form
  (`#vw-off-*` ids) instead — this looks like a broken driver but is
  correct, expected behavior. Check the live value first:
  ```sql
  SELECT value FROM store WHERE key = 'chat-availability';
  ```
  If testing the live-chat path specifically, you have to temporarily
  refresh it (`UPDATE store SET value = jsonb_build_object('online', true,
  'since', (extract(epoch from now())*1000)::bigint) WHERE key =
  'chat-availability'`) and then **restore the exact original row
  afterward** — this is real production config, not test data; get
  explicit user approval before touching it, and confirm the restore with
  a follow-up `SELECT`.
- **`npx http-server` prompts on first run** ("Need to install the
  following packages... Ok to proceed? (y)") — a background/hidden
  `Start-Process` never sees that prompt and just hangs forever with no
  error. Always pass `--yes`.
- **`Start-Process -FilePath "npx"` fails** with "%1 is not a valid Win32
  application" — `npx` on Windows is a shim script, not an executable. Wrap
  it: `-FilePath "cmd.exe" -ArgumentList "/c npx ..."`.
- **The driver must live somewhere `require("playwright")` can resolve**
  — Node walks up from the *script's own path*, not the current directory.
  A copy of the driver outside the repo (e.g. in a scratch/temp dir) will
  fail to find the repo's `node_modules/playwright` even if run with `cwd`
  set to the repo root. Keep it inside the repo (this skill directory is
  inside the repo, so this is already handled).

## Troubleshooting

- **"Cannot find module 'playwright'"**: the driver isn't being run from
  somewhere inside the repo's own module resolution path. Confirm you're
  running `node .claude/skills/run-vibeverk/driver.js ...` with the repo
  root as the working directory, not a copy elsewhere.
- **Tilbud flow shows "Kunne ikke laste opp ett eller flere vedlegg"**:
  this was a real, confirmed bug (2026-07-06) — `storage.objects`'s
  `media_insert` policy required `TO authenticated` + `can_edit_content()`,
  which no anonymous visitor can satisfy. Check whether
  `hotfix_tilbud_attachment_storage_2026-07-06.sql` (or its equivalent) has
  been run against the target project before assuming the driver itself is
  broken.
