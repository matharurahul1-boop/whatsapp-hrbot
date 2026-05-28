-- ─── Enums ────────────────────────────────────────────────────────────────────
CREATE TYPE onboarding_session_status AS ENUM ('pending', 'in_progress', 'completed', 'rejected');
CREATE TYPE onboarding_step_type AS ENUM ('info_collection', 'document_upload', 'form', 'approval');
CREATE TYPE document_type AS ENUM (
  'id_proof', 'address_proof', 'photo', 'contract',
  'education_certificate', 'experience_letter', 'other'
);

-- ─── Onboarding Steps Config (per org) ───────────────────────────────────────
CREATE TABLE onboarding_steps (
  id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  organization_id     UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  step_number         INTEGER NOT NULL,
  step_name           TEXT NOT NULL,
  description         TEXT,
  is_required         BOOLEAN NOT NULL DEFAULT true,
  step_type           onboarding_step_type NOT NULL DEFAULT 'info_collection',
  config              JSONB NOT NULL DEFAULT '{}',
  UNIQUE (organization_id, step_number)
);

-- ─── Onboarding Sessions ──────────────────────────────────────────────────────
CREATE TABLE onboarding_sessions (
  id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  organization_id     UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  user_id             UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  initiated_by        UUID REFERENCES users(id) ON DELETE SET NULL,
  current_step        INTEGER NOT NULL DEFAULT 1,
  total_steps         INTEGER NOT NULL DEFAULT 8,
  status              onboarding_session_status NOT NULL DEFAULT 'pending',
  collected_data      JSONB NOT NULL DEFAULT '{}',
  completed_at        TIMESTAMPTZ,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_onboarding_sessions_org ON onboarding_sessions(organization_id);
CREATE INDEX idx_onboarding_sessions_user ON onboarding_sessions(user_id);
CREATE INDEX idx_onboarding_sessions_status ON onboarding_sessions(status);

-- ─── Onboarding Documents ─────────────────────────────────────────────────────
CREATE TABLE onboarding_documents (
  id                      UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  onboarding_session_id   UUID NOT NULL REFERENCES onboarding_sessions(id) ON DELETE CASCADE,
  user_id                 UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  document_type           document_type NOT NULL DEFAULT 'other',
  file_url                TEXT NOT NULL,
  file_name               TEXT NOT NULL,
  verified                BOOLEAN NOT NULL DEFAULT false,
  verified_by             UUID REFERENCES users(id) ON DELETE SET NULL,
  verified_at             TIMESTAMPTZ,
  uploaded_at             TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_onboarding_docs_session ON onboarding_documents(onboarding_session_id);
CREATE INDEX idx_onboarding_docs_user ON onboarding_documents(user_id);

-- ─── Employee ID Generator ────────────────────────────────────────────────────
CREATE SEQUENCE employee_id_seq START 1000;

CREATE OR REPLACE FUNCTION generate_employee_id()
RETURNS TEXT AS $$
BEGIN
  RETURN 'EMP-' || LPAD(nextval('employee_id_seq')::TEXT, 5, '0');
END;
$$ LANGUAGE plpgsql;

-- ─── updated_at triggers ──────────────────────────────────────────────────────
CREATE TRIGGER trg_onboarding_sessions_updated_at
  BEFORE UPDATE ON onboarding_sessions
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();
