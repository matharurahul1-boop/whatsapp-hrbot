-- push_subscriptions.endpoint had a GLOBAL unique constraint, and
-- /api/push/subscribe upserted on that column alone. A push endpoint is
-- tied to the browser+device+service-worker registration, not to which app
-- user is logged in — so on any shared or reused browser (an office
-- computer, or simply signing out and back in as someone else), the second
-- person's subscribe() call silently reassigned the existing row's user_id
-- to themselves, and the first person's push notifications stopped
-- delivering with no visible error on either side.
--
-- Switching to a composite (user_id, endpoint) unique constraint lets the
-- same physical device hold one subscription row per user who has ever
-- logged in and subscribed there, instead of only the most recent one.
ALTER TABLE push_subscriptions DROP CONSTRAINT IF EXISTS push_subscriptions_endpoint_key;
ALTER TABLE push_subscriptions ADD CONSTRAINT push_subscriptions_user_endpoint_key UNIQUE (user_id, endpoint);
