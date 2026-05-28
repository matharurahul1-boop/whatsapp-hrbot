-- ══════════════════════════════════════════════════════════════════════════════
-- HRBot — Combined Migration (001 → 006 + seed)
-- Run this once in your Supabase SQL Editor.
-- All column names are consistent with the API code and analytics views.
-- ══════════════════════════════════════════════════════════════════════════════

-- ─────────────────────────────────────────────────────────────────────────────
-- PART 1 · Extensions
-- ─────────────────────────────────────────────────────────────────────────────
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ─────────────────────────────────────────────────────────────────────────────
-- PART 2 · Enums
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TYPE org_plan                 AS ENUM ('free', 'pro', 'enterprise');
CREATE TYPE user_role                AS ENUM ('super_admin', 'admin', 'hr', 'manager', 'employee');
CREATE TYPE onboarding_status        AS ENUM ('pending', 'in_progress', 'completed');
CREATE TYPE onboarding_session_status AS ENUM ('pending', 'in_progress', 'completed', 'rejected');
CREATE TYPE onboarding_step_type     AS ENUM ('info_collection', 'document_upload', 'form', 'approval');
CREATE TYPE document_type            AS ENUM (
  'id_proof', 'address_proof', 'photo', 'contract',
  'education_certificate', 'experience_letter', 'other'
);
CREATE TYPE message_direction        AS ENUM ('inbound', 'outbound');
CREATE TYPE message_role             AS ENUM ('user', 'assistant', 'system');
CREATE TYPE conversation_status      AS ENUM ('active', 'idle', 'closed');
CREATE TYPE conversation_module      AS ENUM ('task', 'onboarding', 'leave', 'attendance', 'general');
CREATE TYPE message_source           AS ENUM ('whatsapp', 'dashboard', 'n8n', 'api', 'biometric', 'auto');
CREATE TYPE actor_type               AS ENUM ('user', 'system', 'ai_agent', 'n8n');
CREATE TYPE notification_channel     AS ENUM ('whatsapp', 'in_app', 'email');
CREATE TYPE notification_status      AS ENUM ('pending', 'sent', 'failed', 'read');
CREATE TYPE workflow_status          AS ENUM ('running', 'success', 'failed');
-- task_status uses todo/in_progress/done/cancelled (matches Kanban board)
CREATE TYPE task_status              AS ENUM ('todo', 'in_progress', 'done', 'cancelled');
CREATE TYPE task_priority            AS ENUM ('low', 'medium', 'high', 'urgent');
CREATE TYPE leave_request_status     AS ENUM ('pending', 'approved', 'rejected', 'cancelled');
CREATE TYPE attendance_status        AS ENUM ('present', 'absent', 'half_day', 'late', 'on_leave');

-- ─────────────────────────────────────────────────────────────────────────────
-- PART 3 · Core tables
-- ─────────────────────────────────────────────────────────────────────────────

