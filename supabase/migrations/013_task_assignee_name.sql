-- ─── tasks.assignee_name ──────────────────────────────────────────────────────
-- Denormalized copy of users.full_name for the task's assignee, kept in sync
-- via triggers, so assignee name is visible directly in the tasks table
-- (e.g. in the Supabase Table Editor) without needing a join.

ALTER TABLE tasks ADD COLUMN assignee_name TEXT;

-- Backfill existing rows
UPDATE tasks
SET assignee_name = users.full_name
FROM users
WHERE tasks.assignee_id = users.id;

-- Keep assignee_name in sync whenever a task's assignee_id changes
CREATE OR REPLACE FUNCTION sync_task_assignee_name()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.assignee_id IS NULL THEN
    NEW.assignee_name := NULL;
  ELSE
    SELECT full_name INTO NEW.assignee_name FROM users WHERE id = NEW.assignee_id;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_tasks_sync_assignee_name
  BEFORE INSERT OR UPDATE OF assignee_id ON tasks
  FOR EACH ROW EXECUTE FUNCTION sync_task_assignee_name();

-- Keep assignee_name in sync whenever a user's full_name changes
CREATE OR REPLACE FUNCTION sync_task_assignee_name_on_user_rename()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.full_name IS DISTINCT FROM OLD.full_name THEN
    UPDATE tasks SET assignee_name = NEW.full_name WHERE assignee_id = NEW.id;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_users_sync_task_assignee_name
  AFTER UPDATE OF full_name ON users
  FOR EACH ROW EXECUTE FUNCTION sync_task_assignee_name_on_user_rename();

CREATE INDEX idx_tasks_assignee_name ON tasks(assignee_name);
