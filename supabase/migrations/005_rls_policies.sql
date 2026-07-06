-- ─── Enable RLS on all tables ─────────────────────────────────────────────────
ALTER TABLE organizations        ENABLE ROW LEVEL SECURITY;
ALTER TABLE users                ENABLE ROW LEVEL SECURITY;
ALTER TABLE conversations        ENABLE ROW LEVEL SECURITY;
ALTER TABLE messages             ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit_logs           ENABLE ROW LEVEL SECURITY;
ALTER TABLE notifications        ENABLE ROW LEVEL SECURITY;
ALTER TABLE n8n_workflow_logs    ENABLE ROW LEVEL SECURITY;
ALTER TABLE tasks                ENABLE ROW LEVEL SECURITY;
ALTER TABLE task_comments        ENABLE ROW LEVEL SECURITY;
ALTER TABLE task_attachments     ENABLE ROW LEVEL SECURITY;
ALTER TABLE onboarding_sessions  ENABLE ROW LEVEL SECURITY;
ALTER TABLE onboarding_documents ENABLE ROW LEVEL SECURITY;
ALTER TABLE onboarding_steps     ENABLE ROW LEVEL SECURITY;
ALTER TABLE leave_types          ENABLE ROW LEVEL SECURITY;
ALTER TABLE leave_balances       ENABLE ROW LEVEL SECURITY;
ALTER TABLE leave_requests       ENABLE ROW LEVEL SECURITY;
ALTER TABLE attendance_records   ENABLE ROW LEVEL SECURITY;

-- ─── Helper: get current user's org & role ────────────────────────────────────
CREATE OR REPLACE FUNCTION auth_org_id() RETURNS UUID AS $$
  SELECT organization_id FROM users WHERE id = auth.uid()
$$ LANGUAGE sql SECURITY DEFINER STABLE;

CREATE OR REPLACE FUNCTION auth_role() RETURNS user_role AS $$
  SELECT role FROM users WHERE id = auth.uid()
$$ LANGUAGE sql SECURITY DEFINER STABLE;

CREATE OR REPLACE FUNCTION is_admin_or_above() RETURNS BOOLEAN AS $$
  SELECT auth_role() IN ('admin', 'super_admin')
$$ LANGUAGE sql SECURITY DEFINER STABLE;

CREATE OR REPLACE FUNCTION is_hr_or_above() RETURNS BOOLEAN AS $$
  SELECT auth_role() IN ('hr', 'admin', 'super_admin')
$$ LANGUAGE sql SECURITY DEFINER STABLE;

CREATE OR REPLACE FUNCTION is_manager_or_above() RETURNS BOOLEAN AS $$
  SELECT auth_role() IN ('manager', 'hr', 'admin', 'super_admin')
$$ LANGUAGE sql SECURITY DEFINER STABLE;

-- ─── Organizations ────────────────────────────────────────────────────────────
CREATE POLICY "org_members_read" ON organizations
  FOR SELECT USING (id = auth_org_id());

CREATE POLICY "org_admins_update" ON organizations
  FOR UPDATE USING (id = auth_org_id() AND is_admin_or_above());

-- ─── Users ────────────────────────────────────────────────────────────────────
CREATE POLICY "users_org_read" ON users
  FOR SELECT USING (organization_id = auth_org_id() AND deleted_at IS NULL);

CREATE POLICY "users_self_update" ON users
  FOR UPDATE USING (id = auth.uid());

CREATE POLICY "users_admin_manage" ON users
  FOR ALL USING (organization_id = auth_org_id() AND is_admin_or_above());

-- ─── Tasks ────────────────────────────────────────────────────────────────────
CREATE POLICY "tasks_employee_own" ON tasks
  FOR ALL USING (
    organization_id = auth_org_id() AND
    (assignee_id = auth.uid() OR created_by = auth.uid()) AND deleted_at IS NULL
  ) WITH CHECK (organization_id = auth_org_id());

CREATE POLICY "tasks_manager_team" ON tasks
  FOR ALL USING (
    organization_id = auth_org_id() AND
    is_manager_or_above() AND deleted_at IS NULL
  ) WITH CHECK (organization_id = auth_org_id());

-- ─── Leave Requests ───────────────────────────────────────────────────────────
CREATE POLICY "leave_own_read" ON leave_requests
  FOR SELECT USING (
    organization_id = auth_org_id() AND employee_id = auth.uid()
  );

CREATE POLICY "leave_manager_team" ON leave_requests
  FOR ALL USING (
    organization_id = auth_org_id() AND is_manager_or_above()
  );

CREATE POLICY "leave_employee_create" ON leave_requests
  FOR INSERT WITH CHECK (
    organization_id = auth_org_id() AND employee_id = auth.uid()
  );

-- ─── Attendance ───────────────────────────────────────────────────────────────
CREATE POLICY "attendance_own_read" ON attendance_records
  FOR SELECT USING (
    organization_id = auth_org_id() AND employee_id = auth.uid()
  );

CREATE POLICY "attendance_manager_read" ON attendance_records
  FOR SELECT USING (
    organization_id = auth_org_id() AND is_manager_or_above()
  );

CREATE POLICY "attendance_employee_checkin" ON attendance_records
  FOR INSERT WITH CHECK (
    organization_id = auth_org_id() AND employee_id = auth.uid()
  );

-- ─── Notifications ────────────────────────────────────────────────────────────
CREATE POLICY "notifications_own" ON notifications
  FOR ALL USING (
    organization_id = auth_org_id() AND user_id = auth.uid()
  );

-- ─── Onboarding ───────────────────────────────────────────────────────────────
CREATE POLICY "onboarding_hr_manage" ON onboarding_sessions
  FOR ALL USING (organization_id = auth_org_id() AND is_hr_or_above());

CREATE POLICY "onboarding_own_read" ON onboarding_sessions
  FOR SELECT USING (organization_id = auth_org_id() AND user_id = auth.uid());

-- ─── Conversations (admin/hr read-only) ───────────────────────────────────────
CREATE POLICY "conversations_admin_read" ON conversations
  FOR SELECT USING (organization_id = auth_org_id() AND is_admin_or_above());

CREATE POLICY "conversations_own_read" ON conversations
  FOR SELECT USING (organization_id = auth_org_id() AND user_id = auth.uid());

-- ─── Audit Logs (read-only for admins) ───────────────────────────────────────
CREATE POLICY "audit_admin_read" ON audit_logs
  FOR SELECT USING (organization_id = auth_org_id() AND is_admin_or_above());

-- ─── n8n logs (admin only) ────────────────────────────────────────────────────
CREATE POLICY "n8n_logs_admin" ON n8n_workflow_logs
  FOR ALL USING (organization_id = auth_org_id() AND is_admin_or_above());
