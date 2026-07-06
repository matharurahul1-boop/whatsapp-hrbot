-- Service-only tenant secrets. Never expose provider credentials through a table
-- readable by authenticated browser clients.
CREATE TABLE IF NOT EXISTS organization_secrets (
  organization_id uuid PRIMARY KEY REFERENCES organizations(id) ON DELETE CASCADE,
  wa_access_token text,
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE organization_secrets ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON organization_secrets FROM anon, authenticated, PUBLIC;

INSERT INTO organization_secrets (organization_id, wa_access_token)
SELECT id, wa_access_token FROM organizations WHERE wa_access_token IS NOT NULL
ON CONFLICT (organization_id) DO UPDATE
SET wa_access_token = EXCLUDED.wa_access_token, updated_at = now();

UPDATE organizations SET wa_access_token = NULL WHERE wa_access_token IS NOT NULL;

-- Browser clients are read-only for business records. All writes pass through
-- authenticated server routes where field-level and team-level RBAC is enforced.
REVOKE INSERT, UPDATE, DELETE ON tasks, leave_requests, attendance_records FROM anon, authenticated;

-- Views must obey the caller's underlying RLS policies on PostgreSQL 15+.
ALTER VIEW IF EXISTS v_daily_attendance SET (security_invoker = true);
ALTER VIEW IF EXISTS v_task_stats SET (security_invoker = true);
ALTER VIEW IF EXISTS v_leave_summary SET (security_invoker = true);
ALTER VIEW IF EXISTS v_employee_directory SET (security_invoker = true);
ALTER VIEW IF EXISTS v_pending_approvals SET (security_invoker = true);
ALTER VIEW IF EXISTS v_org_kpis SET (security_invoker = true);
ALTER VIEW IF EXISTS wa_log_summary SET (security_invoker = true);

-- Remove the overly broad policy that allowed every organization member to
-- mutate every task through the Data API.
DROP POLICY IF EXISTS tasks_org_isolation ON tasks;
DROP POLICY IF EXISTS tasks_employee_own ON tasks;
DROP POLICY IF EXISTS tasks_manager_team ON tasks;

CREATE POLICY tasks_scoped_read ON tasks FOR SELECT TO authenticated
USING (
  organization_id = auth_org_id()
  AND deleted_at IS NULL
  AND (
    assignee_id = auth.uid()
    OR created_by = auth.uid()
    OR is_hr_or_above()
    OR (
      auth_role() = 'manager'
      AND assignee_id IN (SELECT id FROM users WHERE manager_id = auth.uid() AND organization_id = auth_org_id())
    )
  )
);

DROP POLICY IF EXISTS leave_own_read ON leave_requests;
DROP POLICY IF EXISTS leave_manager_team ON leave_requests;
DROP POLICY IF EXISTS leave_employee_create ON leave_requests;

CREATE POLICY leave_scoped_read ON leave_requests FOR SELECT TO authenticated
USING (
  organization_id = auth_org_id()
  AND (
    employee_id = auth.uid()
    OR is_hr_or_above()
    OR (
      auth_role() = 'manager'
      AND employee_id IN (SELECT id FROM users WHERE manager_id = auth.uid() AND organization_id = auth_org_id())
    )
  )
);

-- SECURITY DEFINER helpers used by RLS are callable only by authenticated users.
REVOKE EXECUTE ON FUNCTION auth_org_id() FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION auth_role() FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION is_admin_or_above() FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION is_hr_or_above() FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION is_manager_or_above() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION auth_org_id(), auth_role(), is_admin_or_above(), is_hr_or_above(), is_manager_or_above() TO authenticated;

CREATE TABLE IF NOT EXISTS api_rate_limits (
  key text PRIMARY KEY,
  window_start timestamptz NOT NULL,
  request_count integer NOT NULL DEFAULT 0
);
ALTER TABLE api_rate_limits ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON api_rate_limits FROM anon, authenticated, PUBLIC;

CREATE OR REPLACE FUNCTION check_rate_limit(p_key text, p_limit integer, p_window_seconds integer)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE allowed boolean;
BEGIN
  INSERT INTO api_rate_limits AS r(key, window_start, request_count)
  VALUES (p_key, now(), 1)
  ON CONFLICT (key) DO UPDATE SET
    window_start = CASE WHEN r.window_start <= now() - make_interval(secs => p_window_seconds) THEN now() ELSE r.window_start END,
    request_count = CASE WHEN r.window_start <= now() - make_interval(secs => p_window_seconds) THEN 1 ELSE r.request_count + 1 END
  RETURNING request_count <= p_limit INTO allowed;
  RETURN allowed;
END $$;
REVOKE EXECUTE ON FUNCTION check_rate_limit(text, integer, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION check_rate_limit(text, integer, integer) TO service_role;
