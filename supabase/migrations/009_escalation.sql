-- Auto-escalation tracking columns on leave_requests
-- Tracks when 24h (manager), 48h (admin), and 72h (employee) WhatsApp reminders were sent

ALTER TABLE leave_requests
  ADD COLUMN IF NOT EXISTS escalated_manager_at  TIMESTAMPTZ,   -- 24h: WA sent to manager
  ADD COLUMN IF NOT EXISTS escalated_admin_at    TIMESTAMPTZ,   -- 48h: WA sent to admin
  ADD COLUMN IF NOT EXISTS escalated_employee_at TIMESTAMPTZ;   -- 72h: WA sent back to employee

CREATE INDEX IF NOT EXISTS idx_leave_escalation
  ON leave_requests (organization_id, status, created_at)
  WHERE status = 'pending'; 