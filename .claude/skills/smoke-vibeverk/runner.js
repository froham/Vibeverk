// runner.js — Playwright smoke-test runner for Vibeverk's AUTHENTICATED
// flows, run against vibeverk-staging. See SKILL.md in this same directory
// before running anything — especially the "NEVER point this at
// production" warning and the required env vars.
//
// Usage (run from the repo root, with the local static server already
// running on :8080 — see SKILL.md "Run"):
//   node .claude/skills/smoke-vibeverk/runner.js <flow>
// <flow> is one of: dashboard-shortcuts | all

const { chromium } = require("playwright");
const path = require("path");
const fs = require("fs");
const os = require("os");
const { execFileSync } = require("child_process");

const REPO_ROOT = path.join(__dirname, "..", "..", "..");
const CONFIG_PATH = path.join(REPO_ROOT, "config.js");
const BASE_URL = process.env.VIBEVERK_URL || "http://localhost:8080";
const SHOT_DIR = path.join(__dirname, "screenshots");
fs.mkdirSync(SHOT_DIR, { recursive: true });

const STAMP = Date.now();
const TAG = "SMOKETEST-" + STAMP;

const PROD_REF = "clzczbyklgdtdhgjphup";
const STAGING_URL = process.env.VW_STAGING_SUPABASE_URL;
const STAGING_ANON_KEY = process.env.VW_STAGING_SUPABASE_ANON_KEY;
const ADMIN_EMAIL = process.env.VW_STAGING_ADMIN_EMAIL;
const ADMIN_PASSWORD = process.env.VW_STAGING_ADMIN_PASSWORD;
const STAGING_DB_URL = process.env.VW_STAGING_DB_URL;

// ── Direct SQL against vibeverk-staging (arrange/assert steps only -- the
// actual code path under test always goes through the real UI/Edge Function,
// never through this helper). Uses `npx supabase db query --file` per
// CLAUDE.md's rule (never an inline multi-line string -- a temp file avoids
// the documented silent-truncation footgun). Requires VW_STAGING_DB_URL (the
// staging pooler connection string), a DIFFERENT credential than the anon
// key above -- see SKILL.md.
//
// Verified live 2026-07-17 against real vibeverk-staging: the CLI prints a
// "Connecting to remote database..." line, then a PRETTY-PRINTED (multi-line,
// indented) JSON object shaped { boundary, rows: [...], warning }, NOT one
// JSON blob per line -- an earlier version of this function assumed
// line-by-line JSON and would never have matched real output. Slicing from
// the first "{" to the last "}" in the whole stdout handles the leading
// status line and the multi-line body correctly.
function runStagingSql(sql) {
  if (!STAGING_DB_URL) {
    console.error("Set VW_STAGING_DB_URL first (staging pooler connection string). See SKILL.md.");
    process.exit(1);
  }
  const tmpFile = path.join(os.tmpdir(), "smoke-vibeverk-" + Date.now() + "-" + Math.random().toString(36).slice(2) + ".sql");
  fs.writeFileSync(tmpFile, sql);
  try {
    // shell: true is required here -- Windows can't spawn the `npx.cmd`
    // shim without it (tried removing it 2026-07-17: EINVAL). Node warns
    // this leaves args unescaped on Windows, but none of these values (a
    // repo-local temp file path, an operator-supplied DB URL) are
    // attacker-controlled -- this is a local dev/CI test tool, not code that
    // ever runs against untrusted input.
    const out = execFileSync(
      "npx",
      ["supabase", "db", "query", "--db-url", STAGING_DB_URL, "--file", tmpFile, "--output-format", "json"],
      { encoding: "utf8", shell: true }
    );
    const firstBrace = out.indexOf("{");
    const lastBrace = out.lastIndexOf("}");
    if (firstBrace === -1 || lastBrace === -1 || lastBrace < firstBrace) {
      // Expected for INSERT/UPDATE/DELETE -- the CLI prints a plain
      // "INSERT 0 1"/"DELETE 1" style tag line for those, not a JSON object
      // (verified live 2026-07-17); only SELECT-style queries return rows.
      // Not an error unless the caller actually expected rows back.
      console.log("runStagingSql: no JSON object in output (expected for INSERT/UPDATE/DELETE):", out.trim());
      return null;
    }
    try {
      return JSON.parse(out.slice(firstBrace, lastBrace + 1));
    } catch (e) {
      console.error("runStagingSql: JSON.parse failed:", e.message, "-- raw output:", out);
      return null;
    }
  } finally {
    fs.unlinkSync(tmpFile);
  }
}

function shotPath(name) { return path.join(SHOT_DIR, name + ".png"); }

