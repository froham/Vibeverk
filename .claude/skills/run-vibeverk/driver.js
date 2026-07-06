// driver.js — Playwright driver for running/screenshotting Vibeverk locally.
// See SKILL.md in this same directory before running anything.
//
// WARNING: config.js in this repo points at the REAL production Supabase
// project. Any flow that submits a form (kontakt/tilbud/booking/chat) writes
// a REAL row into the customer's live database. Always tag test data (this
// driver does, via the PWTEST-<timestamp> prefix) and clean up afterward —
// see SKILL.md "Gotchas" for the exact cleanup queries.
//
// Usage (run from the repo root, with the local static server already
// running on :8080 — see SKILL.md "Run (agent path)"):
//   node .claude/skills/run-vibeverk/driver.js <flow>
// <flow> is one of: home | kontakt | tilbud | booking | chat | all
//
// Screenshots land in .claude/skills/run-vibeverk/screenshots/.

const { chromium } = require("playwright");
const path = require("path");
const fs = require("fs");

const BASE_URL = process.env.VIBEVERK_URL || "http://localhost:8080";
const SHOT_DIR = path.join(__dirname, "screenshots");
fs.mkdirSync(SHOT_DIR, { recursive: true });

const STAMP = Date.now();
const TAG = "PWTEST-" + STAMP;

function shotPath(name) { return path.join(SHOT_DIR, name + ".png"); }

async function withPage(fn) {
  const browser = await chromium.launch();
  const page = await (await browser.newContext()).newPage();
  const consoleErrors = [];
  page.on("console", (msg) => { if (msg.type() === "error") consoleErrors.push(msg.text()); });
  page.on("pageerror", (err) => consoleErrors.push("pageerror: " + err.message));
  try {
    await fn(page);
  } finally {
    console.log("Console errors captured:", consoleErrors.length);
    consoleErrors.forEach((e) => console.log("  -", e));
    await browser.close();
  }
}

async function flowHome(page) {
  await page.goto(BASE_URL + "/", { waitUntil: "networkidle" });
  await page.screenshot({ path: shotPath("home") });
  console.log("Title:", await page.title());
}

async function flowKontakt(page) {
  await page.goto(BASE_URL + "/", { waitUntil: "networkidle" });
  await page.locator("#kontakt").scrollIntoViewIfNeeded();
  await page.fill("#lead-name", TAG + "-kontakt");
  await page.fill("#lead-email", "pwtest+" + STAMP + "@example.com");
  await page.fill("#lead-message", "Driver smoke test — " + TAG);
  const terms = page.locator("#lead-terms");
  if (await terms.count()) await terms.check();
  await page.screenshot({ path: shotPath("kontakt-before") });
  await page.click('[data-contact-form] button[type="submit"]');
  await page.waitForTimeout(1200); // fire-and-forget RPC round trip
  const status = await page.locator("[data-contact-form] [data-form-status]").textContent();
  console.log("Kontakt status:", status);
  await page.screenshot({ path: shotPath("kontakt-after") });
}

async function flowTilbud(page) {
  await page.goto(BASE_URL + "/#tilbud", { waitUntil: "networkidle" });
  await page.waitForSelector("[data-qt-form1]", { timeout: 10000 });
  // Must be a MIME type the "media" Storage bucket's allowlist actually
  // accepts (images/pdf/doc/xls) — a plain .txt gets a real, separate
  // "mime type text/plain is not supported" error, NOT the RLS bug this
  // flow exists to catch. A minimal valid 1x1 PNG satisfies the allowlist.
  const testFile = path.join(SHOT_DIR, "..", "test-attachment.png");
  const onePixelPng = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
    "base64"
  );
  fs.writeFileSync(testFile, onePixelPng);
  await page.setInputFiles("[data-qt-files]", testFile);
  await page.fill("#qt-desc", "Driver smoke test av Tilbud — " + TAG);
  await page.click("[data-qt-next1]");
  await page.waitForSelector("[data-qt-form2]", { timeout: 10000 });
  await page.fill("#qt-name", TAG + "-tilbud");
  await page.fill("#qt-email", "pwtest+" + STAMP + "-tilbud@example.com");
  const terms = page.locator("#qt-terms");
  if (await terms.count()) await terms.check();
  await page.screenshot({ path: shotPath("tilbud-before") });
  await page.click('[data-qt-form2] button[type="submit"]');
  await page.waitForSelector(".qt-receipt", { timeout: 15000 }).catch(() => {});
  await page.waitForTimeout(800);
  await page.screenshot({ path: shotPath("tilbud-after") });
  const receiptVisible = (await page.locator(".qt-receipt").count()) > 0;
  console.log("Tilbud receipt visible:", receiptVisible);
  if (!receiptVisible) {
    console.log("Tilbud error text:", await page.locator("[data-qt-err2]").textContent().catch(() => "(none)"));
  }
  fs.unlinkSync(testFile);
}

