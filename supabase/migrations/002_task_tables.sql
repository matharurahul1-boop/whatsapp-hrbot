-- ─── Enums ────────────────────────────────────────────────────────────────────
CREATE TYPE task_status   AS ENUM ('pending', 'in_progress', 'completed', 'cancelled');
CREATE TYPE task_priority AS ENUM ('low', 'medium', 'high', 'urgent');

-- ─── Tasks ────────────────────────────────────────────────────────────────────
CREATE TABLE tasks (
  id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  organization_id     UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  title               TEXT NOT NULL,
  description         TEXT,
  assigned_to         UUID REFERENCES users(id) ON DELETE SET NULL,
  assigned_by         UUID REFERENCES users(id) ON DELETE SET NULL,
  status              task_status NOT NULL DEFAULT 'pending',
  priority            task_priority NOT NULL DEFAULT 'medium',
  due_date            DATE,
  due_time            TIME,
  tags                TEXT[] DEFAULT '{}',
  source              message_source NOT NULL DEFAULT 'dashboard',
  wa_conversation_id  UUID REFERENCES conversations(id) ON DELETE SET NULL,
  completed_at        TIMESTAMPTZ,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at          TIMESTAMPTZ
);

CREATE INDEX idx_tasks_org ON tasks(organization_id);
CREATE INDEX idx_tasks_assigned_to ON tasks(assigned_to);
CREATE INDEX idx_tasks_status ON tasks(organization_id, status);
CREATE INDEX idx_tasks_due_date ON tasks(due_date) WHERE deleted_at IS NULL;

-- ─── Task Comments ────────────────────────────────────────────────────────────
CREATE TABLE task_comments (
  id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  task_id             UUID NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  user_id             UUID REFERENCES users(id) ON DELETE SET NULL,
  content             TEXT NOT NULL,
  source              message_source NOT NULL DEFAULT 'dashboard',
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_task_comments_task ON task_comments(task_id);

-- ─── Task Attachments ─────────────────────────────────────────────────────────
CREATE TABLE task_attachments (
  id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  task_id             UUID NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  uploaded_by         UUID REFERENCES users(id) ON DELETE SET NULL,
  file_url            TEXT NOT NULL,
  file_name           TEXT NOT NULL,
  file_size           INTEGER,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_task_attachments_task ON task_attachments(task_id);

-- ─── updated_at triggers ──────────────────────────────────────────────────────
CREATE TRIGGER trg_tasks_updated_at
  BEFORE UPDATE ON tasks
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();
