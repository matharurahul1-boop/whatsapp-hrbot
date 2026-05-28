-- ============================================================
-- wa_logs — WhatsApp two-way message log
-- Every inbound message AND every outbound send is recorded here.
-- Status updates (delivered / read / failed) update the same row
-- via the unique meta_message_id constraint.
-- ============================================================

-- ── Enums ───────────────────────────────────────────────────
DO $$ BEGIN
  CREATE TYPE wa_direction      AS ENUM ('incoming', 'outgoing');
  CREATE TYPE wa_msg_type       AS ENUM (
    'text', 'image', 'document', 'audio', 'video',
    'sticker', 'location', 'button', 'interactive',
    'reaction', 'template', 'unsupported', 'unknown'
  );
  CREATE TYPE wa_delivery_status AS ENUM (
    'pending',    -- outgoing: just created, not yet accepted by Meta
    'sent',       -- outgoing: accepted by Meta API
    'delivered',  -- outgoing: delivered to device
    'read',       -- outgoing: read by recipient
    'failed',     -- outgoing: permanent failure
    'received'    -- incoming: successfully received & processed
  );
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

-- ── Table ────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS wa_logs (
  id                  uuid          PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Organisation & user
  organization_id     uuid          NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  user_id             uuid          REFERENCES users(id) ON DELETE SET NULL,   -- NULL = unknown number
  wa_number           text          NOT NULL,          -- the human's WhatsApp number (E.164)
  contact_name        text,                            -- display name from Meta contacts[]

  -- Message identity
  meta_message_id     text          UNIQUE NOT NULL,   -- Meta's wamid — dedup key
  direction           wa_direction  NOT NULL,
  message_type        wa_msg_type   NOT NULL DEFAULT 'text',

  -- Content (populated according to type)
  message_text        text,                            -- for text / button / interactive
  media_id            text,                            -- Meta media ID (image, doc, audio…)
  media_url           text,                            -- resolved CDN URL (populated lazily)
  media_mime_type     text,
  media_filename      text,
  media_caption       text,
  location_lat        double precision,
  location_lng        double precision,
  location_name       text,
  reaction_emoji      text,
  reply_to_message_id text,                            -- context.message_id if a reply

  -- Delivery lifecycle
  delivery_status     wa_delivery_status NOT NULL DEFAULT 'received',
  sent_at             timestamptz,
  delivered_at        timestamptz,
  read_at             timestamptz,
  failed_at           timestamptz,
  failure_code        integer,
  failure_reason      text,

  -- Raw payloads for debugging / audit
  raw_webhook_payload jsonb,                           -- full Meta webhook value object
  api_response        jsonb,                           -- Meta sendMessage response body

  -- Timestamps
  wa_timestamp        timestamptz,                     -- timestamp from Meta (unix → timestamptz)
  created_at          timestamptz   NOT NULL DEFAULT now(),
  updated_at          timestamptz   NOT NULL DEFAULT now()
);

-- ── Indexes ──────────────────────────────────────────────────
-- Primary lookup: org + number + time (conversation thread)
CREATE INDEX IF NOT EXISTS idx_wa_logs_org_number
  ON wa_logs (organization_id, wa_number, created_at DESC);

-- User timeline
CREATE INDEX IF NOT EXISTS idx_wa_logs_user_id
  ON wa_logs (user_id, created_at DESC)
  WHERE user_id IS NOT NULL;

-- Direction filter (dashboard incoming vs outgoing split)
CREATE INDEX IF NOT EXISTS idx_wa_logs_direction
  ON wa_logs (organization_id, direction, created_at DESC);

-- Status filter (find failed messages quickly)
CREATE INDEX IF NOT EXISTS idx_wa_logs_status
  ON wa_logs (organization_id, delivery_status, created_at DESC);

-- meta_message_id already has UNIQUE index (used for upsert / status updates)

-- ── Updated-at trigger ───────────────────────────────────────
CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_wa_logs_updated_at ON wa_logs;
CREATE TRIGGER trg_wa_logs_updated_at
  BEFORE UPDATE ON wa_logs
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ── Row-Level Security ───────────────────────────────────────
ALTER TABLE wa_logs ENABLE ROW LEVEL SECURITY;

-- Service role bypasses RLS (used by server-side admin client)
-- Dashboard users (admin / hr) may read their own org's logs
CREATE POLICY "org members read wa_logs"
  ON wa_logs FOR SELECT
  USING (
    organization_id = (
      SELECT organization_id FROM users WHERE id = auth.uid()
    )
    AND EXISTS (
      SELECT 1 FROM users
      WHERE id = auth.uid()
        AND role IN ('super_admin', 'admin', 'hr')
        AND is_active = true
    )
  );

-- ── Helpful view: wa_log_summary ─────────────────────────────
-- Shows the latest message per (org, wa_number) pair — good for
-- a "conversations list" without a separate conversations table.
CREATE OR REPLACE VIEW wa_log_summary AS
SELECT DISTINCT ON (organization_id, wa_number)
  id,
  organization_id,
  user_id,
  wa_number,
  contact_name,
  direction,
  message_type,
  message_text,
  delivery_status,
  created_at  AS last_message_at,
  wa_timestamp
FROM wa_logs
ORDER BY organization_id, wa_number, created_at DESC;

-- ── Function: wa_conversation_stats ──────────────────────────
-- Returns per-org stats used by the dashboard KPI card.
CREATE OR REPLACE FUNCTION wa_conversation_stats(p_org_id uuid)
RETURNS TABLE (
  total_messages     bigint,
  incoming_count     bigint,
  outgoing_count     bigint,
  unique_numbers     bigint,
  failed_count       bigint,
  today_messages     bigint
)
LANGUAGE sql STABLE AS $$
  SELECT
    COUNT(*)                                            AS total_messages,
    COUNT(*) FILTER (WHERE direction = 'incoming')      AS incoming_count,
    COUNT(*) FILTER (WHERE direction = 'outgoing')      AS outgoing_count,
    COUNT(DISTINCT wa_number)                           AS unique_numbers,
    COUNT(*) FILTER (WHERE delivery_status = 'failed')  AS failed_count,
    COUNT(*) FILTER (WHERE created_at >= current_date)  AS today_messages
  FROM wa_logs
  WHERE organization_id = p_org_id;
$$;