-- ── Organizations ─────────────────────────────────────────────────────────────
CREATE TABLE organizations (
  id                  UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
  name                TEXT        NOT NULL,
  slug                TEXT        UNIQUE,                    -- url-friendly name
  whatsapp_number     TEXT        UNIQUE,
  wa_phone_number_id  TEXT,
  wa_access_token     TEXT,
  plan                org_plan    NOT NULL DEFAULT 'free',
  settings            JSONB       NOT NULL DEFAULT '{}',
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ── Users (extends Supabase auth.users) ──────────────────────────────────────
CREATE TABLE users (
  id                  UUID        PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  organization_id     UUID        NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  full_name           TEXT        NOT NULL,
  email               TEXT        NOT NULL,
  wa_number           TEXT,                                  -- was: whatsapp_number
  role                user_role   NOT NULL DEFAULT 'employee',
  employee_id         TEXT        UNIQUE,
  department          TEXT,
  designation         TEXT,
  manager_id          UUID        REFERENCES users(id) ON DELETE SET NULL,
  onboarding_status   onboarding_status NOT NULL DEFAULT 'pending',
  is_active           BOOLEAN     NOT NULL DEFAULT true,
  avatar_url          TEXT,
  joined_at           TIMESTAMPTZ,                           -- employee join date
  metadata            JSONB       NOT NULL DEFAULT '{}',
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at          TIMESTAMPTZ
);

CREATE INDEX idx_users_org        ON users(organization_id);
CREATE INDEX idx_users_wa         ON users(wa_number);
CREATE INDEX idx_users_manager    ON users(manager_id);
CREATE INDEX idx_users_employee_id ON users(employee_id);

-- ── Conversations ─────────────────────────────────────────────────────────────
CREATE TABLE conversations (
  id                  UUID                PRIMARY KEY DEFAULT uuid_generate_v4(),
  organization_id     UUID                NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  user_id             UUID                REFERENCES users(id) ON DELETE SET NULL,
  wa_number           TEXT                NOT NULL,          -- was: whatsapp_number
  channel             message_source      NOT NULL DEFAULT 'whatsapp',
  status              conversation_status NOT NULL DEFAULT 'active',
  current_module      conversation_module,
  current_intent      TEXT,
  context_state       JSONB               NOT NULL DEFAULT '{}',
  last_message_at     TIMESTAMPTZ,
  created_at          TIMESTAMPTZ         NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ         NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_conversations_org    ON conversations(organization_id);
CREATE INDEX idx_conversations_wa     ON conversations(wa_number);
CREATE INDEX idx_conversations_user   ON conversations(user_id);
CREATE INDEX idx_conversations_status ON conversations(status);

-- ── Messages ──────────────────────────────────────────────────────────────────
CREATE TABLE messages (
  id                  UUID              PRIMARY KEY DEFAULT uuid_generate_v4(),
  conversation_id     UUID              NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  organization_id     UUID              NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  direction           message_direction NOT NULL,
  role                message_role      NOT NULL,
  content             TEXT              NOT NULL,
  media_url           TEXT,
  media_type          TEXT,
  wa_message_id       TEXT,
  intent              TEXT,
  tokens_used         INTEGER,
  latency_ms          INTEGER,
  metadata            JSONB             NOT NULL DEFAULT '{}',
  created_at          TIMESTAMPTZ       NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_messages_conversation ON messages(conversation_id);
CREATE INDEX idx_messages_org_created  ON messages(organization_id, created_at DESC);

-- ── Audit Logs ────────────────────────────────────────────────────────────────
CREATE TABLE audit_logs (
  id                  UUID           PRIMARY KEY DEFAULT uuid_generate_v4(),
  organization_id     UUID           NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  actor_id            UUID           REFERENCES users(id) ON DELETE SET NULL,
  actor_type          actor_type     NOT NULL DEFAULT 'user',
  action              TEXT           NOT NULL,
  table_name          TEXT           NOT NULL,               -- was: resource_type
  record_id           UUID,                                  -- was: resource_id
  old_data            JSONB,                                 -- was: before_state
  new_data            JSONB,                                 -- was: after_state
  ip_address          INET,
  source              message_source NOT NULL DEFAULT 'dashboard',
  created_at          TIMESTAMPTZ    NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_audit_org_created ON audit_logs(organization_id, created_at DESC);
CREATE INDEX idx_audit_resource    ON audit_logs(table_name, record_id);

-- ── Notifications ─────────────────────────────────────────────────────────────
CREATE TABLE notifications (
  id                  UUID                  PRIMARY KEY DEFAULT uuid_generate_v4(),
  organization_id     UUID                  NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  user_id             UUID                  NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  type                TEXT                  NOT NULL,
  title               TEXT                  NOT NULL,
  body                TEXT                  NOT NULL,
  channel             notification_channel  NOT NULL DEFAULT 'in_app',
  status              notification_status   NOT NULL DEFAULT 'pending',
  is_read             BOOLEAN               NOT NULL DEFAULT false,  -- fast unread check
  action_url          TEXT,                                          -- deep-link
  meta                JSONB                 NOT NULL DEFAULT '{}',   -- extra payload
  sent_at             TIMESTAMPTZ,
  read_at             TIMESTAMPTZ,
  metadata            JSONB                 NOT NULL DEFAULT '{}',
  created_at          TIMESTAMPTZ           NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_notifications_user       ON notifications(user_id, is_read);
CREATE INDEX idx_notifications_org_created ON notifications(organization_id, created_at DESC);

-- ── n8n Workflow Logs ─────────────────────────────────────────────────────────
CREATE TABLE n8n_workflow_logs (
  id                  UUID             PRIMARY KEY DEFAULT uuid_generate_v4(),
  organization_id     UUID             NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  workflow_name       TEXT             NOT NULL,
  execution_id        TEXT,
  trigger_source      TEXT,
  input_payload       JSONB,
  output_payload      JSONB,
  status              workflow_status  NOT NULL DEFAULT 'running',
  error_message       TEXT,
  duration_ms         INTEGER,
  started_at          TIMESTAMPTZ      NOT NULL DEFAULT NOW(),
  completed_at        TIMESTAMPTZ
);

CREATE INDEX idx_n8n_logs_org ON n8n_workflow_logs(organization_id, started_at DESC);

-- ─────────────────────────────────────────────────────────────────────────────
-- PART 4 · updated_at trigger (shared)
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_organizations_updated_at
  BEFORE UPDATE ON organizations FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER trg_users_updated_at
  BEFORE UPDATE ON users FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER trg_conversations_updated_at
  BEFORE UPDATE ON conversations FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- ─────────────────────────────────────────────────────────────────────────────
-- PART 5 · Task tables
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE tasks (
  id                  UUID           PRIMARY KEY DEFAULT uuid_generate_v4(),
  organization_id     UUID           NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  title               TEXT           NOT NULL,
  description         TEXT,
  assignee_id         UUID           REFERENCES users(id) ON DELETE SET NULL,  -- was: assigned_to
  created_by          UUID           REFERENCES users(id) ON DELETE SET NULL,  -- was: assigned_by
  status              task_status    NOT NULL DEFAULT 'todo',                  -- was: 'pending'
  priority            task_priority  NOT NULL DEFAULT 'medium',
  deadline            DATE,                                                    -- was: due_date
  due_time            TIME,
  tags                TEXT[]         DEFAULT '{}',
  source              message_source NOT NULL DEFAULT 'dashboard',
  wa_conversation_id  UUID           REFERENCES conversations(id) ON DELETE SET NULL,
  completed_at        TIMESTAMPTZ,
  created_at          TIMESTAMPTZ    NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ    NOT NULL DEFAULT NOW(),
  deleted_at          TIMESTAMPTZ
);

CREATE INDEX idx_tasks_org         ON tasks(organization_id);
CREATE INDEX idx_tasks_assignee    ON tasks(assignee_id);
CREATE INDEX idx_tasks_status      ON tasks(organization_id, status);
CREATE INDEX idx_tasks_deadline    ON tasks(deadline) WHERE deleted_at IS NULL;

CREATE TABLE task_comments (
  id                  UUID           PRIMARY KEY DEFAULT uuid_generate_v4(),
  task_id             UUID           NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  user_id             UUID           REFERENCES users(id) ON DELETE SET NULL,
  content             TEXT           NOT NULL,
  source              message_source NOT NULL DEFAULT 'dashboard',
  created_at          TIMESTAMPTZ    NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_task_comments_task ON task_comments(task_id);

CREATE TABLE task_attachments (
  id                  UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
  task_id             UUID        NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  uploaded_by         UUID        REFERENCES users(id) ON DELETE SET NULL,
  file_url            TEXT        NOT NULL,
  file_name           TEXT        NOT NULL,
  file_size           INTEGER,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_task_attachments_task ON task_attachments(task_id);

CREATE TRIGGER trg_tasks_updated_at
  BEFORE UPDATE ON tasks FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- ─────────────────────────────────────────────────────────────────────────────
-- PART 6 · Onboarding tables
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE onboarding_steps (
  id                  UUID                  PRIMARY KEY DEFAULT uuid_generate_v4(),
  organization_id     UUID                  NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  step_order          INTEGER               NOT NULL,           -- was: step_number
  title               TEXT                  NOT NULL,           -- was: step_name
  description         TEXT,
  is_required         BOOLEAN               NOT NULL DEFAULT true,
  is_active           BOOLEAN               NOT NULL DEFAULT true,
  step_type           onboarding_step_type  NOT NULL DEFAULT 'info_collection',
  config              JSONB                 NOT NULL DEFAULT '{}',
  UNIQUE (organization_id, step_order)
);

CREATE TABLE onboarding_sessions (
  id                  UUID                      PRIMARY KEY DEFAULT uuid_generate_v4(),
  organization_id     UUID                      NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  employee_id         UUID                      NOT NULL REFERENCES users(id) ON DELETE CASCADE,  -- was: user_id
  initiated_by        UUID                      REFERENCES users(id) ON DELETE SET NULL,
  current_step        INTEGER                   NOT NULL DEFAULT 1,
  total_steps         INTEGER                   NOT NULL DEFAULT 8,
  status              onboarding_session_status NOT NULL DEFAULT 'pending',
  collected_data      JSONB                     NOT NULL DEFAULT '{}',
  completed_at        TIMESTAMPTZ,
  created_at          TIMESTAMPTZ               NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ               NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_onboarding_sessions_org      ON onboarding_sessions(organization_id);
CREATE INDEX idx_onboarding_sessions_employee ON onboarding_sessions(employee_id);
CREATE INDEX idx_onboarding_sessions_status   ON onboarding_sessions(status);

CREATE TABLE onboarding_documents (
  id                    UUID          PRIMARY KEY DEFAULT uuid_generate_v4(),
  onboarding_session_id UUID          NOT NULL REFERENCES onboarding_sessions(id) ON DELETE CASCADE,
  user_id               UUID          NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  document_type         document_type NOT NULL DEFAULT 'other',
  file_url              TEXT          NOT NULL,
  file_name             TEXT          NOT NULL,
  verified              BOOLEAN       NOT NULL DEFAULT false,
  verified_by           UUID          REFERENCES users(id) ON DELETE SET NULL,
  verified_at           TIMESTAMPTZ,
  uploaded_at           TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_onboarding_docs_session ON onboarding_documents(onboarding_session_id);
CREATE INDEX idx_onboarding_docs_user    ON onboarding_documents(user_id);

CREATE SEQUENCE employee_id_seq START 1000;

CREATE OR REPLACE FUNCTION generate_employee_id()
RETURNS TEXT AS $$
BEGIN
  RETURN 'EMP-' || LPAD(nextval('employee_id_seq')::TEXT, 5, '0');
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_onboarding_sessions_updated_at
  BEFORE UPDATE ON onboarding_sessions FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- ─────────────────────────────────────────────────────────────────────────────
-- PART 7 · Leave & Attendance tables
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE leave_types (
  id                  UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
  organization_id     UUID        NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name                TEXT        NOT NULL,
  default_days        INTEGER     NOT NULL DEFAULT 12,   -- was: max_days_per_year
  carry_forward       BOOLEAN     NOT NULL DEFAULT false,
  requires_approval   BOOLEAN     NOT NULL DEFAULT true,
  color               TEXT        NOT NULL DEFAULT '#22c55e',  -- was: color_hex
  is_active           BOOLEAN     NOT NULL DEFAULT true,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_leave_types_org ON leave_types(organization_id);

CREATE TABLE leave_balances (
  id                  UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
  employee_id         UUID        NOT NULL REFERENCES users(id) ON DELETE CASCADE,  -- was: user_id
  organization_id     UUID        NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  leave_type_id       UUID        NOT NULL REFERENCES leave_types(id) ON DELETE CASCADE,
  year                INTEGER     NOT NULL,
  entitled_days       DECIMAL(5,1) NOT NULL DEFAULT 0,  -- was: total_days
  used_days           DECIMAL(5,1) NOT NULL DEFAULT 0,
  carried_over        DECIMAL(5,1) NOT NULL DEFAULT 0,
  UNIQUE (employee_id, leave_type_id, year),
  CONSTRAINT positive_used    CHECK (used_days >= 0),
  CONSTRAINT used_lte_entitled CHECK (used_days <= entitled_days + carried_over)
);

-- Computed remaining days
ALTER TABLE leave_balances
  ADD COLUMN remaining_days DECIMAL(5,1)
  GENERATED ALWAYS AS (entitled_days + carried_over - used_days) STORED;

CREATE INDEX idx_leave_balances_employee ON leave_balances(employee_id, year);
CREATE INDEX idx_leave_balances_org      ON leave_balances(organization_id, year);

CREATE TABLE leave_requests (
  id                  UUID                 PRIMARY KEY DEFAULT uuid_generate_v4(),
  organization_id     UUID                 NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  employee_id         UUID                 NOT NULL REFERENCES users(id) ON DELETE CASCADE,  -- was: user_id
  leave_type_id       UUID                 NOT NULL REFERENCES leave_types(id) ON DELETE RESTRICT,
  start_date          DATE                 NOT NULL,
  end_date            DATE                 NOT NULL,
  duration_days       DECIMAL(5,1)         NOT NULL,  -- was: total_days
  reason              TEXT,
  status              leave_request_status NOT NULL DEFAULT 'pending',
  reviewed_by         UUID                 REFERENCES users(id) ON DELETE SET NULL,  -- was: approved_by
  reviewed_at         TIMESTAMPTZ,                                                   -- was: approved_at
  remarks             TEXT,                                                          -- was: rejection_reason
  source              message_source       NOT NULL DEFAULT 'dashboard',
  created_at          TIMESTAMPTZ          NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ          NOT NULL DEFAULT NOW(),
  CONSTRAINT valid_date_range CHECK (end_date >= start_date)
);

CREATE INDEX idx_leave_requests_org      ON leave_requests(organization_id);
CREATE INDEX idx_leave_requests_employee ON leave_requests(employee_id);
CREATE INDEX idx_leave_requests_status   ON leave_requests(organization_id, status);
CREATE INDEX idx_leave_requests_dates    ON leave_requests(start_date, end_date);

CREATE TABLE attendance_records (
  id                  UUID               PRIMARY KEY DEFAULT uuid_generate_v4(),
  organization_id     UUID               NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  employee_id         UUID               NOT NULL REFERENCES users(id) ON DELETE CASCADE,  -- was: user_id
  date                DATE               NOT NULL,
  check_in_time       TIMESTAMPTZ,
  check_out_time      TIMESTAMPTZ,
  total_hours         DECIMAL(4,2),
  status              attendance_status  NOT NULL DEFAULT 'absent',
  location            JSONB,
  source              message_source     NOT NULL DEFAULT 'whatsapp',
  notes               TEXT,
  created_at          TIMESTAMPTZ        NOT NULL DEFAULT NOW(),
  UNIQUE (employee_id, date)
);

CREATE INDEX idx_attendance_org_date      ON attendance_records(organization_id, date DESC);
CREATE INDEX idx_attendance_employee_date ON attendance_records(employee_id, date DESC);

-- Auto-calculate total_hours on check-out
CREATE OR REPLACE FUNCTION calc_total_hours()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.check_in_time IS NOT NULL AND NEW.check_out_time IS NOT NULL THEN
    NEW.total_hours := ROUND(
      EXTRACT(EPOCH FROM (NEW.check_out_time - NEW.check_in_time)) / 3600, 2
    );
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_attendance_calc_hours
  BEFORE INSERT OR UPDATE ON attendance_records
  FOR EACH ROW EXECUTE FUNCTION calc_total_hours();

CREATE TRIGGER trg_leave_requests_updated_at
  BEFORE UPDATE ON leave_requests FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- ─────────────────────────────────────────────────────────────────────────────
-- PART 8 · Row-Level Security
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE organizations        ENABLE ROW LEVEL SECURITY;
ALTER TABLE users                ENABLE ROW LEVEL SECURITY;
ALTER TABLE conversations        ENABLE ROW LEVEL SECURITY;
ALTER TABLE messages             ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit_logs           ENABLE ROW LEVEL SECURITY;
ALTER TABLE notifications        ENABLE ROW LEVEL SECURITY;
ALTER TABLE n8n_workflow_logs    ENABLE ROW LEVEL SECURITY;
ALTER TABLE tasks                ENABLE ROW LEVEL SECURITY;
ALTER TABLE task_comments        ENABLE ROW LEVEL SECURITY;
ALTER TABLE task_attachments     ENABLE ROW LEVEL SECURITY;
ALTER TABLE onboarding_sessions  ENABLE ROW LEVEL SECURITY;
ALTER TABLE onboarding_documents ENABLE ROW LEVEL SECURITY;
ALTER TABLE onboarding_steps     ENABLE ROW LEVEL SECURITY;
ALTER TABLE leave_types          ENABLE ROW LEVEL SECURITY;
ALTER TABLE leave_balances       ENABLE ROW LEVEL SECURITY;
ALTER TABLE leave_requests       ENABLE ROW LEVEL SECURITY;
ALTER TABLE attendance_records   ENABLE ROW LEVEL SECURITY;

-- ── RLS helper functions ──────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION auth_org_id() RETURNS UUID AS $$
  SELECT organization_id FROM users WHERE id = auth.uid()
$$ LANGUAGE sql SECURITY DEFINER STABLE;

CREATE OR REPLACE FUNCTION auth_role() RETURNS user_role AS $$
  SELECT role FROM users WHERE id = auth.uid()
$$ LANGUAGE sql SECURITY DEFINER STABLE;

CREATE OR REPLACE FUNCTION is_admin_or_above() RETURNS BOOLEAN AS $$
  SELECT auth_role() IN ('admin', 'super_admin')
$$ LANGUAGE sql SECURITY DEFINER STABLE;

CREATE OR REPLACE FUNCTION is_hr_or_above() RETURNS BOOLEAN AS $$
  SELECT auth_role() IN ('hr', 'admin', 'super_admin')
$$ LANGUAGE sql SECURITY DEFINER STABLE;

CREATE OR REPLACE FUNCTION is_manager_or_above() RETURNS BOOLEAN AS $$
  SELECT auth_role() IN ('manager', 'hr', 'admin', 'super_admin')
$$ LANGUAGE sql SECURITY DEFINER STABLE;

-- ── Organizations policies ────────────────────────────────────────────────────
CREATE POLICY "org_members_read"   ON organizations FOR SELECT USING (id = auth_org_id());
CREATE POLICY "org_admins_update"  ON organizations FOR UPDATE USING (id = auth_org_id() AND is_admin_or_above());

-- ── Users policies ────────────────────────────────────────────────────────────
CREATE POLICY "users_org_read"     ON users FOR SELECT USING (organization_id = auth_org_id() AND deleted_at IS NULL);
CREATE POLICY "users_self_update"  ON users FOR UPDATE USING (id = auth.uid());
CREATE POLICY "users_admin_manage" ON users FOR ALL    USING (organization_id = auth_org_id() AND is_admin_or_above());

-- ── Tasks policies ────────────────────────────────────────────────────────────
CREATE POLICY "tasks_org_isolation" ON tasks
  FOR ALL USING (organization_id = auth_org_id() AND deleted_at IS NULL);

CREATE POLICY "tasks_employee_own" ON tasks
  FOR SELECT USING (
    organization_id = auth_org_id() AND
    (assignee_id = auth.uid() OR created_by = auth.uid())
  );

CREATE POLICY "tasks_manager_team" ON tasks
  FOR ALL USING (organization_id = auth_org_id() AND is_manager_or_above());

-- ── Leave policies ────────────────────────────────────────────────────────────
CREATE POLICY "leave_own_read" ON leave_requests
  FOR SELECT USING (organization_id = auth_org_id() AND employee_id = auth.uid());

CREATE POLICY "leave_manager_team" ON leave_requests
  FOR ALL USING (organization_id = auth_org_id() AND is_manager_or_above());

CREATE POLICY "leave_employee_create" ON leave_requests
  FOR INSERT WITH CHECK (organization_id = auth_org_id() AND employee_id = auth.uid());

-- ── Attendance policies ───────────────────────────────────────────────────────
CREATE POLICY "attendance_own_read" ON attendance_records
  FOR SELECT USING (organization_id = auth_org_id() AND employee_id = auth.uid());

CREATE POLICY "attendance_manager_read" ON attendance_records
  FOR SELECT USING (organization_id = auth_org_id() AND is_manager_or_above());

CREATE POLICY "attendance_employee_checkin" ON attendance_records
  FOR INSERT WITH CHECK (organization_id = auth_org_id() AND employee_id = auth.uid());

CREATE POLICY "attendance_employee_checkout" ON attendance_records
  FOR UPDATE USING (organization_id = auth_org_id() AND employee_id = auth.uid());

-- ── Notifications policies ────────────────────────────────────────────────────
CREATE POLICY "notifications_own" ON notifications
  FOR ALL USING (organization_id = auth_org_id() AND user_id = auth.uid());

-- ── Onboarding policies ───────────────────────────────────────────────────────
CREATE POLICY "onboarding_hr_manage" ON onboarding_sessions
  FOR ALL USING (organization_id = auth_org_id() AND is_hr_or_above());

CREATE POLICY "onboarding_own_read" ON onboarding_sessions
  FOR SELECT USING (organization_id = auth_org_id() AND employee_id = auth.uid());

-- ── Conversations & messages ──────────────────────────────────────────────────
CREATE POLICY "conversations_admin_read" ON conversations
  FOR SELECT USING (organization_id = auth_org_id() AND is_admin_or_above());

CREATE POLICY "conversations_own_read" ON conversations
  FOR SELECT USING (organization_id = auth_org_id() AND user_id = auth.uid());

CREATE POLICY "messages_admin_read" ON messages
  FOR SELECT USING (organization_id = auth_org_id() AND is_admin_or_above());

-- ── Audit logs (admin read-only) ──────────────────────────────────────────────
CREATE POLICY "audit_admin_read" ON audit_logs
  FOR SELECT USING (organization_id = auth_org_id() AND is_admin_or_above());

-- ── n8n logs (admin only) ─────────────────────────────────────────────────────
CREATE POLICY "n8n_logs_admin" ON n8n_workflow_logs
  FOR ALL USING (organization_id = auth_org_id() AND is_admin_or_above());

-- ── Leave types & balances (HR manages, employees read own) ──────────────────
CREATE POLICY "leave_types_read" ON leave_types
  FOR SELECT USING (organization_id = auth_org_id());

CREATE POLICY "leave_types_hr_manage" ON leave_types
  FOR ALL USING (organization_id = auth_org_id() AND is_hr_or_above());

CREATE POLICY "leave_balances_own" ON leave_balances
  FOR SELECT USING (organization_id = auth_org_id() AND employee_id = auth.uid());

CREATE POLICY "leave_balances_hr_manage" ON leave_balances
  FOR ALL USING (organization_id = auth_org_id() AND is_hr_or_above());

-- ── Onboarding steps (all org members read) ──────────────────────────────────
CREATE POLICY "onboarding_steps_read" ON onboarding_steps
  FOR SELECT USING (organization_id = auth_org_id());

CREATE POLICY "onboarding_steps_hr_manage" ON onboarding_steps
  FOR ALL USING (organization_id = auth_org_id() AND is_hr_or_above());

-- ─────────────────────────────────────────────────────────────────────────────
-- PART 9 · Composite indexes (performance)
-- ─────────────────────────────────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_tasks_org_status     ON tasks(organization_id, status)     WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_tasks_org_assignee   ON tasks(organization_id, assignee_id) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_tasks_org_deadline   ON tasks(organization_id, deadline)    WHERE deleted_at IS NULL AND deadline IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_tasks_created_by     ON tasks(created_by, organization_id)  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_leave_org_status     ON leave_requests(organization_id, status);
CREATE INDEX IF NOT EXISTS idx_leave_employee_status ON leave_requests(employee_id, status);
CREATE INDEX IF NOT EXISTS idx_leave_dates          ON leave_requests(organization_id, start_date, end_date);
CREATE INDEX IF NOT EXISTS idx_leave_manager        ON leave_requests(reviewed_by, status);

CREATE INDEX IF NOT EXISTS idx_att_org_date         ON attendance_records(organization_id, date DESC);
CREATE INDEX IF NOT EXISTS idx_att_employee_date    ON attendance_records(employee_id, date DESC);
CREATE INDEX IF NOT EXISTS idx_att_org_status       ON attendance_records(organization_id, status, date);

CREATE INDEX IF NOT EXISTS idx_msg_conv_created     ON messages(conversation_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_conv_org_wa          ON conversations(organization_id, wa_number);

CREATE INDEX IF NOT EXISTS idx_notif_user_read      ON notifications(user_id, is_read, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_notif_org_created    ON notifications(organization_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_audit_org_table      ON audit_logs(organization_id, table_name, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_actor          ON audit_logs(actor_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_users_org_role       ON users(organization_id, role)        WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_users_wa_number      ON users(wa_number, organization_id)   WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_users_manager_org    ON users(manager_id, organization_id)  WHERE deleted_at IS NULL;

-- ─────────────────────────────────────────────────────────────────────────────
-- PART 10 · Analytics views
-- ─────────────────────────────────────────────────────────────────────────────

-- ── Daily attendance summary ──────────────────────────────────────────────────
CREATE OR REPLACE VIEW v_daily_attendance AS
SELECT
  organization_id,
  date,
  COUNT(*)                                                            AS total_employees,
  COUNT(*) FILTER (WHERE status = 'present')                         AS present,
  COUNT(*) FILTER (WHERE status = 'absent')                          AS absent,
  COUNT(*) FILTER (WHERE status = 'late')                            AS late,
  COUNT(*) FILTER (WHERE status = 'half_day')                        AS half_day,
  COUNT(*) FILTER (WHERE status = 'on_leave')                        AS on_leave,
  ROUND(
    COUNT(*) FILTER (WHERE status IN ('present','late'))::numeric
    / NULLIF(COUNT(*), 0) * 100, 1
  )                                                                   AS attendance_pct,
  ROUND(AVG(total_hours) FILTER (WHERE total_hours IS NOT NULL), 2)  AS avg_hours
FROM attendance_records
GROUP BY organization_id, date;

-- ── Task stats per org ────────────────────────────────────────────────────────
CREATE OR REPLACE VIEW v_task_stats AS
SELECT
  organization_id,
  COUNT(*)                                                      AS total,
  COUNT(*) FILTER (WHERE status = 'todo')                       AS todo,
  COUNT(*) FILTER (WHERE status = 'in_progress')                AS in_progress,
  COUNT(*) FILTER (WHERE status = 'done')                       AS done,
  COUNT(*) FILTER (WHERE status = 'cancelled')                  AS cancelled,
  COUNT(*) FILTER (
    WHERE deadline < NOW() AND status NOT IN ('done','cancelled')
  )                                                             AS overdue,
  COUNT(*) FILTER (
    WHERE deadline BETWEEN NOW() AND NOW() + INTERVAL '48 hours'
    AND   status NOT IN ('done','cancelled')
  )                                                             AS due_soon,
  ROUND(
    COUNT(*) FILTER (WHERE status = 'done')::numeric
    / NULLIF(COUNT(*) FILTER (WHERE status != 'cancelled'), 0) * 100, 1
  )                                                             AS completion_pct
FROM tasks
WHERE deleted_at IS NULL
GROUP BY organization_id;

-- ── Leave balance summary per employee ───────────────────────────────────────
CREATE OR REPLACE VIEW v_leave_summary AS
SELECT
  lb.employee_id,
  lb.organization_id,
  lt.name                                                AS leave_type,
  lt.color,
  lb.entitled_days,
  lb.used_days,
  lb.remaining_days,
  lb.carried_over,
  lb.year,
  COUNT(lr.id) FILTER (WHERE lr.status = 'pending')     AS pending_requests
FROM leave_balances lb
JOIN  leave_types lt  ON lt.id = lb.leave_type_id
LEFT JOIN leave_requests lr
  ON  lr.employee_id    = lb.employee_id
  AND lr.leave_type_id  = lb.leave_type_id
  AND EXTRACT(YEAR FROM lr.start_date) = lb.year
GROUP BY
  lb.employee_id, lb.organization_id, lt.name, lt.color,
  lb.entitled_days, lb.used_days, lb.remaining_days,
  lb.carried_over, lb.year;

-- ── Employee directory ────────────────────────────────────────────────────────
CREATE OR REPLACE VIEW v_employee_directory AS
SELECT
  u.id,
  u.organization_id,
  u.full_name,
  u.email,
  u.wa_number,
  u.role,
  u.department,
  u.designation,
  u.employee_id,
  u.avatar_url,
  u.is_active,
  u.joined_at,
  m.full_name       AS manager_name,
  m.email           AS manager_email,
  att.status        AS today_status,
  att.check_in_time,
  att.check_out_time,
  att.total_hours
FROM users u
LEFT JOIN users m ON m.id = u.manager_id
LEFT JOIN attendance_records att
  ON  att.employee_id = u.id
  AND att.date        = CURRENT_DATE
WHERE u.deleted_at IS NULL;

-- ── Pending leave approvals ───────────────────────────────────────────────────
CREATE OR REPLACE VIEW v_pending_approvals AS
SELECT
  lr.id,
  lr.organization_id,
  lr.employee_id,
  u.full_name                               AS employee_name,
  u.department,
  u.manager_id,
  lt.name                                   AS leave_type,
  lt.color,
  lr.start_date,
  lr.end_date,
  lr.duration_days,
  lr.reason,
  lr.status,
  lr.created_at,
  CURRENT_DATE - lr.created_at::date        AS days_waiting
FROM leave_requests lr
JOIN  users       u  ON u.id  = lr.employee_id
JOIN  leave_types lt ON lt.id = lr.leave_type_id
WHERE lr.status = 'pending'
ORDER BY lr.created_at;

-- ── Org-level KPI snapshot ────────────────────────────────────────────────────
CREATE OR REPLACE VIEW v_org_kpis AS
SELECT
  o.id                                                          AS org_id,
  o.name                                                        AS org_name,
  COUNT(DISTINCT u.id) FILTER (WHERE u.is_active)              AS active_employees,
  COUNT(DISTINCT u.id) FILTER (
    WHERE u.is_active AND u.joined_at >= DATE_TRUNC('month', NOW())
  )                                                             AS new_this_month,
  COUNT(DISTINCT att.employee_id) FILTER (
    WHERE att.date = CURRENT_DATE AND att.status IN ('present','late')
  )                                                             AS present_today,
  COUNT(DISTINCT att.employee_id) FILTER (
    WHERE att.date = CURRENT_DATE AND att.status = 'on_leave'
  )                                                             AS on_leave_today,
  COUNT(DISTINCT t.id) FILTER (
    WHERE t.status NOT IN ('done','cancelled') AND t.deleted_at IS NULL
  )                                                             AS open_tasks,
  COUNT(DISTINCT t.id) FILTER (
    WHERE t.deadline < NOW()
    AND   t.status NOT IN ('done','cancelled') AND t.deleted_at IS NULL
  )                                                             AS overdue_tasks,
  COUNT(DISTINCT lr.id) FILTER (WHERE lr.status = 'pending')   AS pending_leave_requests,
  COUNT(DISTINCT os.id) FILTER (WHERE os.status = 'in_progress') AS active_onboardings
FROM organizations o
LEFT JOIN users             u   ON u.organization_id   = o.id AND u.deleted_at IS NULL
LEFT JOIN attendance_records att ON att.organization_id = o.id
LEFT JOIN tasks             t   ON t.organization_id   = o.id
LEFT JOIN leave_requests    lr  ON lr.organization_id  = o.id
LEFT JOIN onboarding_sessions os ON os.organization_id = o.id
GROUP BY o.id, o.name;

-- ─────────────────────────────────────────────────────────────────────────────
-- PART 11 · Helper functions
-- ─────────────────────────────────────────────────────────────────────────────

-- ── get_org_kpis() ────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION get_org_kpis(p_org_id uuid)
RETURNS TABLE (
  active_employees       bigint,
  new_this_month         bigint,
  present_today          bigint,
  on_leave_today         bigint,
  open_tasks             bigint,
  overdue_tasks          bigint,
  pending_leave_requests bigint,
  active_onboardings     bigint,
  attendance_pct_today   numeric
) LANGUAGE sql STABLE SECURITY DEFINER AS $$
  SELECT
    active_employees,
    new_this_month,
    present_today,
    on_leave_today,
    open_tasks,
    overdue_tasks,
    pending_leave_requests,
    active_onboardings,
    ROUND(present_today::numeric / NULLIF(active_employees, 0) * 100, 1)
  FROM v_org_kpis
  WHERE org_id = p_org_id;
$$;

-- ── get_attendance_heatmap() ──────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION get_attendance_heatmap(
  p_org_id uuid,
  p_days   int DEFAULT 30
)
RETURNS TABLE (
  date            date,
  present         bigint,
  absent          bigint,
  late            bigint,
  on_leave        bigint,
  attendance_pct  numeric
) LANGUAGE sql STABLE SECURITY DEFINER AS $$
  SELECT
    date,
    COUNT(*) FILTER (WHERE status IN ('present','late'))  AS present,
    COUNT(*) FILTER (WHERE status = 'absent')             AS absent,
    COUNT(*) FILTER (WHERE status = 'late')               AS late,
    COUNT(*) FILTER (WHERE status = 'on_leave')           AS on_leave,
    ROUND(
      COUNT(*) FILTER (WHERE status IN ('present','late'))::numeric
      / NULLIF(COUNT(*), 0) * 100, 1
    )                                                     AS attendance_pct
  FROM attendance_records
  WHERE organization_id = p_org_id
    AND date >= CURRENT_DATE - p_days
  GROUP BY date
  ORDER BY date;
$$;

-- ── get_task_trend() ──────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION get_task_trend(p_org_id uuid)
RETURNS TABLE (
  week_start  date,
  created     bigint,
  completed   bigint
) LANGUAGE sql STABLE SECURITY DEFINER AS $$
  SELECT
    DATE_TRUNC('week', created_at)::date        AS week_start,
    COUNT(*)                                    AS created,
    COUNT(*) FILTER (WHERE status = 'done')     AS completed
  FROM tasks
  WHERE organization_id = p_org_id
    AND deleted_at IS NULL
    AND created_at >= NOW() - INTERVAL '4 weeks'
  GROUP BY 1
  ORDER BY 1;
$$;

-- ── mark_notifications_read() ─────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION mark_notifications_read(
  p_user_id uuid,
  p_ids     uuid[] DEFAULT NULL
)
RETURNS void LANGUAGE sql SECURITY DEFINER AS $$
  UPDATE notifications
  SET is_read = true, read_at = NOW(), status = 'read'
  WHERE user_id   = p_user_id
    AND is_read   = false
    AND (p_ids IS NULL OR id = ANY(p_ids));
$$;

-- ── init_leave_balances() ─────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION init_leave_balances(
  p_employee_id uuid,
  p_org_id      uuid,
  p_year        int DEFAULT EXTRACT(YEAR FROM NOW())::int
)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  INSERT INTO leave_balances (employee_id, organization_id, leave_type_id, entitled_days, year)
  SELECT
    p_employee_id,
    p_org_id,
    id,
    default_days,
    p_year
  FROM leave_types
  WHERE organization_id = p_org_id
    AND is_active = true
  ON CONFLICT (employee_id, leave_type_id, year) DO NOTHING;
END;
$$;

-- ── Auto-init leave balances on user insert ────────────────────────────────────
CREATE OR REPLACE FUNCTION trg_init_leave_balances()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  PERFORM init_leave_balances(NEW.id, NEW.organization_id);
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_user_created_init_leave ON users;
CREATE TRIGGER on_user_created_init_leave
  AFTER INSERT ON users
  FOR EACH ROW EXECUTE FUNCTION trg_init_leave_balances();

-- ── Auto-deduct / refund leave balance on status change ───────────────────────
CREATE OR REPLACE FUNCTION trg_update_leave_balance()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  -- Approved: deduct
  IF NEW.status = 'approved' AND OLD.status != 'approved' THEN
    UPDATE leave_balances
    SET used_days = used_days + NEW.duration_days
    WHERE employee_id   = NEW.employee_id
      AND leave_type_id = NEW.leave_type_id
      AND year = EXTRACT(YEAR FROM NEW.start_date)::int;
  END IF;

  -- Cancelled / rejected after approval: refund
  IF OLD.status = 'approved' AND NEW.status IN ('cancelled','rejected') THEN
    UPDATE leave_balances
    SET used_days = GREATEST(0, used_days - NEW.duration_days)
    WHERE employee_id   = NEW.employee_id
      AND leave_type_id = NEW.leave_type_id
      AND year = EXTRACT(YEAR FROM NEW.start_date)::int;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_leave_status_change ON leave_requests;
CREATE TRIGGER on_leave_status_change
  AFTER UPDATE OF status ON leave_requests
  FOR EACH ROW EXECUTE FUNCTION trg_update_leave_balance();

-- ── create_notification() ─────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION create_notification(
  p_org_id     uuid,
  p_user_id    uuid,
  p_type       text,
  p_title      text,
  p_body       text,
  p_action_url text  DEFAULT NULL,
  p_meta       jsonb DEFAULT '{}'::jsonb
)
RETURNS uuid LANGUAGE sql SECURITY DEFINER AS $$
  INSERT INTO notifications
    (organization_id, user_id, type, title, body, action_url, meta)
  VALUES
    (p_org_id, p_user_id, p_type, p_title, p_body, p_action_url, p_meta)
  RETURNING id;
$$;

-- ── Auto-assign employee_id on user insert ────────────────────────────────────
CREATE OR REPLACE FUNCTION trg_assign_employee_id()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.employee_id IS NULL THEN
    NEW.employee_id := generate_employee_id();
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER on_user_assign_employee_id
  BEFORE INSERT ON users
  FOR EACH ROW EXECUTE FUNCTION trg_assign_employee_id();

-- ─────────────────────────────────────────────────────────────────────────────
-- PART 12 · Seed data
-- ─────────────────────────────────────────────────────────────────────────────

-- Demo organization
INSERT INTO organizations (id, name, slug, plan, settings) VALUES
  (
    '00000000-0000-0000-0000-000000000001',
    'Demo Company',
    'demo-company',
    'pro',
    '{"timezone":"Asia/Kolkata","work_hours":{"start":"09:00","end":"18:00"}}'
  )
ON CONFLICT (id) DO NOTHING;

-- Default leave types for demo org
INSERT INTO leave_types (organization_id, name, default_days, carry_forward, requires_approval, color, is_active) VALUES
  ('00000000-0000-0000-0000-000000000001', 'Casual Leave',    12,  false, true,  '#22c55e', true),
  ('00000000-0000-0000-0000-000000000001', 'Sick Leave',      10,  false, false, '#ef4444', true),
  ('00000000-0000-0000-0000-000000000001', 'Annual Leave',    21,  true,  true,  '#3b82f6', true),
  ('00000000-0000-0000-0000-000000000001', 'Maternity Leave', 180, false, true,  '#ec4899', true)
ON CONFLICT DO NOTHING;

-- Default onboarding steps for demo org
INSERT INTO onboarding_steps (organization_id, step_order, title, description, step_type, is_active) VALUES
  ('00000000-0000-0000-0000-000000000001', 1, 'Personal Information',   'Collect name, DOB, contact details',  'info_collection', true),
  ('00000000-0000-0000-0000-000000000001', 2, 'Address Details',        'Permanent and current address',       'info_collection', true),
  ('00000000-0000-0000-0000-000000000001', 3, 'Emergency Contact',      'Emergency contact details',           'info_collection', true),
  ('00000000-0000-0000-0000-000000000001', 4, 'ID Proof Upload',        'Aadhar, PAN, Passport',               'document_upload', true),
  ('00000000-0000-0000-0000-000000000001', 5, 'Address Proof Upload',   'Utility bill or rental agreement',    'document_upload', true),
  ('00000000-0000-0000-0000-000000000001', 6, 'Education Certificates', 'Degree and mark sheets',              'document_upload', true),
  ('00000000-0000-0000-0000-000000000001', 7, 'Contract Signing',       'Employment contract acceptance',      'form',            true),
  ('00000000-0000-0000-0000-000000000001', 8, 'HR Approval',            'Final HR sign-off',                   'approval',        true)
ON CONFLICT DO NOTHING;

-- ══════════════════════════════════════════════════════════════════════════════
-- DONE.  All tables, RLS, views, functions and seed data are in one file.
-- Next step: go to Supabase → SQL Editor → paste this file → Run.
-- Then create your first admin user via Authentication → Users → Add user,
-- and INSERT a row into the public.users table for that auth user.
-- ══════════════════════════════════════════════════════════════════════════════
