-- Org-level attendance policy: working days, shift timing, grace period,
-- half-day rules, capture method, WFH, overtime, regularization, holidays,
-- and escalation preferences — one row per org, configured via the Settings
-- "Attendance Policy" wizard.
--
-- Run this once in the Supabase Dashboard → SQL Editor. Safe to re-run
-- (IF NOT EXISTS / OR REPLACE throughout).
--
-- Orgs that never open the wizard get no row here — attendance code must
-- treat a missing row the same as today's unconditional "present" behavior,
-- not as an error.

CREATE TABLE IF NOT EXISTS attendance_policies (
  id                            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  organization_id               UUID NOT NULL UNIQUE REFERENCES organizations(id) ON DELETE CASCADE,

  -- Stage 1: Work structure basics
  working_days_type             TEXT NOT NULL DEFAULT '5'
                                   CHECK (working_days_type IN ('5', '5.5', '6', 'rotational')),
  weekly_offs                   TEXT[] NOT NULL DEFAULT ARRAY['sat', 'sun'],
  shift_type                    TEXT NOT NULL DEFAULT 'single'
                                   CHECK (shift_type IN ('single', 'multiple_fixed', 'rotational')),
  -- [{ name, start: "HH:MM", end: "HH:MM" }, ...] — one entry for 'single' shift too,
  -- so downstream code always reads shifts[0] rather than branching on shift_type.
  shifts                        JSONB NOT NULL DEFAULT '[{"name":"General","start":"09:00","end":"18:00"}]',
  shift_assignment_method       TEXT CHECK (shift_assignment_method IN ('manager_assigned', 'self_select', 'roster_based')),

  -- Stage 2: Shift timing rules
  is_flexible_hours             BOOLEAN NOT NULL DEFAULT false,
  flexible_window_start         TIME,
  flexible_window_end           TIME,
  full_day_hours                DECIMAL(4,2) NOT NULL DEFAULT 9.0,

  -- Stage 3: Late coming & grace period
  grace_period_enabled          BOOLEAN NOT NULL DEFAULT true,
  grace_minutes                 INTEGER NOT NULL DEFAULT 15 CHECK (grace_minutes >= 0),
  late_allowed_per_month        INTEGER NOT NULL DEFAULT 3 CHECK (late_allowed_per_month >= 0),
  late_violation_action         TEXT NOT NULL DEFAULT 'flag'
                                   CHECK (late_violation_action IN ('half_day', 'lop', 'flag', 'manager_discretion')),

  -- Stage 4: Half-day & early leaving
  half_day_threshold_hours      DECIMAL(4,2) NOT NULL DEFAULT 4.5,
  early_leave_tracked_separately BOOLEAN NOT NULL DEFAULT false,
  early_leave_threshold_minutes INTEGER,

  -- Stage 5: Attendance capture method
  capture_methods                TEXT[] NOT NULL DEFAULT ARRAY['web'],
  geo_fence_locations            JSONB NOT NULL DEFAULT '[]', -- [{ name, lat, lng, radius_m }, ...]
  has_field_employees            BOOLEAN NOT NULL DEFAULT false,
  wfh_enabled                    BOOLEAN NOT NULL DEFAULT false,
  wfh_requires_approval          BOOLEAN NOT NULL DEFAULT true,
  wfh_counts_as_attendance       BOOLEAN NOT NULL DEFAULT true,

  -- Stage 6: Overtime
  overtime_enabled               BOOLEAN NOT NULL DEFAULT false,
  overtime_threshold_hours       DECIMAL(4,2),
  overtime_requires_preapproval  BOOLEAN NOT NULL DEFAULT true,

  -- Stage 7: Regularization
  regularization_enabled         BOOLEAN NOT NULL DEFAULT true,
  regularization_monthly_limit   INTEGER NOT NULL DEFAULT 2 CHECK (regularization_monthly_limit >= 0),
  regularization_approver_role   TEXT NOT NULL DEFAULT 'manager',

  -- Stage 8: Holidays & leave interplay
  holidays                       JSONB NOT NULL DEFAULT '[]', -- [{ date: "YYYY-MM-DD", name }, ...]
  auto_sync_leave_attendance     BOOLEAN NOT NULL DEFAULT true,

  -- Stage 9: Escalation & visibility
  escalation_notify              TEXT NOT NULL DEFAULT 'manager'
                                    CHECK (escalation_notify IN ('manager', 'hr', 'both')),
  escalation_frequency           TEXT NOT NULL DEFAULT 'weekly'
                                    CHECK (escalation_frequency IN ('realtime', 'weekly', 'monthly')),
  employee_dashboard_visible     BOOLEAN NOT NULL DEFAULT true,

  -- Wizard bookkeeping
  summary_text                   TEXT,
  is_configured                  BOOLEAN NOT NULL DEFAULT false,
  configured_by                  UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at                     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at                     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_attendance_policies_org ON attendance_policies(organization_id);

ALTER TABLE attendance_policies ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "attendance_policies_read" ON attendance_policies;
CREATE POLICY "attendance_policies_read" ON attendance_policies
  FOR SELECT USING (organization_id = auth_org_id());

DROP POLICY IF EXISTS "attendance_policies_admin_manage" ON attendance_policies;
CREATE POLICY "attendance_policies_admin_manage" ON attendance_policies
  FOR ALL USING (organization_id = auth_org_id() AND is_admin_or_above());

DROP TRIGGER IF EXISTS trg_attendance_policies_updated_at ON attendance_policies;
CREATE TRIGGER trg_attendance_policies_updated_at
  BEFORE UPDATE ON attendance_policies
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();