async function flowBooking(page) {
  await page.goto(BASE_URL + "/#booking", { waitUntil: "networkidle" });
  await page.waitForTimeout(800);
  await page.screenshot({ path: shotPath("booking-page") });
  const assets = page.locator("#booking .bk-asset");
  const count = await assets.count();
  console.log("Booking assets found:", count);
  let instant = null, title = null;
  for (let i = 0; i < count; i++) {
    const el = assets.nth(i);
    if ((await el.locator(".bk-badge--instant").count()) === 0) { instant = el; title = await el.locator(".bk-asset__title").textContent(); break; }
  }
  if (!instant) { console.log("No instant-booking asset found — nothing to test"); return; }
  console.log("Using asset:", title);
  const cell = instant.locator(".bk-cal__cell--available[data-cal-date]").first();
  if (await cell.count()) await cell.click();
  const slot = instant.locator(".bk-slot:not(.is-booked)").first();
  if (!(await slot.count())) { console.log("No available slot — nothing to test"); return; }
  const date = await cell.getAttribute("data-cal-date").catch(() => null);
  const time = await slot.getAttribute("data-time").catch(() => null);
  await slot.click();
  console.log("Selected:", date, time);
  const form = instant.locator("[data-confirm-form]");
  if (!(await form.count())) { console.log("No confirm form appeared"); return; }
  // NOTE: name/phone/message fields are all type="text" — target by id prefix,
  // NOT input[type="text"] (matches 3 elements, Playwright strict mode throws).
  await form.locator('input[id^="bkc-name-"]').fill(TAG + "-booking");
  await form.locator('input[type="email"]').fill("pwtest+" + STAMP + "-booking@example.com");
  await form.locator('input[type="checkbox"]').check();
  await page.screenshot({ path: shotPath("booking-confirm-before") });
  await form.locator('button[type="submit"]').click();
  await page.waitForTimeout(2200); // submitAnonBooking()'s RPC round trip
  await page.screenshot({ path: shotPath("booking-confirm-after") });
  console.log("Success message:", await instant.locator(".bk-confirm__ok").textContent().catch(() => null));
  console.log("Status message:", await instant.locator("[data-cstatus]").textContent().catch(() => null));
  console.log("Asset/date/time/ref needed for production cleanup — see SKILL.md");
}

async function flowChat(page) {
  console.log("NOTE: chat only shows the live-conversation form if the");
  console.log("'chat-availability' store key is fresh (client enforces an 8h");
  console.log("expiry) — otherwise you'll get the offline lead-capture form");
  console.log("instead. See SKILL.md Gotchas before assuming this flow is broken.");
  await page.goto(BASE_URL + "/", { waitUntil: "networkidle" });
  await page.waitForSelector("#vw-btn", { timeout: 10000 });
  await page.click("#vw-btn");
  await page.waitForTimeout(500);
  await page.screenshot({ path: shotPath("chat-widget-open") });
  const startBtn = page.locator("#vw-start-btn");
  if (await startBtn.count()) {
    await page.fill("#vw-name-inp", TAG);
    await page.fill("#vw-email-inp", "pwtest+" + STAMP + "-chat@example.com");
    const terms = page.locator("#vw-terms-cb");
    if (await terms.count()) await terms.check();
    await page.click("#vw-start-btn");
    await page.waitForTimeout(1200);
  } else {
    console.log("No start form — likely the offline fallback (see note above), or a conversation is already active.");
  }
  const inp = page.locator("#vw-inp");
  await inp.waitFor({ timeout: 8000 }).catch(() => {});
  if (await inp.count()) {
    await inp.fill("Driver smoke test — " + TAG);
    await page.click("#vw-send");
    await page.waitForTimeout(1500);
    await page.screenshot({ path: shotPath("chat-after-send") });
    console.log("Last visitor bubble:", await page.locator(".vw-msg--vis").last().textContent().catch(() => null));
  } else {
    console.log("No message input found — chat did not start (see offline-form note above)");
  }
}

const FLOWS = { home: flowHome, kontakt: flowKontakt, tilbud: flowTilbud, booking: flowBooking, chat: flowChat };

(async () => {
  const which = process.argv[2] || "home";
  console.log("=== TAG:", TAG, "flow:", which, "===");
  if (which === "all") {
    for (const name of ["home", "kontakt", "tilbud", "booking", "chat"]) {
      console.log("--- " + name + " ---");
      await withPage(FLOWS[name]);
    }
  } else if (FLOWS[which]) {
    await withPage(FLOWS[which]);
  } else {
    console.error("Unknown flow:", which, "— use one of:", Object.keys(FLOWS).join(", "), "or 'all'");
    process.exit(1);
  }
  console.log("=== DONE, tag:", TAG, "===");
})().catch((err) => { console.error("FATAL:", err); process.exit(1); });
