-- =============================================================================
-- HOTFIX: Visitor-scoped RPCs for chat delivery
-- -----------------------------------------------------------------------------
-- Køyr denne filen i Supabase SQL Editor (Dashboard → SQL Editor → Run).
-- Idempotent — trygt å køyre fleire gonger.
--
-- Fiks for: HTTP 404 PGRST202 — get_visitor_msgs/get_visitor_conv finst ikkje
-- i PostgRESTs deployede skjema/cache.
--
-- SIKKERHEIT:
--   - SECURITY DEFINER: køyrer som function-eigaren, omgår RLS
--   - SET search_path = public: hindrar search-path-injeksjon
--   - visitor_id-validering: anon kan berre lese eigne samtalar
--   - REVOKE frå PUBLIC + GRANT berre til anon: minste privilegium
--   - Anon får ALDRI direkte SELECT på chat_messages eller chat_conversations
-- =============================================================================

-- Dropp evt. gamle definisjonar (idempotent via CREATE OR REPLACE, men eksplisitt
-- REVOKE krev eksakt signatur — drop sikrar at gamle signaturer ikkje heng att).
DROP FUNCTION IF EXISTS public.get_visitor_conv(text, text);
DROP FUNCTION IF EXISTS public.get_visitor_msgs(text, text, bigint);

-- ── get_visitor_conv ─────────────────────────────────────────────────────────
-- Hentar éin samtale berre viss visitor_id stemmer.
CREATE OR REPLACE FUNCTION public.get_visitor_conv(
  p_visitor_id text,
  p_conv_id    text
)
RETURNS SETOF public.chat_conversations
SECURITY DEFINER
STABLE
SET search_path = public
LANGUAGE sql AS $$
  SELECT * FROM chat_conversations
  WHERE id = p_conv_id
    AND visitor_id = p_visitor_id
  LIMIT 1;
$$;

-- ── get_visitor_msgs ─────────────────────────────────────────────────────────
-- Hentar meldingar for ein samtale, men validerer at visitor_id eigar samtalen.
-- p_after_at = 0 tyder "alle meldingar".
CREATE OR REPLACE FUNCTION public.get_visitor_msgs(
  p_visitor_id text,
  p_conv_id    text,
  p_after_at   bigint DEFAULT 0
)
RETURNS SETOF public.chat_messages
SECURITY DEFINER
STABLE
SET search_path = public
LANGUAGE sql AS $$
  SELECT m.* FROM chat_messages m
  WHERE m.conversation_id = p_conv_id
    AND (p_after_at = 0 OR m.at > p_after_at)
    AND EXISTS (
      SELECT 1 FROM chat_conversations c
      WHERE c.id = p_conv_id AND c.visitor_id = p_visitor_id
    )
  ORDER BY COALESCE(m.at, 0), m.created_at;
$$;

-- ── Tilgangsstyring ──────────────────────────────────────────────────────────
-- REVOKE frå PUBLIC (standardtilgang ved CREATE FUNCTION)
REVOKE EXECUTE ON FUNCTION public.get_visitor_conv(text, text)         FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.get_visitor_msgs(text, text, bigint) FROM PUBLIC;

-- GRANT berre til anon-rolla — aldri til authenticated eller public
GRANT EXECUTE ON FUNCTION public.get_visitor_conv(text, text)         TO anon;
GRANT EXECUTE ON FUNCTION public.get_visitor_msgs(text, text, bigint) TO anon;

-- ── Reload PostgREST-skjema ──────────────────────────────────────────────────
-- Tvingar PostgREST til å laste inn den nye funksjonssignaturen umiddelbart.
-- Utan denne kan det ta opptil 60 sek før API-et ser funksjonane.
NOTIFY pgrst, 'reload schema';
