-- =============================================================================
-- VIBEVERK — Supabase Migration v1
-- -----------------------------------------------------------------------------
-- Trygt å køyre fleire gonger (idempotent) — brukar IF NOT EXISTS / DROP IF EXISTS.
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

-- Hald chat_conversations oppdatert automatisk når ei melding vert sett inn.
-- Anon-brukaren treng ikkje UPDATE-rettighet på last_msg/last_at/unread —
-- triggaren tek seg av det server-side.
CREATE OR REPLACE FUNCTION _chat_conv_update_on_msg()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  UPDATE chat_conversations SET
    last_msg = NEW.text,
    last_at  = COALESCE(NEW.at, EXTRACT(EPOCH FROM now())::bigint * 1000),
    unread   = unread + CASE WHEN NEW.sender = 'visitor' THEN 1 ELSE 0 END
  WHERE id = NEW.conversation_id;
  RETURN NEW;
END;
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
                            CHECK (role IN ('admin', 'editor', 'member')),
  email        text,
  avatar_url   text,
  created_at   timestamptz  NOT NULL DEFAULT now(),
  updated_at   timestamptz  NOT NULL DEFAULT now()
);
ALTER TABLE users ADD COLUMN IF NOT EXISTS email text;
-- Oppgrader CHECK-constraint til å inkludere editor-rolla
ALTER TABLE users DROP CONSTRAINT IF EXISTS users_role_check;
ALTER TABLE users ADD CONSTRAINT users_role_check
  CHECK (role IN ('admin', 'editor', 'member'));

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
  sender          text         NOT NULL CHECK (sender IN ('visitor', 'operator', 'system')),
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

DROP TRIGGER IF EXISTS chat_msg_update_conv ON chat_messages;
CREATE TRIGGER chat_msg_update_conv
  AFTER INSERT ON chat_messages
  FOR EACH ROW EXECUTE FUNCTION _chat_conv_update_on_msg();


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

-- Namnet er historisk — "owner" vart fjerna som rolle (rollemodellen er no berre
-- admin/editor/member, sjå CHECK-constrainten på users.role under). Funksjonen sjekkar
-- i praksis berre 'admin'. Ikkje omdøypt her sidan mange RLS-policies refererer namnet;
-- ei omdøyping krev ein eigen, koordinert migrasjon.
CREATE OR REPLACE FUNCTION is_admin_or_owner()
RETURNS boolean LANGUAGE sql SECURITY DEFINER STABLE SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.users
    WHERE id = auth.uid() AND role = 'admin'
  );
$$;

-- Admin og editor kan opprette og redigere innhald (artiklar, KB, lenker, oppgåver)
CREATE OR REPLACE FUNCTION can_edit_content()
RETURNS boolean LANGUAGE sql SECURITY DEFINER STABLE SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.users
    WHERE id = auth.uid() AND role IN ('admin', 'editor')
  );
$$;


-- ── 5b. VISITOR-SCOPED RPCs ──────────────────────────────────────────────────
-- Desse må definerast ETTER chat_conversations og chat_messages-tabellane
-- (PostgreSQL validerer tabellreferansar ved CREATE FUNCTION for LANGUAGE sql).
-- SECURITY DEFINER: køyrer som eigaren (omgår RLS), men validerer visitor_id sjølv.
-- SET search_path = public hindrar søk-path-injeksjon mot SECURITY DEFINER-funksjonar.
-- REVOKE frå PUBLIC + eksplisitt GRANT til anon = minste privilegium.

CREATE OR REPLACE FUNCTION get_visitor_conv(p_visitor_id text, p_conv_id text)
RETURNS SETOF chat_conversations
SECURITY DEFINER STABLE
SET search_path = public
LANGUAGE sql AS $$
  SELECT * FROM chat_conversations
  WHERE id = p_conv_id AND visitor_id = p_visitor_id
  LIMIT 1;
$$;

CREATE OR REPLACE FUNCTION get_visitor_msgs(p_visitor_id text, p_conv_id text, p_after_at bigint DEFAULT 0)
RETURNS SETOF chat_messages
SECURITY DEFINER STABLE
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

