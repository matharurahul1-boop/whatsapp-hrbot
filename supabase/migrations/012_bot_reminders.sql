-- Migration: bot_reminders — stores all scheduled WhatsApp reminders
-- Replaces the n8n "Wait Until" approach (which caused OOM on Render free tier).
-- A 5-minute n8n cron polls this table and fires due reminders.

CREATE TABLE IF NOT EXISTS bot_reminders (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id   uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  fire_at           timestamptz NOT NULL,
  type              text NOT NULL DEFAULT 'custom' CHECK (type IN ('task', 'custom')),

  -- Task deadline reminders (type = 'task')
  task_id           uuid REFERENCES tasks(id) ON DELETE CASCADE,
  task_reminder     text,          -- '1_hour' | '2_hours' | '4_hours' | '1_day'
  scheduled_deadline date,
  scheduled_due_time text,

  -- Custom chat-set reminders (type = 'custom')
  user_id           uuid REFERENCES users(id) ON DELETE CASCADE,
  wa_number         text,
  custom_message    text,

  sent              boolean NOT NULL DEFAULT false,
  sent_at           timestamptz,
  created_at        timestamptz NOT NULL DEFAULT now()
);

-- Efficient poll: only unsent, ordered by fire time
CREATE INDEX IF NOT EXISTS idx_bot_reminders_fire_at
  ON bot_reminders (fire_at)
  WHERE NOT sent;

-- Clean up sent reminders older than 30 days automatically
CREATE INDEX IF NOT EXISTS idx_bot_reminders_cleanup
  ON bot_reminders (sent_at)
  WHERE sent = true;
