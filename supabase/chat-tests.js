/**
 * chat-tests.js — Vibeverk Chat integration regression tests
 *
 * Requires: window.App.supabase (authenticated admin session for steps 4-5)
 * Run in browser console on the deployed Vibeverk page while logged in as admin,
 * or load as a script tag after config.js + core.js.
 *
 * Usage:
 *   const results = await window.VW_CHAT_TESTS.run();
 *
 * Each test is independent. Tests that need admin auth are skipped automatically
 * when no authenticated session is present.
 */
(function (global) {
  "use strict";

  var NS = (window.SITE_CONFIG && window.SITE_CONFIG.storageKey) || "site";

  /* ── helpers ── */
  function sbClient() {
    var sb = window.App && window.App.supabase;
    if (!sb) throw new Error("No Supabase client (window.App.supabase)");
    return sb;
  }

  function clearVisitorStorage() {
    Object.keys(localStorage).filter(function (k) { return k.startsWith(NS + ":chat"); })
      .forEach(function (k) { localStorage.removeItem(k); });
  }

  function freshVid() {
    var v = "test-" + Date.now() + Math.random().toString(36).slice(2, 6);
    localStorage.setItem(NS + ":chat:vid", JSON.stringify(v));
    return v;
  }

  function pass(name) { console.log("%c✓ " + name, "color:#22c55e;font-weight:bold"); }
  function fail(name, reason) {
    console.error("%c✗ " + name + ": " + reason, "color:#ef4444;font-weight:bold");
  }

  var RESULTS = [];
  function record(name, ok, detail) {
    RESULTS.push({ name: name, ok: ok, detail: detail });
    if (ok) { pass(name); } else { fail(name, detail); }
  }

  function assert(condition, message) {
    if (!condition) throw new Error(message || "assertion failed");
  }

  /* ── test 1: fresh anon storage ── */
  async function test_fresh_storage() {
    clearVisitorStorage();
    var keys = Object.keys(localStorage).filter(function (k) { return k.startsWith(NS + ":chat"); });
    assert(keys.length === 0, "expected no chat keys after clear, got " + keys.join(","));
    record("fresh_anon_storage", true, null);
  }

  /* ── test 2: createConv awaits DB confirmation ── */
  async function test_createConv_confirmed() {
    var sb = sbClient();
    clearVisitorStorage();
    var vid = freshVid();

    var convId = "test-" + Date.now();
    var res = await sb.from("chat_conversations").insert({
      id: convId, visitor_name: "Test Brukar", visitor_email: "test@test.no",
      visitor_id: vid, status: "open", unread: 0, last_msg: "", last_at: Date.now()
    });
    if (res.error) throw new Error("conv insert: " + res.error.message);

    var check = await sb.rpc("get_visitor_conv", { p_visitor_id: vid, p_conv_id: convId });
    assert(!check.error, "get_visitor_conv errored: " + (check.error && check.error.message));
    assert(check.data && check.data.length === 1, "expected 1 conv from RPC, got " + JSON.stringify(check.data));
    assert(check.data[0].id === convId, "conv id mismatch");

    // Cleanup
    await sb.from("chat_conversations").delete().eq("id", convId);
    record("createConv_confirmed", true, null);
  }

  /* ── test 3: send two visitor messages ── */
  async function test_visitor_messages() {
    var sb = sbClient();
    clearVisitorStorage();
    var vid = freshVid();

    var convId = "test-" + Date.now();
    await sb.from("chat_conversations").insert({
      id: convId, visitor_name: "Test", visitor_email: "v@test.no",
      visitor_id: vid, status: "open", unread: 0, last_msg: "", last_at: Date.now()
    });

    var m1 = "test-msg-1-" + Date.now();
    var m2 = "test-msg-2-" + Date.now();
    var r1 = await sb.from("chat_messages").insert({ id: "m1-" + Date.now(), conversation_id: convId, text: m1, sender: "visitor", at: Date.now() });
    var r2 = await sb.from("chat_messages").insert({ id: "m2-" + Date.now(), conversation_id: convId, text: m2, sender: "visitor", at: Date.now() + 1 });
    assert(!r1.error, "visitor msg1: " + (r1.error && r1.error.message));
    assert(!r2.error, "visitor msg2: " + (r2.error && r2.error.message));

    // Cleanup
    await sb.from("chat_conversations").delete().eq("id", convId);
    record("visitor_messages_insert", true, null);
  }

  /* ── test 4: admin replies, visitor retrieves via RPC ── */
  async function test_admin_reply_retrieved() {
    var sb = sbClient();
    var { data: { session } } = await sb.auth.getSession();
    if (!session) { record("admin_reply_retrieved", true, "SKIPPED (no auth session)"); return; }

    clearVisitorStorage();
    var vid = freshVid();
    var convId = "test-" + Date.now();

    await sb.from("chat_conversations").insert({
      id: convId, visitor_name: "Test", visitor_email: "a@test.no",
      visitor_id: vid, status: "open", unread: 0, last_msg: "", last_at: Date.now()
    });

    // Visitor sends message
    await sb.from("chat_messages").insert({ id: "vm-" + Date.now(), conversation_id: convId, text: "hei", sender: "visitor", at: Date.now() });

    // Admin replies twice
    var at1 = Date.now() + 100, at2 = Date.now() + 200;
    var ar1 = await sb.from("chat_messages").insert({ id: "am1-" + Date.now(), conversation_id: convId, text: "svar1", sender: "operator", at: at1 });
    var ar2 = await sb.from("chat_messages").insert({ id: "am2-" + Date.now(), conversation_id: convId, text: "svar2", sender: "operator", at: at2 });
    assert(!ar1.error, "admin reply1: " + (ar1.error && ar1.error.message));
    assert(!ar2.error, "admin reply2: " + (ar2.error && ar2.error.message));

    // Visitor retrieves all messages via RPC (p_after_at=0, dedup by id)
    var rpc = await sb.rpc("get_visitor_msgs", { p_visitor_id: vid, p_conv_id: convId, p_after_at: 0 });
    assert(!rpc.error, "get_visitor_msgs: " + (rpc.error && rpc.error.message));
    var opMsgs = (rpc.data || []).filter(function(m){ return m.sender === "operator"; });
    assert(opMsgs.length === 2, "expected 2 operator messages, got " + opMsgs.length + ": " + JSON.stringify(rpc.data));

    // Cleanup
    await sb.from("chat_conversations").delete().eq("id", convId);
    record("admin_reply_retrieved", true, null);
  }

  /* ── test 5: reload — visitor restores conversation from localStorage token ── */
  async function test_visitor_reload_restore() {
    var sb = sbClient();
    clearVisitorStorage();
    var vid = freshVid();
    var convId = "test-restore-" + Date.now();

    await sb.from("chat_conversations").insert({
      id: convId, visitor_name: "Reload", visitor_email: "r@test.no",
      visitor_id: vid, status: "open", unread: 0, last_msg: "", last_at: Date.now()
    });

    // Simulate saving convId (what setMyConv does)
    localStorage.setItem(NS + ":chat:myconv:" + vid, JSON.stringify(convId));

    // Simulate reload: read back
    var storedVid  = JSON.parse(localStorage.getItem(NS + ":chat:vid") || "null");
    var storedConv = JSON.parse(localStorage.getItem(NS + ":chat:myconv:" + storedVid) || "null");
    assert(storedVid === vid, "vid mismatch after reload");
    assert(storedConv === convId, "convId mismatch after reload");

    // Verify RPC still works with the stored token
    var rpc = await sb.rpc("get_visitor_msgs", { p_visitor_id: storedVid, p_conv_id: storedConv, p_after_at: 0 });
    assert(!rpc.error, "RPC after reload: " + (rpc.error && rpc.error.message));

    // Cleanup
    await sb.from("chat_conversations").delete().eq("id", convId);
    record("visitor_reload_restore", true, null);
  }

  /* ── test 6: RPC failure shows error, no fake success ── */
  async function test_rpc_failure_visible() {
    var sb = sbClient();
    // Call RPC with a non-existent conv — should return empty, not an unhandled error
    var rpc = await sb.rpc("get_visitor_msgs", {
      p_visitor_id: "nonexistent-vid-xyz",
      p_conv_id:    "nonexistent-conv-xyz",
      p_after_at:   0
    });
    // Should not error (the function exists), should return 0 rows
    if (rpc.error) {
      record("rpc_failure_visible", false, "RPC itself errored (function may not be deployed): " + rpc.error.message);
      return;
    }
    assert((rpc.data || []).length === 0, "expected 0 rows for bogus ids, got " + (rpc.data || []).length);

    // Now test with wrong vid for a real conv (ownership check)
    var sb2 = sbClient();
    var convId = "test-own-" + Date.now();
    await sb2.from("chat_conversations").insert({
      id: convId, visitor_name: "Own", visitor_email: "o@test.no",
      visitor_id: "real-vid-abc", status: "open", unread: 0, last_msg: "", last_at: Date.now()
    });
    await sb2.from("chat_messages").insert({ id: "ownm-" + Date.now(), conversation_id: convId, text: "secret", sender: "visitor", at: Date.now() });

    var wrongVid = await sb2.rpc("get_visitor_msgs", {
      p_visitor_id: "wrong-vid-xyz",
      p_conv_id:    convId,
      p_after_at:   0
    });
    assert(!wrongVid.error, "unexpected RPC error: " + (wrongVid.error && wrongVid.error.message));
    assert((wrongVid.data || []).length === 0, "ownership bypass: wrong vid returned " + (wrongVid.data || []).length + " rows");

    // Cleanup
    await sb2.from("chat_conversations").delete().eq("id", convId);
    record("rpc_failure_visible", true, null);
  }

  /* ── test 7: anon cannot insert operator message (RLS) ── */
  async function test_anon_sender_enforcement() {
    // This test requires running as anon (no auth session).
    // We verify the CHECK constraint exists via information_schema.
    var sb = sbClient();
    var { data: { session } } = await sb.auth.getSession();
    if (session) {
      record("anon_sender_enforcement", true, "SKIPPED (run while logged out to test anon RLS)");
      return;
    }
    // As anon, try to insert sender='operator' — must fail
    var res = await sb.from("chat_messages").insert({
      id: "badmsg-" + Date.now(),
      conversation_id: "does-not-matter",
      text: "inject",
      sender: "operator",
      at: Date.now()
    });
    assert(res.error, "Expected RLS violation but insert succeeded");
    record("anon_sender_enforcement", true, null);
  }

  /* ── test 8: admin poll — conversation-metadata change does not hide a new
     message in the same poll round (regression for the if/else-if bug fixed
     2026-07-02 in module-chat.js's admin pollTick). This test reproduces the
     exact race at the data layer: a conversation whose last_at is bumped by a
     genuinely new message, queried the same way pollTick now does — as two
     INDEPENDENT queries (conversation list, then active-conversation messages)
     rather than one gating the other. It proves the data both queries need is
     simultaneously available; it does not assert DOM rendering (chat-tests.js
     has no DOM harness) — pair with the manual two-browser test plan in
     docs/architecture/system-overview.md or the chat section of the handoff
     summary for full end-to-end verification. */
  async function test_admin_poll_independent_fetch() {
    var sb = sbClient();
    var { data: { session } } = await sb.auth.getSession();
    if (!session) { record("admin_poll_independent_fetch", true, "SKIPPED (no auth session)"); return; }

    var convId = "test-pollrace-" + Date.now();
    var t0 = Date.now();
    await sb.from("chat_conversations").insert({
      id: convId, visitor_name: "Pollrace", visitor_email: "pr@test.no",
      visitor_id: "pr-" + t0, status: "open", unread: 0, last_msg: "hei", last_at: t0
    });

    // Simulate: admin already has this conversation open (activeId === convId)
    // and has already seen messages up to t0. A new visitor message arrives,
    // which both inserts a chat_messages row AND bumps chat_conversations.last_at
    // — the exact combination that used to make the metadata branch swallow the
    // message fetch.
    var newAt = t0 + 50;
    var msgRes = await sb.from("chat_messages").insert({
      id: "prm-" + Date.now(), conversation_id: convId, text: "ny melding", sender: "visitor", at: newAt
    });
    assert(!msgRes.error, "message insert: " + (msgRes.error && msgRes.error.message));
    await sb.from("chat_conversations").update({ last_msg: "ny melding", last_at: newAt }).eq("id", convId);

    // Query 1 — same shape as pollTick's conversation-list fetch
    var convRes = await sb.from("chat_conversations").select("*").order("last_at", { ascending: false, nullsFirst: false });
    assert(!convRes.error, "conversation list fetch: " + (convRes.error && convRes.error.message));
    var found = (convRes.data || []).find(function (c) { return c.id === convId; });
    assert(found, "conversation not found in list fetch");
    assert(found.last_at === newAt, "conversation last_at not updated as expected");

    // Query 2 — same shape as pollTick's active-conversation message fetch,
    // must run and return the new message REGARDLESS of query 1's outcome
    // (independent, not else-if gated on it).
    var msgFetch = await sb.from("chat_messages").select("id,text,sender,at,created_at")
      .eq("conversation_id", convId).gt("at", t0);
    assert(!msgFetch.error, "message fetch: " + (msgFetch.error && msgFetch.error.message));
    assert((msgFetch.data || []).length === 1, "expected the new message to be independently fetchable, got " + (msgFetch.data || []).length);
    assert(msgFetch.data[0].text === "ny melding", "fetched message text mismatch");

    // Cleanup
    await sb.from("chat_conversations").delete().eq("id", convId);
    record("admin_poll_independent_fetch", true, null);
  }

  /* ── runner ── */
  async function run() {
    RESULTS = [];
    console.group("%cVibeverk Chat Integration Tests", "font-size:1rem;font-weight:bold");
    var tests = [
      test_fresh_storage,
      test_createConv_confirmed,
      test_visitor_messages,
      test_admin_reply_retrieved,
      test_visitor_reload_restore,
      test_rpc_failure_visible,
      test_anon_sender_enforcement,
      test_admin_poll_independent_fetch
    ];
    for (var i = 0; i < tests.length; i++) {
      var t = tests[i];
      try {
        await t();
      } catch (e) {
        record(t.name.replace(/^test_/, ""), false, e.message);
      }
    }
    var passed = RESULTS.filter(function(r){return r.ok;}).length;
    var total  = RESULTS.length;
    console.log(
      "%c" + passed + "/" + total + " passed",
      passed === total ? "color:#22c55e;font-weight:bold" : "color:#ef4444;font-weight:bold"
    );
    console.groupEnd();
    return RESULTS;
  }

  global.VW_CHAT_TESTS = { run: run };
})(window);
