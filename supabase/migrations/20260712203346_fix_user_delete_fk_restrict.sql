-- Fix: deleting a Workspace user (manage-user Edge Function's "remove"
-- action, calling auth.admin.deleteUser()) has always failed with a
-- foreign-key violation for any user who ever created a task, wrote an
-- announcement, or authored a KB article. users.id has
-- ON DELETE CASCADE from auth.users (baseline_schema.sql:56), so deleting
-- the auth user correctly cascades into deleting the matching public.users
-- row -- but tasks.created_by / announcements.author_id / kb_articles.author_id
-- (baseline_schema.sql:93,104,121) all reference users(id) with NO ON DELETE
-- clause at all (implicit NO ACTION/RESTRICT), unlike the sibling columns
-- tasks.assigned_to and links.created_by, which both correctly use
-- ON DELETE SET NULL. Postgres therefore blocks the whole cascade chain
-- with a real FK-violation error the instant the deleted user has authored
-- any content at all -- which is the common case for exactly the admin/
-- editor accounts most likely to be removed via this UI, not an edge case.
--
-- Fixed the same way as the already-correct assigned_to/created_by (links)
-- columns: drop NOT NULL, switch to ON DELETE SET NULL. Content is
-- preserved (task/announcement/article stays, orphaned from its former
-- author) rather than being cascade-deleted, matching this schema's
-- existing precedent and avoiding silent data loss on user removal.

ALTER TABLE tasks
  ALTER COLUMN created_by DROP NOT NULL;
ALTER TABLE tasks
  DROP CONSTRAINT IF EXISTS tasks_created_by_fkey;
ALTER TABLE tasks
  ADD CONSTRAINT tasks_created_by_fkey
  FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL;

ALTER TABLE announcements
  ALTER COLUMN author_id DROP NOT NULL;
ALTER TABLE announcements
  DROP CONSTRAINT IF EXISTS announcements_author_id_fkey;
ALTER TABLE announcements
  ADD CONSTRAINT announcements_author_id_fkey
  FOREIGN KEY (author_id) REFERENCES users(id) ON DELETE SET NULL;

ALTER TABLE kb_articles
  ALTER COLUMN author_id DROP NOT NULL;
ALTER TABLE kb_articles
  DROP CONSTRAINT IF EXISTS kb_articles_author_id_fkey;
ALTER TABLE kb_articles
  ADD CONSTRAINT kb_articles_author_id_fkey
  FOREIGN KEY (author_id) REFERENCES users(id) ON DELETE SET NULL;