REVOKE EXECUTE ON FUNCTION get_visitor_conv(text, text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION get_visitor_msgs(text, text, bigint) FROM PUBLIC;


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

-- store: anon kan lese (offentleg innhald), innlogga brukarar kan skrive.
-- Nøkkelen 'superconfig' (feature-flagg, tema, personverntekst, admin-passord-
-- fallback) krev admin; alle andre nøklar krev minst can_edit_content().
-- 'wsp-orgdrift' (Organisasjon & drift) ligg som éin JSON-blob per nøkkel —
-- RLS kan ikkje skilje "opprett kort" frå "rediger eksisterande kort" inni
-- blobben, så heile nøkkelen er admin-only (same mønster som 'superconfig').
-- Sjå docs/architecture/roles-and-tenants.md.
-- MERK (funne under 2026-07-02-gjennomgangen): store_auth er ein FOR ALL-policy,
-- så USING-klausulen styrer óg SELECT, ikkje berre skriving. Med berre
-- can_edit_content() i USING kunne ein "member" (som ikkje er admin/editor)
-- ikkje lese SINE EIGNE store-rader i det heile — t.d. eigne dashboard-
-- snarvegar. Truleg ein utilsikta biverknad av 2026-07-01-tryggleiksfiksen
-- (som berre skulle avgrense SKRIVING). store_read_authenticated under gjev
-- SELECT tilbake til alle innlogga brukarar (Postgres OR-ar fleire permissive
-- policyar for same kommando) utan å svekke skrive-avgrensinga i store_auth.
-- 'crm-customers'/'crm-bedrifter'/'crm-comms'/'crm-settings': member skal ha
-- normal CRM-tilgang (opprette/redigere kundar, bedrifter, malar, snippets,
-- signaturar) — presisert av brukar 2026-07-02 etter at ei tidlegare, agent-
-- inferert roles:["admin","editor"]-avgrensing i module-crm.js vart fjerna att
-- (sjå docs/project/CHANGELOG.md). Nøkkel-spesifikk carve-out, IKKJE generell
-- store-tilgang for member. Det einaste attverande CRM-unntaket (CSV-eksport av
-- heile kundelista) er UI-lag/handler-nivå, ikkje ei RLS-avgrensing (RLS kan
-- ikkje skilje "les éin kunde" frå "eksporter alle" innanfor same nøkkel).
-- MERK (funne under security-review 2026-07-02): store_auth var opphavleg éin
-- FOR ALL-policy — det dekker og DELETE, ikkje berre INSERT/UPDATE. Med CRM-
-- nøklane sett til bare "true" hadde det gjeve member ein ubetinga rett til å
-- slette HEILE kunde-/bedrift-/kommunikasjons-/CRM-innstillingsblobben i éin
-- REST-kall (`DELETE FROM store WHERE key='crm-customers'`) — langt breiare enn
-- "opprette/redigere kundar" som var det faktiske kravet. store_auth er difor
-- delt i tre kommando-spesifikke policyar under: INSERT/UPDATE opnar for CRM-
-- nøklane (member), DELETE krev framleis can_edit_content() (admin/editor) for
-- ALLE nøklar, inkludert CRM-nøklane.
DROP POLICY IF EXISTS store_anon_read          ON store;
DROP POLICY IF EXISTS store_auth               ON store;
DROP POLICY IF EXISTS store_read_authenticated ON store;
DROP POLICY IF EXISTS store_insert_auth        ON store;
DROP POLICY IF EXISTS store_update_auth        ON store;
DROP POLICY IF EXISTS store_delete_auth        ON store;
CREATE POLICY store_anon_read       ON store  FOR SELECT TO anon          USING (true);
CREATE POLICY store_read_authenticated ON store FOR SELECT TO authenticated USING (true);
CREATE POLICY store_insert_auth     ON store  FOR INSERT TO authenticated
  WITH CHECK (CASE
    WHEN key IN ('superconfig', 'wsp-orgdrift') THEN is_admin_or_owner()
    WHEN key IN ('crm-customers', 'crm-bedrifter', 'crm-comms', 'crm-settings') THEN true
    ELSE can_edit_content()
  END);
CREATE POLICY store_update_auth     ON store  FOR UPDATE TO authenticated
  USING      (CASE
    WHEN key IN ('superconfig', 'wsp-orgdrift') THEN is_admin_or_owner()
    WHEN key IN ('crm-customers', 'crm-bedrifter', 'crm-comms', 'crm-settings') THEN true
    ELSE can_edit_content()
  END)
  WITH CHECK (CASE
    WHEN key IN ('superconfig', 'wsp-orgdrift') THEN is_admin_or_owner()
    WHEN key IN ('crm-customers', 'crm-bedrifter', 'crm-comms', 'crm-settings') THEN true
    ELSE can_edit_content()
  END);
-- DELETE er bevisst IKKJE gjeve til CRM-nøklane — sjå notat over. Same
-- superconfig/wsp-orgdrift-avgrensing som før, elles can_edit_content().
CREATE POLICY store_delete_auth     ON store  FOR DELETE TO authenticated
  USING (CASE
    WHEN key IN ('superconfig', 'wsp-orgdrift') THEN is_admin_or_owner()
    ELSE can_edit_content()
  END);

-- users: alle les, kvar brukar oppdaterer seg sjølv (men ikkje eiga rolle —
-- sjå prevent_self_role_escalation-triggeren under), admin endrar alle
DROP POLICY IF EXISTS users_read         ON users;
DROP POLICY IF EXISTS users_self_update  ON users;
DROP POLICY IF EXISTS users_admin_update ON users;
DROP POLICY IF EXISTS users_admin_delete ON users;
CREATE POLICY users_read         ON users  FOR SELECT TO authenticated USING (true);
CREATE POLICY users_self_update  ON users  FOR UPDATE TO authenticated USING (auth.uid() = id) WITH CHECK (auth.uid() = id);
CREATE POLICY users_admin_update ON users  FOR UPDATE TO authenticated USING (is_admin_or_owner()) WITH CHECK (is_admin_or_owner());
CREATE POLICY users_admin_delete ON users  FOR DELETE TO authenticated USING (is_admin_or_owner());

-- RLS er rad-nivå og kan ikkje åleine hindre at ein brukar patchar sin eigen
-- rad med ei ny rolle (users_self_update sjekkar berre auth.uid() = id).
-- Trigger blokkerer role-endring med mindre kallaren alt er admin.
CREATE OR REPLACE FUNCTION prevent_self_role_escalation()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.role IS DISTINCT FROM OLD.role AND NOT is_admin_or_owner() THEN
    RAISE EXCEPTION 'Berre admin kan endre rolle';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_prevent_self_role_escalation ON users;
CREATE TRIGGER trg_prevent_self_role_escalation
  BEFORE UPDATE ON users
  FOR EACH ROW EXECUTE FUNCTION prevent_self_role_escalation();

-- notes: berre eiga brukar
DROP POLICY IF EXISTS notes_own         ON notes;
CREATE POLICY notes_own         ON notes  FOR ALL TO authenticated USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());

