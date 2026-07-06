-- Tracks who last modified a task (status/priority/deadline/assignee/etc.),
-- separate from created_by. Used to widen an employee's task visibility to
-- include tasks they've touched even if they didn't create or aren't
-- assigned to them.

ALTER TABLE tasks ADD COLUMN updated_by UUID REFERENCES users(id) ON DELETE SET NULL;
CREATE INDEX idx_tasks_updated_by ON tasks(updated_by);
