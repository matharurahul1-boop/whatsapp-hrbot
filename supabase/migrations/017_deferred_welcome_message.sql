-- Defers the WhatsApp welcome/credentials message until an admin marks
-- onboarding_status = 'completed', instead of sending it immediately at
-- account creation. Holds the admin-set initial password only until the
-- deferred message is actually sent, then the app clears it — same trust
-- boundary as organization_secrets, never exposed to browser clients.
ALTER TABLE users ADD COLUMN IF NOT EXISTS pending_welcome_password TEXT;

-- Expose onboarding_status through the directory view so the Team page can
-- display and edit it (the view previously omitted it entirely). Does NOT
-- select pending_welcome_password — that stays server-only.
CREATE OR REPLACE VIEW v_employee_directory AS
SELECT
  u.id,
  u.organization_id,
  u.full_name,
  u.email,
  u.wa_number,
  u.role,
  u.department,
  u.designation,
  u.employee_id,
  u.avatar_url,
  u.is_active,
  u.joined_at,
  u.onboarding_status,
  m.full_name                                      AS manager_name,
  m.email                                          AS manager_email,
  -- today's attendance
  att.status                                        AS today_status,
  att.check_in_time,
  att.check_out_time,
  att.total_hours
FROM users u
LEFT JOIN users m ON m.id = u.manager_id
LEFT JOIN attendance_records att
  ON att.employee_id = u.id
  AND att.date = CURRENT_DATE
WHERE u.deleted_at IS NULL;

ALTER VIEW v_employee_directory SET (security_invoker = true);
