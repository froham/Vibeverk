-- hotfix_chat_system_msg.sql  (v2 — idempotent, køyr heile fila på nytt)
-- FOLDA INN i migration.sql (2026-07-01, sikkerheitsaudit) — begge fiksane
-- under ligg no i den idempotente fullskjemafila. Denne fila kan framleis
-- køyrast trygt (idempotent) på ein eksisterande database som ikkje har
-- fått siste migration.sql enno.
-- Fix 1: Tillater at anon kan sette inn systemmeldingar frå visitor-widget
-- Fix 2: chat_messages CHECK-constraint blokkerte sender = 'system'

-- Køyr i Supabase Dashboard → SQL Editor

-- 1. RLS: tillat sender IN ('visitor', 'system') for anon INSERT
DROP POLICY IF EXISTS chat_msg_anon_insert ON chat_messages;
CREATE POLICY chat_msg_anon_insert ON chat_messages FOR INSERT TO anon
    WITH CHECK (sender IN ('visitor', 'system'));

-- 2. Tabell-constraint: utvid til å inkludere 'system'
ALTER TABLE chat_messages DROP CONSTRAINT IF EXISTS chat_messages_sender_check;
ALTER TABLE chat_messages ADD CONSTRAINT chat_messages_sender_check
    CHECK (sender IN ('visitor', 'operator', 'system'));
