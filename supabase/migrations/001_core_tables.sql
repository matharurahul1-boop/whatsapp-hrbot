-- ─── Extensions ──────────────────────────────────────────────────────────────
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ─── Enums ────────────────────────────────────────────────────────────────────
CREATE TYPE org_plan AS ENUM ('free', 'pro', 'enterprise');
CREATE TYPE user_role AS ENUM ('super_admin', 'admin', 'hr', 'manager', 'employee');
CREATE TYPE onboarding_status AS ENUM ('pending', 'in_progress', 'completed');
CREATE TYPE message_direction AS ENUM ('inbound', 'outbound');
CREATE TYPE message_role AS ENUM ('user', 'assistant', 'system');
CREATE TYPE conversation_status AS ENUM ('active', 'idle', 'closed');
CREATE TYPE conversation_module AS ENUM ('task', 'onboarding', 'leave', 'attendance', 'general');
CREATE TYPE message_source AS ENUM ('whatsapp', 'dashboard', 'n8n', 'api', 'biometric', 'auto');
CREATE TYPE actor_type AS ENUM ('user', 'system', 'ai_agent', 'n8n');
CREATE TYPE notification_channel AS ENUM ('whatsapp', 'in_app', 'email');
CREATE TYPE notification_status AS ENUM ('pending', 'sent', 'failed', 'read');
CREATE TYPE workflow_status AS ENUM ('running', 'success', 'failed');

-- ─── Organizations ────────────────────────────────────────────────────────────
CREATE TABLE organizations (
  id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name                TEXT NOT NULL,
  whatsapp_number     TEXT UNIQUE,
  wa_phone_number_id  TEXT,
  wa_access_token     TEXT,
  plan                org_plan NOT NULL DEFAULT 'free',
  settings            JSONB NOT NULL DEFAULT '{}',
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ─── Users (extends Supabase auth.users) ─────────────────────────────────────
CREATE TABLE users (
  id                  UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  organization_id     UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  full_name           TEXT NOT NULL,
  email               TEXT NOT NULL,
  whatsapp_number     TEXT,
  role                user_role NOT NULL DEFAULT 'employee',
  employee_id         TEXT UNIQUE,
  department          TEXT,
  designation         TEXT,
  manager_id          UUID REFERENCES users(id) ON DELETE SET NULL,
  onboarding_status   onboarding_status NOT NULL DEFAULT 'pending',
  is_active           BOOLEAN NOT NULL DEFAULT true,
  avatar_url          TEXT,
  metadata            JSONB NOT NULL DEFAULT '{}',
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at          TIMESTAMPTZ
);

CREATE INDEX idx_users_org ON users(organization_id);
CREATE INDEX idx_users_wa ON users(whatsapp_number);
CREATE INDEX idx_users_manager ON users(manager_id);
CREATE INDEX idx_users_employee_id ON users(employee_id);

-- ─── Conversations ────────────────────────────────────────────────────────────
CREATE TABLE conversations (
  id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  organization_id     UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  user_id             UUID REFERENCES users(id) ON DELETE SET NULL,
  whatsapp_number     TEXT NOT NULL,
  channel             message_source NOT NULL DEFAULT 'whatsapp',
  status              conversation_status NOT NULL DEFAULT 'active',
  current_module      conversation_module,
  current_intent      TEXT,
  context_state       JSONB NOT NULL DEFAULT '{}',
  last_message_at     TIMESTAMPTZ,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_conversations_org ON conversations(organization_id);
CREATE INDEX idx_conversations_wa ON conversations(whatsapp_number);
CREATE INDEX idx_conversations_user ON conversations(user_id);
CREATE INDEX idx_conversations_status ON conversations(status);

-- ─── Messages ────────────────────────────────────────────────────────────────
CREATE TABLE messages (
  id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  conversation_id     UUID NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  organization_id     UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  direction           message_direction NOT NULL,
  role                message_role NOT NULL,
  content             TEXT NOT NULL,
  media_url           TEXT,
  media_type          TEXT,
  wa_message_id       TEXT,
  intent              TEXT,
  tokens_used         INTEGER,
  latency_ms          INTEGER,
  metadata            JSONB NOT NULL DEFAULT '{}',
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_messages_conversation ON messages(conversation_id);
CREATE INDEX idx_messages_org_created ON messages(organization_id, created_at DESC);

-- ─── Audit Logs ───────────────────────────────────────────────────────────────
CREATE TABLE audit_logs (
  id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  organization_id     UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  actor_id            UUID REFERENCES users(id) ON DELETE SET NULL,
  actor_type          actor_type NOT NULL DEFAULT 'user',
  action              TEXT NOT NULL,
  resource_type       TEXT NOT NULL,
  resource_id         UUID,
  before_state        JSONB,
  after_state         JSONB,
  ip_address          INET,
  source              message_source NOT NULL DEFAULT 'dashboard',
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_audit_org_created ON audit_logs(organization_id, created_at DESC);
CREATE INDEX idx_audit_resource ON audit_logs(resource_type, resource_id);

-- ─── Notifications ────────────────────────────────────────────────────────────
CREATE TABLE notifications (
  id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  organization_id     UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  user_id             UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  type                TEXT NOT NULL,
  title               TEXT NOT NULL,
  body                TEXT NOT NULL,
  channel             notification_channel NOT NULL DEFAULT 'in_app',
  status              notification_status NOT NULL DEFAULT 'pending',
  sent_at             TIMESTAMPTZ,
  read_at             TIMESTAMPTZ,
  metadata            JSONB NOT NULL DEFAULT '{}',
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_notifications_user ON notifications(user_id, status);
CREATE INDEX idx_notifications_org_created ON notifications(organization_id, created_at DESC);

-- ─── n8n Workflow Logs ────────────────────────────────────────────────────────
CREATE TABLE n8n_workflow_logs (
  id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  organization_id     UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  workflow_name       TEXT NOT NULL,
  execution_id        TEXT,
  trigger_source      TEXT,
  input_payload       JSONB,
  output_payload      JSONB,
  status              workflow_status NOT NULL DEFAULT 'running',
  error_message       TEXT,
  duration_ms         INTEGER,
  started_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at        TIMESTAMPTZ
);

CREATE INDEX idx_n8n_logs_org ON n8n_workflow_logs(organization_id, started_at DESC);

-- ─── updated_at trigger ───────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_organizations_updated_at
  BEFORE UPDATE ON organizations
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER trg_users_updated_at
  BEFORE UPDATE ON users
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER trg_conversations_updated_at
  BEFORE UPDATE ON conversations
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();