-- tasks: alle les, editor+ skriv fritt, member kan berre oppdatere/opprette
-- SINE EIGNE oppretta oppgåver (kolonneavgrensing i triggeren under).
-- Presisert av brukar 2026-07-02 (to rundar): (1) member skal kunne opprette
-- til seg sjølv, (2) member skal kunne REDIGERE (ikkje berre status på) eigne
-- oppretta oppgåver fullt ut, MEN ei oppgåve TILDELT av nokon annan er rein
-- lesevisning — ikkje eingong status kan endrast der. Tidlegare versjon av
-- denne policyen (køyrd 2026-07-01/02) tillet tildelt-brukar å endre status;
-- det er no fjerna att.
DROP POLICY IF EXISTS tasks_read        ON tasks;
DROP POLICY IF EXISTS tasks_admin       ON tasks;
DROP POLICY IF EXISTS tasks_assignee    ON tasks;
CREATE POLICY tasks_read        ON tasks  FOR SELECT TO authenticated USING (true);
CREATE POLICY tasks_admin       ON tasks  FOR ALL    TO authenticated USING (can_edit_content()) WITH CHECK (can_edit_content());
-- Berre OPPRETTAR (ikkje lenger "eller tildelt") kan oppdatere raden for
-- ikkje-admin/editor — ei oppgåve tildelt av nokon annan skal ikkje kunne
-- oppdaterast i det heile av member, ikkje eingong status.
CREATE POLICY tasks_assignee    ON tasks  FOR UPDATE TO authenticated
  USING      (created_by = auth.uid())
  WITH CHECK (created_by = auth.uid());

