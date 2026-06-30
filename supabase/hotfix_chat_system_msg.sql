-- hotfix_chat_system_msg.sql
-- Tillater at anon kan sette inn systemmeldingar (t.d. "Kunden lukket chatvinduet.")
-- Sender = 'system' er ikkje operatørimitasjon — det er ein nøytral systemhending.
-- Køyr i Supabase Dashboard → SQL Editor

DROP POLICY IF EXISTS chat_msg_anon_insert ON chat_messages;
CREATE POLICY chat_msg_anon_insert ON chat_messages FOR INSERT TO anon
    WITH CHECK (sender IN ('visitor', 'system'));