// ── config.js swap, with a hard safety guard ────────────────────────────────
// Never trust the swap silently worked -- re-read the written file and
// refuse to proceed if it still resolves to production, or doesn't resolve
// to the expected staging ref.
function swapConfigToStaging() {
  if (!STAGING_URL || !STAGING_ANON_KEY) {
    console.error("Set VW_STAGING_SUPABASE_URL and VW_STAGING_SUPABASE_ANON_KEY first. See SKILL.md.");
    process.exit(1);
  }
  const original = fs.readFileSync(CONFIG_PATH, "utf8");
  if (original.indexOf(PROD_REF) === -1) {
    console.error("FATAL: config.js does not currently contain the expected production ref (" + PROD_REF + ") -- refusing to swap. Has config.js already been modified? Check `git status` before re-running.");
    process.exit(1);
  }

  // First live run (2026-07-17) surfaced a real gap: config.js's repo default
  // has intranettFeatures.kb: false, so the KB module never registers at all
  // -- the dashboard-shortcuts flow's KB half failed not because of a
  // regression, but because the feature it exercises was off. Force it on
  // for the duration of the swap only (restored along with everything else
  // in restoreConfig(), which restores the WHOLE original file content) --
  // this is the one deliberate exception to "every other field stays
  // whatever's in the repo", scoped narrowly to the single flag a flow in
  // this suite actually exercises.
  const swapped = original
    .replace(/url:\s*"https:\/\/[^"]+\.supabase\.co"/, 'url:     "' + STAGING_URL + '"')
    .replace(/anonKey:\s*"[^"]+"/, 'anonKey: "' + STAGING_ANON_KEY + '"')
    .replace(/storageKey:\s*"[^"]+"/, 'storageKey: "nordpunkt-smoketest"')
    .replace(/kb:\s*false/, "kb:            true");

  fs.writeFileSync(CONFIG_PATH, swapped);

  // Hard guard: re-read what actually landed on disk, don't trust the
  // in-memory string we just wrote.
  const written = fs.readFileSync(CONFIG_PATH, "utf8");
  const stagingRef = STAGING_URL.replace(/^https:\/\//, "").split(".")[0];
  if (written.indexOf(PROD_REF) !== -1) {
    fs.writeFileSync(CONFIG_PATH, original);
    console.error("FATAL: config.js STILL contains the production ref after swap -- restored original and aborting. Do not proceed.");
    process.exit(1);
  }
  if (written.indexOf(stagingRef) === -1) {
    fs.writeFileSync(CONFIG_PATH, original);
    console.error("FATAL: config.js does not contain the expected staging ref (" + stagingRef + ") after swap -- restored original and aborting.");
    process.exit(1);
  }
  console.log("config.js safely swapped to staging ref:", stagingRef, "(intranettFeatures.kb forced on for this run)");
  return original;
}

function restoreConfig(original) {
  fs.writeFileSync(CONFIG_PATH, original);
  const restored = fs.readFileSync(CONFIG_PATH, "utf8");
  if (restored !== original) {
    console.error("WARNING: config.js restore did not produce a byte-identical result -- check `git diff config.js` manually before doing anything else.");
    process.exit(1);
  }
  console.log("config.js restored to original.");
}

async function withAdminPage(fn) {
  if (!ADMIN_EMAIL || !ADMIN_PASSWORD) {
    console.error("Set VW_STAGING_ADMIN_EMAIL and VW_STAGING_ADMIN_PASSWORD first. See SKILL.md.");
    process.exit(1);
  }
  const browser = await chromium.launch();
  const page = await (await browser.newContext()).newPage();
  const errors = [];
  page.on("console", (msg) => { if (msg.type() === "error") errors.push(msg.text()); });
  page.on("pageerror", (err) => errors.push("pageerror: " + err.message));
  let ok = true;
  try {
    await fn(page);
  } catch (e) {
    ok = false;
    console.error("FLOW FAILED:", e.message);
  } finally {
    console.log("Console errors captured:", errors.length);
    errors.forEach((e) => console.log("  -", e));
    await browser.close();
  }
  return ok;
}

// IDEMPOTENT -- safe to call multiple times in the same run. First live run
// of flowBackupRestore (2026-07-18) surfaced a real bug: this flow logs in
// via BOTH Workspace and Web-admin in the same browser session (they share
// one Supabase Auth session, same origin), so a second loginWebAdmin() call
// after Workspace already authenticated landed straight on the admin panel
// -- the #admin-email login form never rendered at all, and the old
// unconditional waitForSelector("#admin-email") just timed out after 10s.
// Checking for the POST-login marker FIRST (short timeout) and skipping the
// form-fill entirely when already authenticated fixes this for both helpers.
async function loginWorkspaceAdmin(page) {
  await page.goto(BASE_URL + "/workspace/", { waitUntil: "networkidle" });
  const alreadyIn = await page.waitForSelector("#intranet-nav, .i-nav", { timeout: 3000 }).catch(() => null);
  if (alreadyIn) return;
  await page.waitForSelector("#intranet-email", { timeout: 10000 });
  await page.fill("#intranet-email", ADMIN_EMAIL);
  await page.fill("#intranet-pass", ADMIN_PASSWORD);
  await page.click("#intranet-login-btn");
  await page.waitForSelector("#intranet-nav, .i-nav", { timeout: 15000 });
}

// Web-admin (the site's OWN admin panel, #admin) is a THIRD, distinct login
// path from loginWorkspaceAdmin -- reached directly via the #admin hash (no
// triple-click-footer needed), a different form (#admin-email/#admin-pass,
// not #intranet-email/#intranet-pass). This is where "Sikkerhetskopi" lives.
async function loginWebAdmin(page) {
  await page.goto(BASE_URL + "/#admin", { waitUntil: "networkidle" });
  const alreadyIn = await page.waitForSelector(".admin-catbar, .tabs", { timeout: 3000 }).catch(() => null);
  if (alreadyIn) return;
  await page.waitForSelector("#admin-email", { timeout: 10000 });
  await page.fill("#admin-email", ADMIN_EMAIL);
  await page.fill("#admin-pass", ADMIN_PASSWORD);
  // requestSubmit() via evaluate, not a guessed submit-button selector --
  // same technique confirmed reliable during this feature's own manual
  // live-browser verification (clicking coordinates/selectors on this exact
  // form proved flaky; direct form submission did not).
  await page.evaluate(() => document.querySelector("[data-login]").requestSubmit());
  await page.waitForSelector(".admin-catbar, .tabs", { timeout: 15000 });
}

// ── Flow: dashboard shortcuts (KB + announcements) ──────────────────────────
// Regression coverage for a real, previously-shipped bug (CHANGELOG 0.32.x):
// the "Ny kunngjøring"/"Ny artikkel" dashboard shortcuts used to race the
// async load of the announcements/KB list, so the editor sometimes failed to
// open. window._annOpenNew()/window._kbOpenNew() set a flag mount() checks
// once loading is actually done, instead of a fixed-delay click. This flow
// asserts the editor is open immediately after navigation -- no manual
// follow-up click, no retry.
async function flowDashboardShortcuts(page) {
  await loginWorkspaceAdmin(page);
  await page.screenshot({ path: shotPath("dash-shortcuts-login") });

  // Announcements shortcut
  await page.click('[data-dash-new-ann]');
  await page.waitForSelector("#ann-editor #ann-title", { timeout: 8000 });
  await page.screenshot({ path: shotPath("dash-shortcuts-ann-editor-open") });
  console.log("Announcement editor opened immediately after dashboard shortcut: OK");

  // Back to dashboard via URL hash (no guessed nav-link selector), then KB shortcut
  await page.goto(BASE_URL + "/workspace/#/dashboard", { waitUntil: "networkidle" });
  await page.waitForSelector('[data-dash-new-kb]', { timeout: 8000 });
  await page.click('[data-dash-new-kb]');
  await page.waitForSelector("#kb-editor-area #kb-title", { timeout: 8000 });
  await page.screenshot({ path: shotPath("dash-shortcuts-kb-editor-open") });
  console.log("KB editor opened immediately after dashboard shortcut: OK");
}

// ── Flow: user deletion ─────────────────────────────────────────────────────
// Regression coverage for supabase/migrations/20260712203346_fix_user_delete_
// fk_restrict.sql: removing a Workspace user used to fail with an opaque
// "Feil: {}" the instant that user had ever authored a task/announcement/KB
// article, because those tables' author FKs had no ON DELETE clause. Fixed
// to ON DELETE SET NULL -- content survives, only the author reference is
// cleared. This flow drives the REAL invite/remove UI (module-users.js) for
// the actual code path under test (manage-user Edge Function), and uses
// runStagingSql() only for the parts no UI exposes: creating a task
// pre-authored by the throwaway member (a real member never logs in here --
// there's no password/email-link step in this suite, see SKILL.md), and
// reading back created_by afterwards.
async function flowUserDeletion(page) {
  await loginWorkspaceAdmin(page);

  const email = "smoketest-" + STAMP + "@vibeverk-test.invalid";
  const name = TAG;
  const taskTitle = TAG + " task";
  let uid = null;

  try {
    // 1) Invite a throwaway member via the real "Brukere" UI.
    await page.goto(BASE_URL + "/workspace/#/users", { waitUntil: "networkidle" });
    await page.waitForSelector("#u-email", { timeout: 10000 });
    await page.fill("#u-email", email);
    await page.fill("#u-name", name);
    await page.click("#u-invite-btn");
    // Wait for the status text to settle (either "sendt" or an error), then
    // check its actual content -- surfaces the real error text (e.g. a
    // Supabase Auth email rate limit) instead of a bare, uninformative
    // timeout if the invite fails for a reason outside this flow's control.
    await page.waitForFunction(
      () => {
        const t = (document.getElementById("u-invite-status") || {}).textContent || "";
        return t.length > 0 && t !== "Sender…";
      },
      { timeout: 15000 }
    ).catch(() => {});
    const inviteStatusText = await page.textContent("#u-invite-status");
    if (!inviteStatusText || inviteStatusText.indexOf("sendt") === -1) {
      throw new Error('Invitasjon feila eller tok for lang tid -- statustekst: "' + (inviteStatusText || "(tom)") + '"');
    }
    await page.screenshot({ path: shotPath("user-deletion-invited") });

    // List re-renders ~1.5s after a successful invite (see module-users.js) --
    // wait for the new row's remove-button to actually appear rather than a
    // fixed sleep, then read its real data-uid straight from the DOM.
    const rowSelector = '.u-remove-btn[data-name="' + name + '"]';
    await page.waitForSelector(rowSelector, { timeout: 10000 });
    uid = await page.getAttribute(rowSelector, "data-uid");
    if (!uid) throw new Error("Kunne ikkje lese data-uid for den nyinviterte brukaren");
    console.log("Throwaway member invited, id:", uid);

    // 2) Arrange: give that member an authored task directly (no UI path
    // exists for "log in as the invited member" in this suite).
    // status CHECK constraint only allows todo/in_progress/done (baseline_schema.sql:91).
    runStagingSql(
      "insert into tasks (title, status, created_by) values ('" +
        taskTitle.replace(/'/g, "''") + "', 'todo', '" + uid + "');"
    );
    console.log("Arranged: task '" + taskTitle + "' created_by the throwaway member");

    // 3) Act: remove the member via the real Workspace UI (accept the
    // native confirm() dialog module-users.js shows).
    page.once("dialog", (d) => d.accept());
    await page.click(rowSelector);
    await page.waitForSelector(rowSelector, { state: "detached", timeout: 10000 });
    await page.screenshot({ path: shotPath("user-deletion-removed") });
    console.log("Throwaway member removed via real UI: OK");

    // 4) Assert: the task survived, author reference nulled -- not the
    // FK-violation ("Feil: {}") this migration fixed, and not a silent
    // cascade-delete of the content either.
    const result = runStagingSql(
      "select id, created_by from tasks where title = '" + taskTitle.replace(/'/g, "''") + "';"
    );
    const rows = (result && result.rows) || [];
    if (!rows.length) throw new Error("Oppgåva forsvann -- innhaldet skulle overleve brukarsletting, ikkje kaskadeslettast");
    if (rows[0].created_by !== null) throw new Error("created_by vart IKKJE nulla ut (fann: " + rows[0].created_by + ") -- forventa NULL etter fjerning av forfattaren");
    console.log("Task survived removal with created_by nulled: OK");
  } finally {
    // Clean up the task row regardless of outcome.
    try { runStagingSql("delete from tasks where title = '" + taskTitle.replace(/'/g, "''") + "';"); }
    catch (e) { console.error("Cleanup warning: could not delete test task:", e.message); }
    // Safety net: if step 3 (real UI removal) never ran or never completed
    // -- an earlier failed run left exactly this kind of orphan behind, see
    // docs/project/CHANGELOG.md 2026-07-17 -- best-effort remove the
    // throwaway member directly so a failed run doesn't leave a stray test
    // user on staging. This does NOT replace step 3 as the code path under
    // test; it only runs at all if that step didn't already succeed.
    if (uid) {
      try {
        const check = runStagingSql("select id from users where id = '" + uid + "';");
        const stillExists = check && (check.rows || []).length > 0;
        if (stillExists) {
          runStagingSql("delete from auth.users where id = '" + uid + "';");
          console.log("Cleanup: removed orphaned throwaway member (real UI removal step didn't complete this run)");
        }
      } catch (e) { console.error("Cleanup warning: could not verify/remove throwaway member:", e.message); }
    }
  }
}

// ── Flow: backup/restore ────────────────────────────────────────────────────
// Test-coverage designed by the QA agent 2026-07-18 before this was written
// (see docs/roadmap/ROADMAP.md "Next" item 5). Regression coverage for the
// 2026-07-06 external Codex-review BLOCKER: the old client-orchestrated
// restore did delete-then-insert per table with NO transaction, so a failure
// partway through left some tables wiped and others not. The fix
// (supabase/migrations/20260713104738_restore_backup_tables_rpc.sql) deletes
// all nine tables and re-inserts in FK-safe order INSIDE ONE transaction --
// any failure anywhere rolls back everything. To actually reproduce the old
// failure mode (not just the earlier, separate manifest-shape validation),
// the corrupted payload must PASS structural validation but fail DURING an
// INSERT -- an invalid `status` value on one `tasks` row (CHECK constraint
// only allows todo/in_progress/done) does exactly this, since tasks inserts
// after five other tables have already succeeded in the same call.
//
// Snapshot-restore-self pattern throughout: export_backup_tables() at the
// very start (via page.evaluate against the already-authenticated admin
// session's own Supabase client, window.App.supabase), every mutation
// undone in a `finally` block by restoring that exact original snapshot --
// self-healing, this flow should never leave staging in a different state
// than it found it in, matching user-deletion's own cleanup discipline. This
// flow's blast radius is categorically LARGER than dashboard-shortcuts/
// user-deletion though: restore_backup_tables() mirror-overwrites ALL NINE
// tables for the whole (single-tenant) project, not a tag-scoped mutation --
// never run this concurrently with anything else touching vibeverk-staging.
async function flowBackupRestore(page) {
  await loginWebAdmin(page);

  async function exportSnapshot() {
    return page.evaluate(async () => {
      const r = await window.App.supabase.rpc("export_backup_tables");
      if (r.error) throw new Error("export_backup_tables failed: " + r.error.message);
      return r.data;
    });
  }
  async function restoreSnapshot(snapshot) {
    return page.evaluate(async (snap) => {
      const r = await window.App.supabase.rpc("restore_backup_tables", { p_tables: snap });
      return { error: r.error ? r.error.message : null, data: r.data };
    }, snapshot);
  }
  async function countAll() {
    return page.evaluate(async () => {
      const tables = ["crm_bedrifter","crm_customers","crm_comms","leads","bookings","tasks","announcements","kb_articles","links"];
      const out = {};
      for (const t of tables) {
        const r = await window.App.supabase.from(t).select("*", { count: "exact", head: true });
        out[t] = r.count;
      }
      return out;
    });
  }

  const baseline = await exportSnapshot();
  let memberUid = null;
  const taskTitle = TAG + " backup-restore task";

  try {
    // A) Export completeness -- all nine keys present as arrays, even when empty.
    const expectedTables = ["crm_bedrifter","crm_customers","crm_comms","leads","bookings","tasks","announcements","kb_articles","links"];
    for (const t of expectedTables) {
      if (!Array.isArray(baseline[t])) throw new Error("export_backup_tables() mangla eller feilforma nøkkelen '" + t + "'");
    }
    console.log("Export inneheld alle ni tabellar som array (inkl. tomme): OK");

    // Also exercise the REAL export button + a real browser download event,
    // not just the RPC call above -- the actual UI code path under test.
    await page.click('[data-admin-cat="innstillinger"]');
    await page.click('[data-tab="sikkerhetskopi"]');
    await page.waitForSelector("[data-backup-export]", { timeout: 8000 });
    const [download] = await Promise.all([
      page.waitForEvent("download", { timeout: 15000 }),
      page.click("[data-backup-export]"),
    ]);
    const downloadPath = await download.path();
    const downloadedPayload = JSON.parse(fs.readFileSync(downloadPath, "utf8"));
    if (!downloadedPayload.vibeverk_backup || downloadedPayload.version !== 2) {
      throw new Error("Nedlasta fil manglar vibeverk_backup/version-felta -- er formatet endra utan at denne testen er oppdatert?");
    }
    console.log("Ekte nedlasting via [data-backup-export]-knappen: OK");

    // D) FK author-nulling regression (20260712203346_fix_user_delete_fk_restrict.sql).
    // Invite a throwaway member via the real Workspace UI (same pattern as
    // flowUserDeletion -- no login path exists for an invited member in this
    // suite), author a task for them, snapshot WHILE that reference is still
    // live, delete the member, then restore that snapshot and confirm the
    // restore succeeds (not an FK violation) with created_by nulled.
    await loginWorkspaceAdmin(page);
    await page.goto(BASE_URL + "/workspace/#/users", { waitUntil: "networkidle" });
    await page.waitForSelector("#u-email", { timeout: 10000 });
    const memberEmail = "smoketest-" + STAMP + "-bkp@vibeverk-test.invalid";
    await page.fill("#u-email", memberEmail);
    await page.fill("#u-name", TAG + "-bkp");
    await page.click("#u-invite-btn");
    await page.waitForFunction(() => {
      const t = (document.getElementById("u-invite-status") || {}).textContent || "";
      return t.length > 0 && t !== "Sender…";
    }, { timeout: 15000 }).catch(() => {});
    const inviteStatus = await page.textContent("#u-invite-status");
    if (!inviteStatus || inviteStatus.indexOf("sendt") === -1) {
      throw new Error('Invitasjon feila -- statustekst: "' + (inviteStatus || "(tom)") + '"');
    }
    const rowSel = '.u-remove-btn[data-name="' + TAG + '-bkp"]';
    await page.waitForSelector(rowSel, { timeout: 10000 });
    memberUid = await page.getAttribute(rowSel, "data-uid");
    if (!memberUid) throw new Error("Kunne ikkje lese data-uid for den nyinviterte brukaren");

    runStagingSql("insert into tasks (title, status, created_by) values ('" + taskTitle.replace(/'/g, "''") + "', 'todo', '" + memberUid + "');");
    const snapshotWithMember = await (async () => { await loginWebAdmin(page); return exportSnapshot(); })();

    // Delete the member via the real UI.
    await loginWorkspaceAdmin(page);
    await page.goto(BASE_URL + "/workspace/#/users", { waitUntil: "networkidle" });
    await page.waitForSelector(rowSel, { timeout: 10000 });
    page.once("dialog", (d) => d.accept());
    await page.click(rowSel);
    await page.waitForSelector(rowSel, { state: "detached", timeout: 10000 });
    console.log("Throwaway member (backup-restore) fjerna via ekte UI: OK");

    // Restore the snapshot taken WHILE the (now-deleted) member's task
    // reference was still live -- must succeed (not an FK violation), and
    // the restored row's created_by must come back NULL, not the old uid.
    await loginWebAdmin(page);
    const restoreResultD = await restoreSnapshot(snapshotWithMember);
    if (restoreResultD.error) throw new Error("Gjenoppretting med ein sletta forfattar-referanse feila (skulle nullstille, ikkje feile): " + restoreResultD.error);
    const taskAfterD = runStagingSql("select created_by from tasks where title = '" + taskTitle.replace(/'/g, "''") + "';");
    const taskRowD = (taskAfterD && taskAfterD.rows || [])[0];
    if (!taskRowD) throw new Error("Oppgåva forsvann under gjenoppretting -- skulle overleve med created_by nulla ut");
    if (taskRowD.created_by !== null) throw new Error("created_by vart IKKJE nulla ut ved gjenoppretting (fann: " + taskRowD.created_by + ")");
    console.log("Gjenoppretting med sletta forfattar-referanse: created_by korrekt nulla ut, ingen FK-feil: OK");

    // C) Corrupted-during-INSERT payload is fully rolled back, not partially
    // applied -- THE centerpiece regression test for the 2026-07-06 BLOCKER.
    const beforeCounts = await countAll();
    const corrupted = JSON.parse(JSON.stringify(snapshotWithMember));
    if (!corrupted.tasks.length) throw new Error("Forventa minst éi tasks-rad å korrumpere (den nett gjenoppretta oppgåva) -- testoppsettet er feil");
    corrupted.tasks[0].status = "BOGUS-STATUS-" + STAMP; // valid shape, invalid CHECK-constraint value
    const restoreResultC = await restoreSnapshot(corrupted);
    if (!restoreResultC.error) throw new Error("restore_backup_tables() skulle ha AVVIST ein payload med ein ugyldig tasks.status-verdi, men returnerte ingen feil");
    const afterCounts = await countAll();
    for (const t of Object.keys(beforeCounts)) {
      if (beforeCounts[t] !== afterCounts[t]) {
        throw new Error("BLOCKER-regresjon: radtal for '" + t + "' endra seg (" + beforeCounts[t] + " -> " + afterCounts[t] + ") etter ein AVVIST gjenoppretting -- transaksjonen rulla IKKJE heilt tilbake");
      }
    }
    console.log("Korrumpert payload avvist UTAN delvis datatap på nokon av dei ni tabellane: OK (2026-07-06-regresjon dekt)");
  } finally {
    // Always restore the TRUE original baseline, regardless of which step
    // above failed -- self-healing per this flow's own design.
    try {
      await loginWebAdmin(page);
      const finalRestore = await restoreSnapshot(baseline);
      if (finalRestore.error) console.error("KRITISK opprydding-åtvaring: klarte ikkje gjenopprette den opphavlege baseline-snapshotten:", finalRestore.error);
      else console.log("Baseline-snapshot gjenoppretta -- staging attende i opphavleg tilstand.");
    } catch (e) {
      console.error("KRITISK opprydding-åtvaring: unntak under sluttgjenoppretting:", e.message);
    }
    if (memberUid) {
      try {
        const check = runStagingSql("select id from users where id = '" + memberUid + "';");
        if (check && (check.rows || []).length > 0) {
          runStagingSql("delete from auth.users where id = '" + memberUid + "';");
          console.log("Cleanup: fjerna orphaned throwaway-medlem (backup-restore-flyten sitt eige UI-steg fullførte ikkje denne køyringa)");
        }
      } catch (e) { console.error("Cleanup warning: kunne ikkje verifisere/fjerne throwaway-medlem:", e.message); }
    }
  }
}

// ── Flow: CRM document upload (private bucket + signed URL) ────────────────
// Verifies the C-8 feature (crm-documents private Storage bucket,
// 20260718113648_crm_documents_bucket.sql) actually works end-to-end for a
// real user, not just that the migration applied cleanly -- this is a brand
// new, security-sensitive feature (private bucket + RLS), and the
// backup-restore flow's own first live run (same day) proved that a
// migration applying without error is NOT proof the feature it implements
// actually works (see pg-safeupdate BLOCKER, fixed in
// 20260718175406_fix_restore_backup_tables_safeupdate.sql).
//
// Drives the real UI throughout: new customer -> "Dokument" quick-action ->
// upload a real file via #dlg-dc-file -> save -> click the resulting
// attachment chip in the customer's timeline and confirm the resolve-on-
// click signed-URL path succeeds (see the Chromium/PDF-viewer note below for
// why success is verified via the label's own state, not popup.url()).
// Cleans up in a finally block: frees the real Storage object via
// App.crmDocs.freeCrmDocument() first, then deletes the throwaway
// customer/comm rows via SQL.
async function flowCrmDocuments(page) {
  await loginWorkspaceAdmin(page);

  const custName = TAG + "-crmdoc-kunde";
  const custEmail = "smoketest-" + STAMP + "-crmdoc@vibeverk-test.invalid";

  await page.goto(BASE_URL + "/workspace/#/crm", { waitUntil: "networkidle" });
  await page.waitForSelector("[data-crm-new]", { timeout: 10000 });
  await page.click("[data-crm-new]");
  await page.waitForSelector("#dlg-nc-email", { timeout: 8000 });
  await page.fill("#dlg-nc-name", custName);
  await page.fill("#dlg-nc-email", custEmail);
  await page.click("#dlg-nc-save");

  const rowSel = '[data-crm-open]:has-text("' + custName + '")';
  await page.waitForSelector(rowSel, { timeout: 8000 });
  await page.click(rowSel);
  console.log("Kasteand-kunde (crm-documents) oppretta og opna via ekte UI: OK");

  let chipRef = null;
  try {
    await page.waitForSelector('[data-qa="crm-qa-doc"]', { timeout: 8000 });
    await page.click('[data-qa="crm-qa-doc"]');
    await page.waitForSelector("#dlg-dc-file", { timeout: 8000 });
    await page.fill("#dlg-dc-name", "Smoketest-dokument");
    await page.setInputFiles("#dlg-dc-file", {
      name: "smoketest-" + STAMP + ".pdf",
      mimeType: "application/pdf",
      buffer: Buffer.from("%PDF-1.4\n" + TAG + " test content"),
    });
    // putCrmDocument() is a real network upload to vibeverk-staging's
    // crm-documents bucket -- wait for the status line to clear (upload
    // done) rather than a fixed delay.
    await page.waitForFunction(() => {
      const st = document.querySelector("[data-dc-file-status]");
      return st && st.textContent.trim() === "";
    }, { timeout: 15000 });
    chipRef = await page.getAttribute("[data-dc-att-current] [data-crmdoc-ref]", "data-crmdoc-ref");
    if (!chipRef || chipRef.indexOf("crmdoc:") !== 0) {
      throw new Error('Opplasting ga ikkje ein "crmdoc:"-prefiksa referanse (fann: ' + chipRef + ") -- fell attende til gamal media-sti?");
    }
    console.log("Ekte opplasting til privat crm-documents-bucket ga korrekt crmdoc:-referanse: OK");
    await page.click("#dlg-dc-save");
    await page.waitForSelector("#dlg-dc-save", { state: "detached", timeout: 8000 });

    // Click the SAME attachment chip, now rendered in the customer's
    // timeline (not the dialog) -- this is the resolve-on-click signed-URL
    // path a real user actually exercises after saving.
    await page.waitForSelector('[data-crmdoc-ref="' + chipRef + '"]', { timeout: 8000 });
    // Confirms the RESOLVE mechanism itself (getCrmDocumentUrl -> a real,
    // correctly-scoped signed Storage URL) independent of the click/popup --
    // isolates a genuine backend/RLS success from any browser-level quirk in
    // how the popup navigation surfaces (see below).
    const directUrl = await page.evaluate((ref) => window.App.crmDocs.getCrmDocumentUrl(ref).then((u) => ({ ok: true, u })).catch((e) => ({ ok: false, e: e.message })), chipRef);
    if (!directUrl.ok || directUrl.u.indexOf("/storage/v1/object/sign/crm-documents/") === -1 || directUrl.u.indexOf("token=") === -1) {
      throw new Error("getCrmDocumentUrl() ga ikkje ein gyldig signert crm-documents-URL: " + JSON.stringify(directUrl));
    }
    console.log("getCrmDocumentUrl() gir ein ekte signert URL med korrekt bucket/sti/token: OK");

    // Click the SAME chip in the timeline -- this is the resolve-on-click
    // path a real user exercises. A genuine Chromium quirk (confirmed via
    // manual diagnosis, 2026-07-18): a window.open("","_blank") popup later
    // redirected via win.location.href to a real application/pdf URL gets
    // handled by Chromium's built-in PDF viewer in a way Playwright's
    // popup.url() never reflects (stays "about:blank" even though the
    // redirect genuinely happened) -- NOT a bug in the app. Verifying via the
    // label's own state transition instead ("Opnar …" then back to the
    // filename, never "Kunne ikkje opne") matches exactly what a real user
    // perceives, and is what bindAttachmentChips() itself exposes as its
    // user-facing success/failure signal.
    const [popup] = await Promise.all([
      page.context().waitForEvent("page", { timeout: 15000 }),
      page.click('[data-crmdoc-ref="' + chipRef + '"]'),
    ]);
    const labelSel = '[data-crmdoc-ref="' + chipRef + '"] [data-crmdoc-label]';
    // aria-live="polite" is set once by the click handler and never removed
    // in either the success or failure branch, so it can't be used as a
    // "settled" signal -- wait instead for the transient "Opnar …" text
    // itself to go away (either reverted to the filename on success, or
    // replaced by "Kunne ikkje opne" on failure).
    await page.waitForFunction((sel) => {
      const el = document.querySelector(sel);
      return el && el.textContent.trim() !== "Opnar …";
    }, labelSel, { timeout: 8000 });
    const finalLabel = await page.textContent(labelSel);
    await popup.close().catch(() => {});
    if (finalLabel.indexOf("Kunne ikkje opne") !== -1) {
      throw new Error("Vedleggs-chip synte feilmeldinga «Kunne ikkje opne» etter klikk");
    }
    console.log("Klikk på vedleggs-chip i tidslinja løyste opp og opna ein signert URL utan feil (etikett attende til: «" + finalLabel + "»): OK");
  } finally {
    // Free the actual Storage object FIRST, via the app's own real
    // freeCrmDocument() code path (page.evaluate against the still-open,
    // authenticated page) -- the SQL cleanup below only removes the
    // crm_comms/crm_customers ROWS, it has no way to also call
    // storage.remove(), so skipping this step would leave an orphaned
    // object in the crm-documents bucket every run.
    if (chipRef) {
      try {
        await page.evaluate((ref) => window.App.crmDocs.freeCrmDocument(ref), chipRef);
        console.log("Opplasta Storage-objekt fjerna via App.crmDocs.freeCrmDocument(): OK");
      } catch (e) { console.error("Cleanup warning: kunne ikkje fjerne Storage-objektet:", e.message); }
    }
    try {
      runStagingSql(
        "delete from crm_comms where customer_id in (select id from crm_customers where email = '" + custEmail + "');"
      );
      runStagingSql("delete from crm_customers where email = '" + custEmail + "';");
      console.log("Kasteand-kunde og tilhøyrande hendingar fjerna (SQL-opprydding).");
    } catch (e) { console.error("Cleanup warning: kunne ikkje fjerne kasteand-kunde:", e.message); }
  }
}

const FLOWS = {
  "dashboard-shortcuts": flowDashboardShortcuts,
  "user-deletion": flowUserDeletion,
  "backup-restore": flowBackupRestore,
  "crm-documents": flowCrmDocuments,
};

(async () => {
  const which = process.argv[2] || "dashboard-shortcuts";
  console.log("=== TAG:", TAG, "flow:", which, "===");

  const original = swapConfigToStaging();
  let allOk = true;
  try {
    if (which === "all") {
      for (const name of Object.keys(FLOWS)) {
        console.log("--- flow:", name, "---");
        const ok = await withAdminPage(FLOWS[name]);
        allOk = allOk && ok;
      }
    } else if (FLOWS[which]) {
      allOk = await withAdminPage(FLOWS[which]);
    } else {
      console.error("Unknown flow:", which, "-- known flows:", Object.keys(FLOWS).join(", "));
      allOk = false;
    }
  } finally {
    restoreConfig(original);
  }

  if (!allOk) {
    console.error("=== SMOKE TEST FAILED ===");
    process.exit(1);
  }
  console.log("=== SMOKE TEST PASSED ===");
})();