-- Member kan opprette oppgåver til seg sjølv (sjølvvalt/utildelt), men ikkje
-- tildele til andre — tasks_admin (over) er einaste veg til å opprette ei
-- oppgåve tildelt NOKON ANNAN, og krev framleis can_edit_content() (admin/editor).
-- Lagt til 2026-07-02 etter brukarpresisering av rollematrisa.
DROP POLICY IF EXISTS tasks_self_create ON tasks;
CREATE POLICY tasks_self_create ON tasks FOR INSERT TO authenticated
  WITH CHECK (created_by = auth.uid() AND (assigned_to = auth.uid() OR assigned_to IS NULL));

-- Kolonneavgrensing for ikkje-admin/editor (RLS over er rad-nivå og kan ikkje
-- åleine avgrense kolonnar). Sidan tasks_assignee sin USING no krev
-- created_by = auth.uid(), når denne triggeren berre eigne oppretta oppgåver
-- for ikkje-admin/editor — "tildelt av nokon annan, status-only"-grenen frå
-- 2026-07-01-fiksen er fjerna att (uråkbar no, og ikkje lenger ønska åtferd).
-- Attverande regel: ingen ikkje-admin/editor kan nokon gong tildele oppgåva
-- til NOKON ANNAN enn seg sjølv, uavhengig av at dei elles har frie hender på
-- si eiga oppgåve.
CREATE OR REPLACE FUNCTION restrict_assignee_task_columns()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF can_edit_content() THEN
    RETURN NEW; -- admin/editor: inga avgrensing
  END IF;

  IF NEW.assigned_to IS DISTINCT FROM OLD.assigned_to
     AND NEW.assigned_to IS DISTINCT FROM auth.uid() THEN
    RAISE EXCEPTION 'Berre admin/editor kan tildele oppgåve til ein annan brukar';
  END IF;

  RETURN NEW; -- tasks_assignee sin USING (created_by = auth.uid()) sikrar at berre eigne oppretta oppgåver når hit i det heile
END;
$$;

DROP TRIGGER IF EXISTS trg_restrict_assignee_task_columns ON tasks;
CREATE TRIGGER trg_restrict_assignee_task_columns
  BEFORE UPDATE ON tasks
  FOR EACH ROW EXECUTE FUNCTION restrict_assignee_task_columns();

-- announcements: alle les, editor+ skriv
DROP POLICY IF EXISTS ann_read          ON announcements;
DROP POLICY IF EXISTS ann_admin         ON announcements;
CREATE POLICY ann_read          ON announcements FOR SELECT TO authenticated USING (true);
CREATE POLICY ann_admin         ON announcements FOR ALL    TO authenticated USING (can_edit_content()) WITH CHECK (can_edit_content());

-- kb_articles: alle les, editor+ skriv
DROP POLICY IF EXISTS kb_read           ON kb_articles;
DROP POLICY IF EXISTS kb_admin          ON kb_articles;
CREATE POLICY kb_read           ON kb_articles FOR SELECT TO authenticated USING (true);
CREATE POLICY kb_admin          ON kb_articles FOR ALL    TO authenticated USING (can_edit_content()) WITH CHECK (can_edit_content());

-- links: alle les, editor+ skriv
DROP POLICY IF EXISTS links_read        ON links;
DROP POLICY IF EXISTS links_admin       ON links;
CREATE POLICY links_read        ON links FOR SELECT TO authenticated USING (true);
CREATE POLICY links_admin       ON links FOR ALL    TO authenticated USING (can_edit_content()) WITH CHECK (can_edit_content());

-- chat: anon-besøkande kan berre skrive (INSERT) og oppdatere presence.
-- Les-tilgang skjer utelukkande via SECURITY DEFINER-RPC-ar (get_visitor_conv / get_visitor_msgs)
-- slik at ein anon ikkje kan lese andre besøkande sine samtalar.
-- Admin-rollen har full tilgang; vanlege members/editors har ikkje chat-tilgang.
DROP POLICY IF EXISTS chat_conv_anon_insert ON chat_conversations;
DROP POLICY IF EXISTS chat_conv_anon_select ON chat_conversations;
DROP POLICY IF EXISTS chat_conv_anon_update ON chat_conversations;
DROP POLICY IF EXISTS chat_conv_auth        ON chat_conversations;
DROP POLICY IF EXISTS chat_msg_anon_insert  ON chat_messages;
DROP POLICY IF EXISTS chat_msg_anon_select  ON chat_messages;
DROP POLICY IF EXISTS chat_msg_auth         ON chat_messages;

