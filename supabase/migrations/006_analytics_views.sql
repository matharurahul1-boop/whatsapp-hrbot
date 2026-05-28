-- ── MODULE 2: Analytics views, indexes & helper functions ─────────────
-- Run after 005_rls_policies.sql

-- ══════════════════════════════════════════════════════════════════════
-- SECTION 1: Composite indexes for performance
-- ══════════════════════════════════════════════════════════════════════

-- Tasks
CREATE INDEX IF NOT EXISTS idx_tasks_org_status      ON tasks(organization_id, status) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_tasks_org_assignee     ON tasks(organization_id, assignee_id) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_tasks_org_deadline     ON tasks(organization_id, deadline) WHERE deleted_at IS NULL AND deadline IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_tasks_created_by       ON tasks(created_by, organization_id) WHERE deleted_at IS NULL;

-- Leave requests
CREATE INDEX IF NOT EXISTS idx_leave_org_status       ON leave_requests(organization_id, status);
CREATE INDEX IF NOT EXISTS idx_leave_employee_status  ON leave_requests(employee_id, status);
CREATE INDEX IF NOT EXISTS idx_leave_dates            ON leave_requests(organization_id, start_date, end_date);
CREATE INDEX IF NOT EXISTS idx_leave_manager          ON leave_requests(reviewed_by, status);

-- Attendance
CREATE INDEX IF NOT EXISTS idx_att_org_date           ON attendance_records(organization_id, date DESC);
CREATE INDEX IF NOT EXISTS idx_att_employee_date      ON attendance_records(employee_id, date DESC);
CREATE INDEX IF NOT EXISTS idx_att_org_status         ON attendance_records(organization_id, status, date);

