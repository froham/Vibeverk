-- =============================================================================
-- VIBEVERK — Supabase Migration v1
-- -----------------------------------------------------------------------------
-- Køyr dette scriptet éin gong per nytt kundeprosjekt i Supabase SQL Editor.
-- Éin Supabase-prosjekt per kunde — ingen tenant_id nødvendig i nye tabellar
-- (store-tabellen beheld tenant_id for bakoverkompatibilitet med eksisterande kode).
--
-- Rekkefølge:
--   1. Funksjonar og triggarar
--   2. Tabellar
--   3. Auth-integrasjon (auto-opprett brukar ved signup)
--   4. RLS-hjelp-funksjonar
--   5. RLS-policiar
--   6. Grants
--   7. Realtime
-- =============================================================================


-- ── 1. HJELPEFUNKSJONAR ──────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END;
$$;


-- ── 2. TABELLAR ──────────────────────────────────────────────────────────────

-- Nettsideinnhald og innstillingar (delt nøkkel/verdi-lager)
CREATE TABLE IF NOT EXISTS store (
  id         bigserial    PRIMARY KEY,
  tenant_id  text         NOT NULL DEFAULT 'default',
  key        text         NOT NULL,
  value      jsonb,
  updated_at timestamptz  NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, key)
);

-- Brukarar (utvider auth.users med Vibeverk-rolle)
CREATE TABLE IF NOT EXISTS users (
  id           uuid         PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  display_name text,
  role         text         NOT NULL DEFAULT 'member'
                            CHECK (role IN ('owner', 'admin', 'member')),
  email        text,
  avatar_url   text,
  created_at   timestamptz  NOT NULL DEFAULT now(),
  updated_at   timestamptz  NOT NULL DEFAULT now()
);
ALTER TABLE users ADD COLUMN IF NOT EXISTS email text;

-- Private notatar (berre eiga brukar)
CREATE TABLE IF NOT EXISTS notes (
  id         uuid         PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    uuid         NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title      text         NOT NULL DEFAULT '',
  content    text         NOT NULL DEFAULT '',
  category   text                  DEFAULT '',
  tags       text[]                DEFAULT '{}',
  color      text                  DEFAULT 'none',
  summary    text                  DEFAULT '',
  updated_at timestamptz  NOT NULL DEFAULT now(),
  created_at timestamptz  NOT NULL DEFAULT now()
);

-- Oppgåver
CREATE TABLE IF NOT EXISTS tasks (
  id          uuid         PRIMARY KEY DEFAULT gen_random_uuid(),
  title       text         NOT NULL,
  description text,
  status      text         NOT NULL DEFAULT 'todo'
                           CHECK (status IN ('todo', 'in_progress', 'done')),
  assigned_to uuid         REFERENCES users(id) ON DELETE SET NULL,
  created_by  uuid         NOT NULL REFERENCES users(id),
  due_date    date,
  updated_at  timestamptz  NOT NULL DEFAULT now(),
  created_at  timestamptz  NOT NULL DEFAULT now()
);

-- Interne nyheiter / annonsering
CREATE TABLE IF NOT EXISTS announcements (
  id           uuid         PRIMARY KEY DEFAULT gen_random_uuid(),
  title        text         NOT NULL,
  content      text,
  author_id    uuid         NOT NULL REFERENCES users(id),
  important    boolean      NOT NULL DEFAULT false,
  image        text,
  attachments  jsonb                 DEFAULT '[]',
  published_at timestamptz  DEFAULT now(),
  updated_at   timestamptz  NOT NULL DEFAULT now(),
  created_at   timestamptz  NOT NULL DEFAULT now()
);

-- Kunnskapsbase
CREATE TABLE IF NOT EXISTS kb_articles (
  id         uuid         PRIMARY KEY DEFAULT gen_random_uuid(),
  title      text         NOT NULL,
  content    text,
  category   text,
  tags       text[]                DEFAULT '{}',
  summary    text,
  author_id  uuid         NOT NULL REFERENCES users(id),
  published  boolean      NOT NULL DEFAULT false,
  updated_at timestamptz  NOT NULL DEFAULT now(),
  created_at timestamptz  NOT NULL DEFAULT now()
);

-- Lenker
CREATE TABLE IF NOT EXISTS links (
  id          uuid         PRIMARY KEY DEFAULT gen_random_uuid(),
  title       text         NOT NULL,
  url         text         NOT NULL,
  description text,
  icon        text                  DEFAULT 'link',
  category    text,
  created_by  uuid         REFERENCES users(id) ON DELETE SET NULL,
  sort_order  int          NOT NULL DEFAULT 0,
  created_at  timestamptz  NOT NULL DEFAULT now()
);