-- Anon INSERT: visitor_id må vere sett (eigarskapstoken)
CREATE POLICY chat_conv_anon_insert ON chat_conversations FOR INSERT TO anon
    WITH CHECK (visitor_id IS NOT NULL AND char_length(visitor_id) > 4);

-- Anon UPDATE: berre presence-felt (kolonne-nivå GRANT under avgrensar ytterlegare)
CREATE POLICY chat_conv_anon_update ON chat_conversations FOR UPDATE TO anon
    USING (true) WITH CHECK (true);

-- Anon INSERT på meldingar: visitor-meldingar, samt 'system' (visitorwidgeten
-- postar sjølv ei systemmelding når vedkomande avsluttar EIGEN samtale — t.d.
-- "Kunden lukket chatvinduet"). Aldri 'operator'.
CREATE POLICY chat_msg_anon_insert ON chat_messages FOR INSERT TO anon
    WITH CHECK (sender IN ('visitor', 'system'));

-- Auth (chat-admin): berre admin — ikkje editor/member
CREATE POLICY chat_conv_auth ON chat_conversations FOR ALL TO authenticated
    USING (is_admin_or_owner()) WITH CHECK (is_admin_or_owner());
CREATE POLICY chat_msg_auth  ON chat_messages      FOR ALL TO authenticated
    USING (is_admin_or_owner()) WITH CHECK (is_admin_or_owner());


-- ── 7. GRANTS ────────────────────────────────────────────────────────────────

GRANT SELECT, INSERT, UPDATE, DELETE ON
  store, users, notes, tasks, announcements, kb_articles, links
TO authenticated;

GRANT USAGE, SELECT ON SEQUENCE store_id_seq TO authenticated;

GRANT SELECT ON store TO anon;
-- Anon INSERT + presence UPDATE (RPC-ar handterer SELECT; ingen direkte SELECT-grant til anon)
GRANT INSERT ON chat_conversations, chat_messages TO anon;
GRANT UPDATE (visitor_name, visitor_email, page_url, referrer, language, browser, os, screen,
              last_seen_at, visitor_active, visitor_read_at) ON chat_conversations TO anon;
-- Visitor-RPC-ar: SECURITY DEFINER, men må eksplisitt grantast
GRANT EXECUTE ON FUNCTION get_visitor_conv(text, text)         TO anon;
GRANT EXECUTE ON FUNCTION get_visitor_msgs(text, text, bigint) TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON chat_conversations, chat_messages TO authenticated;


-- ── 8. REALTIME ──────────────────────────────────────────────────────────────

ALTER TABLE chat_messages      REPLICA IDENTITY FULL;
ALTER TABLE chat_conversations REPLICA IDENTITY FULL;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_publication_tables WHERE pubname = 'supabase_realtime' AND tablename = 'chat_messages') THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE chat_messages;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_publication_tables WHERE pubname = 'supabase_realtime' AND tablename = 'chat_conversations') THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE chat_conversations;
  END IF;
END $$;


-- ── 9. STORAGE BUCKET ────────────────────────────────────────────────────────

-- Public bucket for bilete og filer (serves via CDN, ingen 5 MB-grense)
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'media', 'media', true,
  20971520,  -- 20 MB per fil
  ARRAY[
    'image/jpeg', 'image/png', 'image/gif', 'image/webp', 'image/svg+xml',
    'application/pdf',
    'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.ms-excel',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
  ]
)
ON CONFLICT (id) DO NOTHING;

-- admin/editor kan laste opp og slette filer; member er lesevisning (kan
-- framleis lese/laste ned via media_read under, men ikkje skrive)
DROP POLICY IF EXISTS "media_insert" ON storage.objects;
DROP POLICY IF EXISTS "media_delete" ON storage.objects;

CREATE POLICY "media_insert" ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'media' AND can_edit_content());

CREATE POLICY "media_delete" ON storage.objects
  FOR DELETE TO authenticated
  USING (bucket_id = 'media' AND (owner = auth.uid() OR can_edit_content()));