-- Messages / conversations
CREATE INDEX IF NOT EXISTS idx_msg_conv_created       ON messages(conversation_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_conv_org_wa            ON conversations(organization_id, wa_number);

-- Notifications
CREATE INDEX IF NOT EXISTS idx_notif_user_read        ON notifications(user_id, is_read, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_notif_org_created      ON notifications(organization_id, created_at DESC);

-- Audit logs
CREATE INDEX IF NOT EXISTS idx_audit_org_table        ON audit_logs(organization_id, table_name, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_actor            ON audit_logs(actor_id, created_at DESC);

-- Users
CREATE INDEX IF NOT EXISTS idx_users_org_role         ON users(organization_id, role) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_users_wa_number        ON users(wa_number, organization_id) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_users_manager          ON users(manager_id, organization_id) WHERE deleted_at IS NULL;

-- ══════════════════════════════════════════════════════════════════════
-- SECTION 2: Analytics views
-- ══════════════════════════════════════════════════════════════════════

-- ── 2a. Daily attendance summary per org ──────────────────────────────
CREATE OR REPLACE VIEW v_daily_attendance AS
SELECT
  organization_id,
  date,
  COUNT(*)                                                           AS total_employees,
  COUNT(*) FILTER (WHERE status = 'present')                        AS present,
  COUNT(*) FILTER (WHERE status = 'absent')                         AS absent,
  COUNT(*) FILTER (WHERE status = 'late')                           AS late,
  COUNT(*) FILTER (WHERE status = 'half_day')                       AS half_day,
  COUNT(*) FILTER (WHERE status = 'on_leave')                       AS on_leave,
  ROUND(
    COUNT(*) FILTER (WHERE status IN ('present','late'))::numeric
    / NULLIF(COUNT(*),0) * 100, 1
  )                                                                  AS attendance_pct,
  ROUND(AVG(total_hours) FILTER (WHERE total_hours IS NOT NULL), 2) AS avg_hours
FROM attendance_records
GROUP BY organization_id, date;

-- ── 2b. Task stats per org ────────────────────────────────────────────
CREATE OR REPLACE VIEW v_task_stats AS
SELECT
  organization_id,
  COUNT(*)                                                    AS total,
  COUNT(*) FILTER (WHERE status = 'todo')                    AS todo,
  COUNT(*) FILTER (WHERE status = 'in_progress')             AS in_progress,
  COUNT(*) FILTER (WHERE status = 'done')                    AS done,
  COUNT(*) FILTER (WHERE status = 'cancelled')               AS cancelled,
  COUNT(*) FILTER (
    WHERE deadline < NOW() AND status NOT IN ('done','cancelled')
  )                                                           AS overdue,
  COUNT(*) FILTER (
    WHERE deadline BETWEEN NOW() AND NOW() + INTERVAL '48 hours'
    AND status NOT IN ('done','cancelled')
  )                                                           AS due_soon,
  ROUND(
    COUNT(*) FILTER (WHERE status = 'done')::numeric
    / NULLIF(COUNT(*) FILTER (WHERE status != 'cancelled'),0) * 100, 1
  )                                                           AS completion_pct
FROM tasks
WHERE deleted_at IS NULL
GROUP BY organization_id;

-- ── 2c. Leave balance summary per employee ───────────────────────────
CREATE OR REPLACE VIEW v_leave_summary AS
SELECT
  lb.employee_id,
  lb.organization_id,
  lt.name                                          AS leave_type,
  lt.color,
  lb.entitled_days,
  lb.used_days,
  lb.remaining_days,
  lb.carried_over,
  lb.year,
  COUNT(lr.id) FILTER (WHERE lr.status = 'pending') AS pending_requests
FROM leave_balances lb
JOIN leave_types lt ON lt.id = lb.leave_type_id
LEFT JOIN leave_requests lr
  ON lr.employee_id = lb.employee_id
  AND lr.leave_type_id = lb.leave_type_id
  AND EXTRACT(YEAR FROM lr.start_date) = lb.year
GROUP BY lb.employee_id, lb.organization_id, lt.name, lt.color,
         lb.entitled_days, lb.used_days, lb.remaining_days,
         lb.carried_over, lb.year;

-- ── 2d. Employee directory view ───────────────────────────────────────
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

-- ── 2e. Pending approvals view (for managers/HR) ──────────────────────
CREATE OR REPLACE VIEW v_pending_approvals AS
SELECT
  lr.id,
  lr.organization_id,
  lr.employee_id,
  u.full_name                                      AS employee_name,
  u.department,
  u.manager_id,
  lt.name                                          AS leave_type,
  lt.color,
  lr.start_date,
  lr.end_date,
  lr.duration_days,
  lr.reason,
  lr.status,
  lr.created_at,
  CURRENT_DATE - lr.created_at::date               AS days_waiting
FROM leave_requests lr
JOIN users u ON u.id = lr.employee_id
JOIN leave_types lt ON lt.id = lr.leave_type_id
WHERE lr.status = 'pending'
ORDER BY lr.created_at;

-- ── 2f. Org-level KPI snapshot (used by dashboard API) ───────────────
CREATE OR REPLACE VIEW v_org_kpis AS
SELECT
  o.id                                                         AS org_id,
  o.name                                                       AS org_name,
  -- Employee counts
  COUNT(DISTINCT u.id) FILTER (WHERE u.is_active)             AS active_employees,
  COUNT(DISTINCT u.id) FILTER (
    WHERE u.is_active AND u.joined_at >= DATE_TRUNC('month', NOW())
  )                                                            AS new_this_month,
  -- Today attendance
  COUNT(DISTINCT att.employee_id) FILTER (
    WHERE att.date = CURRENT_DATE AND att.status IN ('present','late')
  )                                                            AS present_today,
  COUNT(DISTINCT att.employee_id) FILTER (
    WHERE att.date = CURRENT_DATE AND att.status = 'on_leave'
  )                                                            AS on_leave_today,
  -- Tasks
  COUNT(DISTINCT t.id) FILTER (
    WHERE t.status NOT IN ('done','cancelled') AND t.deleted_at IS NULL
  )                                                            AS open_tasks,
  COUNT(DISTINCT t.id) FILTER (
    WHERE t.deadline < NOW()
    AND t.status NOT IN ('done','cancelled') AND t.deleted_at IS NULL
  )                                                            AS overdue_tasks,
  -- Pending leave approvals
  COUNT(DISTINCT lr.id) FILTER (WHERE lr.status = 'pending') AS pending_leave_requests,
  -- Onboarding
  COUNT(DISTINCT os.id) FILTER (
    WHERE os.status = 'in_progress'
  )                                                            AS active_onboardings
FROM organizations o
LEFT JOIN users u            ON u.organization_id = o.id AND u.deleted_at IS NULL
LEFT JOIN attendance_records att ON att.organization_id = o.id
LEFT JOIN tasks t            ON t.organization_id = o.id
LEFT JOIN leave_requests lr  ON lr.organization_id = o.id
LEFT JOIN onboarding_sessions os ON os.organization_id = o.id
GROUP BY o.id, o.name;

-- ══════════════════════════════════════════════════════════════════════
-- SECTION 3: Helper functions
-- ══════════════════════════════════════════════════════════════════════

-- ── 3a. Get org KPIs in one call ──────────────────────────────────────
CREATE OR REPLACE FUNCTION get_org_kpis(p_org_id uuid)
RETURNS TABLE (
  active_employees      bigint,
  new_this_month        bigint,
  present_today         bigint,
  on_leave_today        bigint,
  open_tasks            bigint,
  overdue_tasks         bigint,
  pending_leave_requests bigint,
  active_onboardings    bigint,
  attendance_pct_today  numeric
) LANGUAGE sql STABLE SECURITY DEFINER AS $$
  SELECT
    active_employees,
    new_this_month,
    present_today,
    on_leave_today,
    open_tasks,
    overdue_tasks,
    pending_leave_requests,
    active_onboardings,
    ROUND(
      present_today::numeric / NULLIF(active_employees, 0) * 100, 1
    ) AS attendance_pct_today
  FROM v_org_kpis
  WHERE org_id = p_org_id;
$$;

-- ── 3b. Attendance heatmap (last N days) ─────────────────────────────
CREATE OR REPLACE FUNCTION get_attendance_heatmap(
  p_org_id  uuid,
  p_days    int DEFAULT 30
)
RETURNS TABLE (
  date            date,
  present         bigint,
  absent          bigint,
  late            bigint,
  on_leave        bigint,
  attendance_pct  numeric
) LANGUAGE sql STABLE SECURITY DEFINER AS $$
  SELECT
    date,
    COUNT(*) FILTER (WHERE status IN ('present','late')) AS present,
    COUNT(*) FILTER (WHERE status = 'absent')            AS absent,
    COUNT(*) FILTER (WHERE status = 'late')              AS late,
    COUNT(*) FILTER (WHERE status = 'on_leave')          AS on_leave,
    ROUND(
      COUNT(*) FILTER (WHERE status IN ('present','late'))::numeric
      / NULLIF(COUNT(*), 0) * 100, 1
    )                                                    AS attendance_pct
  FROM attendance_records
  WHERE organization_id = p_org_id
    AND date >= CURRENT_DATE - p_days
  GROUP BY date
  ORDER BY date;
$$;

-- ── 3c. Task completion trend (last 4 weeks) ─────────────────────────
CREATE OR REPLACE FUNCTION get_task_trend(p_org_id uuid)
RETURNS TABLE (
  week_start  date,
  created     bigint,
  completed   bigint
) LANGUAGE sql STABLE SECURITY DEFINER AS $$
  SELECT
    DATE_TRUNC('week', created_at)::date  AS week_start,
    COUNT(*)                              AS created,
    COUNT(*) FILTER (WHERE status = 'done') AS completed
  FROM tasks
  WHERE organization_id = p_org_id
    AND deleted_at IS NULL
    AND created_at >= NOW() - INTERVAL '4 weeks'
  GROUP BY 1
  ORDER BY 1;
$$;

-- ── 3d. Mark notifications read ──────────────────────────────────────
CREATE OR REPLACE FUNCTION mark_notifications_read(
  p_user_id uuid,
  p_ids     uuid[] DEFAULT NULL
)
RETURNS void LANGUAGE sql SECURITY DEFINER AS $$
  UPDATE notifications
  SET is_read = true, read_at = NOW()
  WHERE user_id = p_user_id
    AND is_read = false
    AND (p_ids IS NULL OR id = ANY(p_ids));
$$;

-- ── 3e. Bulk-create leave balances for a new employee ─────────────────
CREATE OR REPLACE FUNCTION init_leave_balances(
  p_employee_id uuid,
  p_org_id      uuid,
  p_year        int DEFAULT EXTRACT(YEAR FROM NOW())::int
)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  INSERT INTO leave_balances (employee_id, organization_id, leave_type_id, entitled_days, year)
  SELECT
    p_employee_id,
    p_org_id,
    id,
    default_days,
    p_year
  FROM leave_types
  WHERE organization_id = p_org_id
    AND is_active = true
  ON CONFLICT (employee_id, leave_type_id, year) DO NOTHING;
END;
$$;

-- ── 3f. Auto-init balances when user is created ───────────────────────
CREATE OR REPLACE FUNCTION trg_init_leave_balances()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  PERFORM init_leave_balances(NEW.id, NEW.organization_id);
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_user_created_init_leave ON users;
CREATE TRIGGER on_user_created_init_leave
  AFTER INSERT ON users
  FOR EACH ROW
  EXECUTE FUNCTION trg_init_leave_balances();

-- ── 3g. Deduct leave balance on approval ─────────────────────────────
CREATE OR REPLACE FUNCTION trg_update_leave_balance()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  -- Approved: deduct
  IF NEW.status = 'approved' AND OLD.status != 'approved' THEN
    UPDATE leave_balances
    SET used_days = used_days + NEW.duration_days
    WHERE employee_id = NEW.employee_id
      AND leave_type_id = NEW.leave_type_id
      AND year = EXTRACT(YEAR FROM NEW.start_date)::int;
  END IF;

  -- Cancelled/rejected after approval: refund
  IF OLD.status = 'approved' AND NEW.status IN ('cancelled','rejected') THEN
    UPDATE leave_balances
    SET used_days = GREATEST(0, used_days - NEW.duration_days)
    WHERE employee_id = NEW.employee_id
      AND leave_type_id = NEW.leave_type_id
      AND year = EXTRACT(YEAR FROM NEW.start_date)::int;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_leave_status_change ON leave_requests;
CREATE TRIGGER on_leave_status_change
  AFTER UPDATE OF status ON leave_requests
  FOR EACH ROW
  EXECUTE FUNCTION trg_update_leave_balance();

-- ── 3h. Notification insert helper ───────────────────────────────────
CREATE OR REPLACE FUNCTION create_notification(
  p_org_id    uuid,
  p_user_id   uuid,
  p_type      text,
  p_title     text,
  p_body      text,
  p_action_url text DEFAULT NULL,
  p_meta      jsonb DEFAULT '{}'::jsonb
)
RETURNS uuid LANGUAGE sql SECURITY DEFINER AS $$
  INSERT INTO notifications
    (organization_id, user_id, type, title, body, action_url, meta)
  VALUES
    (p_org_id, p_user_id, p_type, p_title, p_body, p_action_url, p_meta)
  RETURNING id;
$$;
