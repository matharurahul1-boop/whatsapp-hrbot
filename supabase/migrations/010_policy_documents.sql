-- AI Policy Q&A Bot
-- Stores org policy documents (text content) for Groq Q&A retrieval

CREATE TABLE IF NOT EXISTS policy_documents (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid        NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  created_by      uuid        REFERENCES users(id) ON DELETE SET NULL,
  title           text        NOT NULL,
  file_name       text,                          -- original filename
  content         text        NOT NULL,          -- extracted plain text
  category        text        DEFAULT 'general', -- e.g. leave, hr, conduct, benefits
  is_active       boolean     NOT NULL DEFAULT true,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_policy_docs_org
  ON policy_documents (organization_id, is_active, created_at DESC);

-- Track which WhatsApp messages were answered by the policy bot
ALTER TABLE wa_logs
  ADD COLUMN IF NOT EXISTS policy_bot_reply boolean DEFAULT false;
