CREATE TABLE push_subscriptions (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  endpoint      TEXT NOT NULL UNIQUE,
  p256dh        TEXT NOT NULL,
  auth          TEXT NOT NULL,
  user_agent    TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_push_subscriptions_user_id ON push_subscriptions(user_id);

ALTER TABLE push_subscriptions ENABLE ROW LEVEL SECURITY;

-- Only the service role (used by API routes) reads/writes this table directly.
CREATE POLICY push_subscriptions_service_only ON push_subscriptions
  FOR ALL USING (false);
