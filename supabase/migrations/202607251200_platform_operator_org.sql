-- Designates one organization as the platform operator (the vendor running
-- this HRBot deployment for multiple customers) — used to restrict
-- creating new organizations, and editing any existing org's
-- creation-time settings, to admins who belong to that org specifically
-- (not just anyone with an admin/super_admin role, which could otherwise
-- be a customer's own staff).
--
-- Run this once in the Supabase Dashboard → SQL Editor. Safe to re-run
-- (IF NOT EXISTS / idempotent UPDATE throughout).

ALTER TABLE organizations
  ADD COLUMN IF NOT EXISTS is_platform_operator BOOLEAN NOT NULL DEFAULT false;

-- Exactly one org should carry this flag. Adjust the name below if your
-- operator workspace is called something else.
UPDATE organizations
  SET is_platform_operator = true
  WHERE name = 'Handysolver';
