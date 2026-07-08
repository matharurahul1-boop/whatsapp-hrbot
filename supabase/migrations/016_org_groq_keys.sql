-- Lets an admin rotate Groq API keys from the Settings page instead of
-- redeploying with new env vars. Stored alongside wa_access_token in the
-- service-only secrets table — never exposed to browser clients via RLS.
ALTER TABLE organization_secrets ADD COLUMN IF NOT EXISTS groq_api_keys TEXT;
