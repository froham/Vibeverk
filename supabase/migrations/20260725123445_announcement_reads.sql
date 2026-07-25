-- Per-brukar lest-status for "viktig"-kunngjeringar (Workspace-banneret).
-- Fram til no vart "lukka"/lest lagra i localStorage, per nettlesar/eining --
-- ikkje kopla til brukarkontoen. Same brukar på ein annan PC/mobil/nettlesar
-- (eller etter tømt nettlesardata) såg banneret på nytt, sjølv om dei alt
-- hadde lese saka andre stader. read_by flyttar dette til brukarkontoen.

ALTER TABLE announcements ADD COLUMN IF NOT EXISTS read_by uuid[] NOT NULL DEFAULT '{}';

-- SECURITY DEFINER: omgår RLS-en sin ann_admin-policy (som elles krev
-- can_edit_content(), dvs. berre admin/editor) sidan EIN KVAR innlogga
-- brukar (også member) må kunne markere ei kunngjering som lest for seg
-- sjølv. Bruker auth.uid() frå den innlogga si eiga økt -- ingen kan
-- markere lest for nokon andre, og p_id må vere ein reell announcements-rad.
CREATE OR REPLACE FUNCTION mark_announcement_read(p_id uuid)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Krev innlogging';
  END IF;
  UPDATE announcements
  SET read_by = array_append(read_by, auth.uid())
  WHERE id = p_id AND NOT (auth.uid() = ANY(read_by));
END;
$$;

REVOKE ALL ON FUNCTION mark_announcement_read(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION mark_announcement_read(uuid) TO authenticated;

NOTIFY pgrst, 'reload schema';
