-- Leave policy configuration: per-role, per-work-mode default entitlement,
-- plus a work_mode attribute on employees so those defaults can apply.
--
-- Run this once in the Supabase Dashboard → SQL Editor. Safe to re-run
-- (IF NOT EXISTS / OR REPLACE throughout).

-- ── Employee work mode (WFH / WFO) ──────────────────────────────────────────
ALTER TABLE users ADD COLUMN IF NOT EXISTS work_mode TEXT NOT NULL DEFAULT 'wfo'
  CHECK (work_mode IN ('wfo', 'wfh'));

-- ── Per-role, per-work-mode default entitlement ─────────────────────────────
-- One row per (leave_type, role, work_mode) combination an org has chosen to
-- override. Anything not listed here falls back to leave_types.default_days
-- (see init_leave_balances() below), so an org that never touches this table
-- keeps behaving exactly as it does today.
CREATE TABLE IF NOT EXISTS leave_policy_defaults (
  id               UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  organization_id  UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  leave_type_id    UUID NOT NULL REFERENCES leave_types(id) ON DELETE CASCADE,
  role             user_role NOT NULL,
  work_mode        TEXT NOT NULL CHECK (work_mode IN ('wfo', 'wfh')),
  default_days     DECIMAL(5,1) NOT NULL DEFAULT 0 CHECK (default_days >= 0),
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (organization_id, leave_type_id, role, work_mode)
);

CREATE INDEX IF NOT EXISTS idx_leave_policy_defaults_org ON leave_policy_defaults(organization_id);

ALTER TABLE leave_policy_defaults ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "leave_policy_defaults_read" ON leave_policy_defaults;
CREATE POLICY "leave_policy_defaults_read" ON leave_policy_defaults
  FOR SELECT USING (organization_id = auth_org_id());

DROP POLICY IF EXISTS "leave_policy_defaults_hr_manage" ON leave_policy_defaults;
CREATE POLICY "leave_policy_defaults_hr_manage" ON leave_policy_defaults
  FOR ALL USING (organization_id = auth_org_id() AND is_hr_or_above());

-- ── init_leave_balances(): now role + work_mode aware ────────────────────────
-- Looks up a matching leave_policy_defaults row for the employee's actual
-- role/work_mode first; falls back to the leave type's flat default_days
-- when no specific rule has been configured. Safe for existing orgs: with
-- an empty leave_policy_defaults table, every lookup falls through to the
-- same default_days value used before this migration.
CREATE OR REPLACE FUNCTION init_leave_balances(
  p_employee_id uuid,
  p_org_id      uuid,
  p_year        int DEFAULT EXTRACT(YEAR FROM NOW())::int
)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_role      user_role;
  v_work_mode TEXT;
BEGIN
  SELECT role, work_mode INTO v_role, v_work_mode FROM users WHERE id = p_employee_id;

  INSERT INTO leave_balances (employee_id, organization_id, leave_type_id, entitled_days, year)
  SELECT
    p_employee_id,
    p_org_id,
    lt.id,
    COALESCE(
      (SELECT pd.default_days FROM leave_policy_defaults pd
       WHERE pd.organization_id = p_org_id AND pd.leave_type_id = lt.id
         AND pd.role = v_role AND pd.work_mode = v_work_mode),
      lt.default_days
    ),
    p_year
  FROM leave_types lt
  WHERE lt.organization_id = p_org_id
    AND lt.is_active = true
  ON CONFLICT (employee_id, leave_type_id, year) DO NOTHING;
END;
$$;
