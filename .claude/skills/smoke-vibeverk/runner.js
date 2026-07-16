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

  const swapped = original
    .replace(/url:\s*"https:\/\/[^"]+\.supabase\.co"/, 'url:     "' + STAGING_URL + '"')
    .replace(/anonKey:\s*"[^"]+"/, 'anonKey: "' + STAGING_ANON_KEY + '"')
    .replace(/storageKey:\s*"[^"]+"/, 'storageKey: "nordpunkt-smoketest"');

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
  console.log("config.js safely swapped to staging ref:", stagingRef);
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

const FLOWS = {
  "dashboard-shortcuts": flowDashboardShortcuts,
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
