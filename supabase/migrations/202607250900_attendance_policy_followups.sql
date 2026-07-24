-- Two follow-up questions from the original Attendance Policy wizard spec
-- that were missing their conditional sub-question:
--   Stage 5: "if field employees exist, ask if they need a separate policy"
--   Stage 9: "employees see their own dashboard — yes/no, and what level of detail"
--
-- Run this once in the Supabase Dashboard → SQL Editor. Safe to re-run
-- (IF NOT EXISTS throughout).

ALTER TABLE attendance_policies
  ADD COLUMN IF NOT EXISTS field_employees_separate_policy BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE attendance_policies
  ADD COLUMN IF NOT EXISTS employee_dashboard_detail TEXT NOT NULL DEFAULT 'summary'
    CHECK (employee_dashboard_detail IN ('summary', 'detailed'));
