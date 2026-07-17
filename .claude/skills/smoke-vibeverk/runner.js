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

async function loginWorkspaceAdmin(page) {
  await page.goto(BASE_URL + "/workspace/", { waitUntil: "networkidle" });
  await page.waitForSelector("#intranet-email", { timeout: 10000 });
  await page.fill("#intranet-email", ADMIN_EMAIL);
  await page.fill("#intranet-pass", ADMIN_PASSWORD);
  await page.click("#intranet-login-btn");
  await page.waitForSelector("#intranet-nav, .i-nav", { timeout: 15000 });
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

const FLOWS = {
  "dashboard-shortcuts": flowDashboardShortcuts,
  "user-deletion": flowUserDeletion,
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
