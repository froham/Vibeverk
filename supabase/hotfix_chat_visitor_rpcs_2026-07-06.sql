-- =============================================================================
-- hotfix_chat_visitor_rpcs_2026-07-06.sql
-- -----------------------------------------------------------------------------
-- STILL NOT RUN — DO NOT RUN until the manual test checklist at the bottom
-- of this file has actually been done in a real browser. NOT yet folded into
-- migration.sql either, for the same reason.
--
-- UPDATE 2026-07-06: the paired module-chat.js client rewrite described at
-- the bottom of this file is now DONE — Chat.updateConv()/Chat.addMsg() both
-- take an optional trailing `vid` parameter; every anon-visitor-widget call
-- site now passes Chat.getVid(), routing through the two RPCs below instead
-- of direct table access; every admin/operator call site was deliberately
-- left unchanged (no vid passed), still using direct table access via the
-- existing chat_conv_auth/chat_msg_auth policies. What's NOT done yet: live
-- browser verification of either path, and none of the SQL below has been
-- run — sections 1+2 (the new RPC functions) are harmless/additive on their
-- own, but section 3 (revoking the old direct anon grants) must not run
-- until the live test below confirms the new client code path actually
-- works end-to-end, since that section removes the fallback the widget
-- currently still has if something in the new code path is wrong.
--
-- This SQL alone is still NOT deployable in one shot: running section 3
-- without having verified the client rewrite actually works live would
-- break the visitor chat widget outright. This exact caution already
-- existed in the repo before this file was written
-- (hotfix_security_audit_2026-07-01.sql's header) — repeating it here
-- rather than overriding it.
--
-- Funn (2026-07-04/06 audit, "Still open" + Pending in CURRENT_STATE.md):
--   - chat_conv_anon_update: `USING (true) WITH CHECK (true)` on
--     chat_conversations — no visitor_id ownership check at the row level.
--     The column-level GRANT UPDATE (...) restricts WHICH columns anon can
--     touch, but not WHICH ROW — an anon caller who knows (or guesses,
--     given weak visitor_id entropy: Date.now() + 4 base36 chars,
--     module-chat.js) another visitor's conversation id can spoof their
--     name/email or forge presence/read-state on that conversation.
--   - chat_msg_anon_insert: `WITH CHECK (sender IN ('visitor','system'))`
--     on chat_messages — no check at all that conversation_id belongs to
--     the caller. A guessed conversation_id lets an anon client insert
--     messages into someone else's conversation outright.
--
-- Why RLS alone cannot fix this: Postgres RLS validates column VALUES in
-- the row/request, but anon carries no verified identity (no auth.uid())
-- to compare visitor_id against — a policy like
-- `USING (visitor_id = <something in the request>)` cannot distinguish "the
-- real owner" from "anyone who typed the right value in a query param",
-- since visitor_id is just client-supplied text either way. The existing
-- get_visitor_conv()/get_visitor_msgs() READ RPCs already solved this
-- exact problem for reads by treating visitor_id as a capability token
-- checked INSIDE a SECURITY DEFINER function body. This file applies the
-- identical pattern to the two anon WRITE paths.
--
-- Left deliberately unchanged: chat_conv_anon_insert (conversation
-- creation) — there is no existing row to hijack at creation time, no
-- ownership check is meaningful there, and the client already generates a
-- fresh, self-chosen visitor_id at that point.
-- =============================================================================


-- ── 1. Presence/metadata update RPC (replaces chat_conv_anon_update) ────────
-- Covers exactly the columns anon can update today via the column-level
-- GRANT (module-chat.js's updateConv()) — status/unread are deliberately
-- NOT included, matching today's grant (anon already cannot touch them).
-- NULL parameters mean "not provided, leave column unchanged" (COALESCE
-- against the current value) — matches updateConv()'s `changes.X !== undefined`
-- semantics, since the client never intentionally sends null for these text
-- fields, only omits them.

CREATE OR REPLACE FUNCTION update_visitor_presence(
  p_visitor_id      text,
  p_conv_id         text,
  p_visitor_name    text    DEFAULT NULL,
  p_visitor_email   text    DEFAULT NULL,
  p_page_url        text    DEFAULT NULL,
  p_referrer        text    DEFAULT NULL,
  p_language        text    DEFAULT NULL,
  p_browser         text    DEFAULT NULL,
  p_os              text    DEFAULT NULL,
  p_screen          text    DEFAULT NULL,
  p_visitor_active  boolean DEFAULT NULL,
  p_last_seen_at    bigint  DEFAULT NULL,
  p_visitor_read_at bigint  DEFAULT NULL
)
RETURNS SETOF chat_conversations
SECURITY DEFINER
SET search_path = public
LANGUAGE plpgsql AS $$
BEGIN
  RETURN QUERY
  UPDATE chat_conversations SET
    visitor_name    = COALESCE(p_visitor_name,    visitor_name),
    visitor_email   = COALESCE(p_visitor_email,   visitor_email),
    page_url        = COALESCE(p_page_url,        page_url),
    referrer        = COALESCE(p_referrer,        referrer),
    language        = COALESCE(p_language,        language),
    browser         = COALESCE(p_browser,         browser),
    os              = COALESCE(p_os,              os),
    screen          = COALESCE(p_screen,          screen),
    visitor_active  = COALESCE(p_visitor_active,  visitor_active),
    last_seen_at    = COALESCE(p_last_seen_at,    last_seen_at),
    visitor_read_at = COALESCE(p_visitor_read_at, visitor_read_at)
  WHERE id = p_conv_id AND visitor_id = p_visitor_id
  RETURNING *;
END;
$$;

REVOKE EXECUTE ON FUNCTION update_visitor_presence(text,text,text,text,text,text,text,text,text,text,boolean,bigint,bigint) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION update_visitor_presence(text,text,text,text,text,text,text,text,text,text,boolean,bigint,bigint) TO anon;


-- ── 2. Message insert RPC (replaces chat_msg_anon_insert) ───────────────────
-- id/at are client-generated (module-chat.js's Chat.newId()/Date.now()),
-- same as today's direct insert — passed through, not server-generated.

CREATE OR REPLACE FUNCTION insert_visitor_message(
  p_visitor_id text,
  p_conv_id    text,
  p_msg_id     text,
  p_text       text,
  p_sender     text,
  p_at         bigint DEFAULT NULL
)
RETURNS SETOF chat_messages
SECURITY DEFINER
SET search_path = public
LANGUAGE plpgsql AS $$
BEGIN
  IF p_sender NOT IN ('visitor', 'system') THEN
    RAISE EXCEPTION 'Ugyldig avsendar for besøkande-melding';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM chat_conversations WHERE id = p_conv_id AND visitor_id = p_visitor_id) THEN
    RAISE EXCEPTION 'Samtale finst ikkje eller høyrer ikkje til denne besøkande';
  END IF;
  RETURN QUERY
  INSERT INTO chat_messages (id, conversation_id, text, sender, at)
  VALUES (p_msg_id, p_conv_id, p_text, p_sender, p_at)
  RETURNING *;
END;
$$;

REVOKE EXECUTE ON FUNCTION insert_visitor_message(text,text,text,text,text,bigint) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION insert_visitor_message(text,text,text,text,text,bigint) TO anon;


-- ── 3. Close the direct anon paths these RPCs replace ───────────────────────
-- ONLY run this section once module-chat.js has actually been switched to
-- call the two RPCs above for the anon-visitor-widget code path (the admin
-- side of the SAME shared functions, e.g. Chat.updateConv() called from the
-- admin chat panel, must keep using direct table access via chat_conv_auth/
-- chat_msg_auth — unaffected by this section, those policies are untouched).

DROP POLICY IF EXISTS chat_conv_anon_update ON chat_conversations;
DROP POLICY IF EXISTS chat_msg_anon_insert  ON chat_messages;

REVOKE UPDATE (visitor_name, visitor_email, page_url, referrer, language, browser, os, screen,
               last_seen_at, visitor_active, visitor_read_at) ON chat_conversations FROM anon;
REVOKE INSERT ON chat_messages FROM anon;
-- chat_conv_anon_insert (conversation creation) and its INSERT grant on
-- chat_conversations are deliberately left untouched — see file header.

NOTIFY pgrst, 'reload schema';

-- =============================================================================
-- CLIENT CHANGE (module-chat.js) — DONE 2026-07-06, DO NOT RUN SECTION 3
-- ABOVE UNTIL THE MANUAL TEST BELOW HAS ACTUALLY BEEN DONE LIVE:
--
-- Chat.updateConv(id, changes, vid) and Chat.addMsg(convId, text, sender, vid)
-- now take an optional trailing vid parameter. Every anon-visitor-widget call
-- site (createConv's post-create presence update, doSend's visitor message,
-- the visibilitychange/pagehide/30s-interval/openPanel presence tracking, and
-- the "Kunden lukket chatvinduet" system message) now passes Chat.getVid(),
-- routing through _sb.rpc('update_visitor_presence'|'insert_visitor_message',
-- {...}) instead of direct table access. Every admin/operator call site
-- (markRead, setStatus, the admin reply send, the admin "test conversation"
-- button, saveConvAsLead's leadSaved flag) was deliberately left unchanged —
-- no vid passed, so they keep using _sb.from(...).update()/.insert() directly
-- via the existing chat_conv_auth/chat_msg_auth policies, exactly as before.
-- (saveConvAsLead's `leadSaved` field and the widget's own `status` reopen/
-- close calls were never in the anon column-grant list to begin with — those
-- were already silently failing for anon before this change and remain a
-- separate, out-of-scope, pre-existing gap, not a regression introduced here.)
--
-- Manual test required, before running section 3:
-- 1) As an anon visitor, open the chat widget, send a message, verify it
--    appears and presence/read-state updates normally end-to-end.
-- 2) As admin, open the chat admin panel, reply to a conversation, mark
--    read, close a conversation — verify all still work via direct table
--    access (unaffected by this file).
-- 3) Only then run section 3, and re-test both flows once more against the
--    now-tightened grants.
-- =============================================================================