-- Chat-samtalar (anon-besøkande skriv, admin les/svarar)
CREATE TABLE IF NOT EXISTS chat_conversations (
  id              text         PRIMARY KEY,
  visitor_name    text,
  visitor_email   text,
  visitor_id      text,
  status          text         NOT NULL DEFAULT 'open'
                               CHECK (status IN ('open', 'closed')),
  unread          int          NOT NULL DEFAULT 0,
  last_msg        text,
  last_at         bigint,
  created_at      timestamptz  NOT NULL DEFAULT now(),
  -- Besøkande-metadata (nettlesar, sida dei var på, osv.)
  page_url        text,
  referrer        text,
  language        text,
  browser         text,
  os              text,
  screen          text,
  visitor_active  boolean      NOT NULL DEFAULT false,
  last_seen_at    bigint,
  visitor_read_at bigint
);

-- Oppgrader eksisterande installasjonar (kolonnar lagt til i v1.1)
ALTER TABLE chat_conversations ADD COLUMN IF NOT EXISTS page_url        text;
ALTER TABLE chat_conversations ADD COLUMN IF NOT EXISTS referrer        text;
ALTER TABLE chat_conversations ADD COLUMN IF NOT EXISTS language        text;
ALTER TABLE chat_conversations ADD COLUMN IF NOT EXISTS browser         text;
ALTER TABLE chat_conversations ADD COLUMN IF NOT EXISTS os              text;
ALTER TABLE chat_conversations ADD COLUMN IF NOT EXISTS screen          text;
ALTER TABLE chat_conversations ADD COLUMN IF NOT EXISTS visitor_active  boolean NOT NULL DEFAULT false;
ALTER TABLE chat_conversations ADD COLUMN IF NOT EXISTS last_seen_at    bigint;
ALTER TABLE chat_conversations ADD COLUMN IF NOT EXISTS visitor_read_at bigint;

-- Chat-meldingar
CREATE TABLE IF NOT EXISTS chat_messages (
  id              text         PRIMARY KEY,
  conversation_id text         NOT NULL REFERENCES chat_conversations(id) ON DELETE CASCADE,
  text            text         NOT NULL,
  sender          text         NOT NULL CHECK (sender IN ('visitor', 'operator')),
  at              bigint,                        -- epoch-ms for rask sortering
  created_at      timestamptz  NOT NULL DEFAULT now()
);

-- Oppgrader eksisterande installasjonar (at-kolonne lagt til i v1.1)
ALTER TABLE chat_messages ADD COLUMN IF NOT EXISTS at bigint;


-- ── 3. UPDATED_AT TRIGGERS ───────────────────────────────────────────────────

DROP TRIGGER IF EXISTS store_updated_at         ON store;
DROP TRIGGER IF EXISTS users_updated_at         ON users;
DROP TRIGGER IF EXISTS notes_updated_at         ON notes;
DROP TRIGGER IF EXISTS tasks_updated_at         ON tasks;
DROP TRIGGER IF EXISTS announcements_updated_at ON announcements;
DROP TRIGGER IF EXISTS kb_articles_updated_at   ON kb_articles;

CREATE TRIGGER store_updated_at         BEFORE UPDATE ON store         FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER users_updated_at         BEFORE UPDATE ON users         FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER notes_updated_at         BEFORE UPDATE ON notes         FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER tasks_updated_at         BEFORE UPDATE ON tasks         FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER announcements_updated_at BEFORE UPDATE ON announcements FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER kb_articles_updated_at   BEFORE UPDATE ON kb_articles   FOR EACH ROW EXECUTE FUNCTION set_updated_at();


-- ── 4. AUTO-OPPRETT BRUKAR VED SIGNUP ────────────────────────────────────────

CREATE OR REPLACE FUNCTION handle_new_user()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  INSERT INTO public.users (id, display_name, role, email)
  VALUES (
    NEW.id,
    COALESCE(NEW.raw_user_meta_data->>'display_name', split_part(NEW.email, '@', 1)),
    COALESCE(NEW.raw_user_meta_data->>'role', 'member'),
    NEW.email
  )
  ON CONFLICT (id) DO NOTHING;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION handle_new_user();


-- ── 5. RLS-HJELP-FUNKSJONAR ──────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION is_admin_or_owner()
RETURNS boolean LANGUAGE sql SECURITY DEFINER STABLE AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.users
    WHERE id = auth.uid() AND role IN ('owner', 'admin')
  );
$$;


-- ── 6. RLS ───────────────────────────────────────────────────────────────────

ALTER TABLE store             ENABLE ROW LEVEL SECURITY;
ALTER TABLE users             ENABLE ROW LEVEL SECURITY;
ALTER TABLE notes             ENABLE ROW LEVEL SECURITY;
ALTER TABLE tasks             ENABLE ROW LEVEL SECURITY;
ALTER TABLE announcements     ENABLE ROW LEVEL SECURITY;
ALTER TABLE kb_articles       ENABLE ROW LEVEL SECURITY;
ALTER TABLE links             ENABLE ROW LEVEL SECURITY;
ALTER TABLE chat_conversations ENABLE ROW LEVEL SECURITY;
ALTER TABLE chat_messages     ENABLE ROW LEVEL SECURITY;

-- store: alle innlogga brukarar (nettsideinnhald redigerast av admin via app)
CREATE POLICY store_auth        ON store  FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- users: alle les, kvar brukar oppdaterer seg sjølv, admin/owner endrar alle
CREATE POLICY users_read         ON users  FOR SELECT TO authenticated USING (true);
CREATE POLICY users_self_update  ON users  FOR UPDATE TO authenticated USING (auth.uid() = id) WITH CHECK (auth.uid() = id);
CREATE POLICY users_admin_update ON users  FOR UPDATE TO authenticated USING (is_admin_or_owner()) WITH CHECK (is_admin_or_owner());
CREATE POLICY users_admin_delete ON users  FOR DELETE TO authenticated USING (is_admin_or_owner());

-- notes: berre eiga brukar
CREATE POLICY notes_own         ON notes  FOR ALL TO authenticated USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());

-- tasks: alle les, admin/owner skriv, tildelt brukar kan oppdatere status
CREATE POLICY tasks_read        ON tasks  FOR SELECT TO authenticated USING (true);
CREATE POLICY tasks_admin       ON tasks  FOR ALL    TO authenticated USING (is_admin_or_owner()) WITH CHECK (is_admin_or_owner());
CREATE POLICY tasks_assignee    ON tasks  FOR UPDATE TO authenticated USING (assigned_to = auth.uid()) WITH CHECK (assigned_to = auth.uid());

-- announcements: alle les, admin/owner skriv
CREATE POLICY ann_read          ON announcements FOR SELECT TO authenticated USING (true);
CREATE POLICY ann_admin         ON announcements FOR ALL    TO authenticated USING (is_admin_or_owner()) WITH CHECK (is_admin_or_owner());

-- kb_articles: alle les, admin/owner skriv
CREATE POLICY kb_read           ON kb_articles FOR SELECT TO authenticated USING (true);
CREATE POLICY kb_admin          ON kb_articles FOR ALL    TO authenticated USING (is_admin_or_owner()) WITH CHECK (is_admin_or_owner());

-- links: alle les, admin/owner skriv
CREATE POLICY links_read        ON links FOR SELECT TO authenticated USING (true);
CREATE POLICY links_admin       ON links FOR ALL    TO authenticated USING (is_admin_or_owner()) WITH CHECK (is_admin_or_owner());

-- chat: anon-besøkande kan skrive og lese samtalen sin, admin har full tilgang
CREATE POLICY chat_conv_anon_insert ON chat_conversations FOR INSERT TO anon WITH CHECK (true);
CREATE POLICY chat_conv_anon_select ON chat_conversations FOR SELECT TO anon USING (true);
CREATE POLICY chat_conv_auth        ON chat_conversations FOR ALL    TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY chat_msg_anon_insert  ON chat_messages      FOR INSERT TO anon WITH CHECK (true);
CREATE POLICY chat_msg_anon_select  ON chat_messages      FOR SELECT TO anon USING (true);
CREATE POLICY chat_msg_auth         ON chat_messages      FOR ALL    TO authenticated USING (true) WITH CHECK (true);


-- ── 7. GRANTS ────────────────────────────────────────────────────────────────

GRANT SELECT, INSERT, UPDATE, DELETE ON
  store, users, notes, tasks, announcements, kb_articles, links
TO authenticated;

GRANT USAGE, SELECT ON SEQUENCE store_id_seq TO authenticated;

GRANT INSERT, SELECT ON chat_conversations, chat_messages TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON chat_conversations, chat_messages TO authenticated;


-- ── 8. REALTIME ──────────────────────────────────────────────────────────────

ALTER TABLE chat_messages      REPLICA IDENTITY FULL;
ALTER TABLE chat_conversations REPLICA IDENTITY FULL;

ALTER PUBLICATION supabase_realtime ADD TABLE chat_messages, chat_conversations;
