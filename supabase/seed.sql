-- ─── Demo Organization ────────────────────────────────────────────────────────
INSERT INTO organizations (id, name, plan, settings) VALUES
  ('00000000-0000-0000-0000-000000000001', 'Demo Company', 'pro', '{"timezone":"Asia/Kolkata","work_hours":{"start":"09:00","end":"18:00"}}');

-- ─── Default Leave Types ──────────────────────────────────────────────────────
INSERT INTO leave_types (organization_id, name, max_days_per_year, carry_forward, requires_approval, color_hex) VALUES
  ('00000000-0000-0000-0000-000000000001', 'Casual Leave',   12, false, true,  '#22c55e'),
  ('00000000-0000-0000-0000-000000000001', 'Sick Leave',     10, false, false, '#ef4444'),
  ('00000000-0000-0000-0000-000000000001', 'Annual Leave',   21, true,  true,  '#3b82f6'),
  ('00000000-0000-0000-0000-000000000001', 'Maternity Leave',180, false, true,  '#ec4899');

-- ─── Default Onboarding Steps ─────────────────────────────────────────────────
INSERT INTO onboarding_steps (organization_id, step_number, step_name, description, step_type) VALUES
  ('00000000-0000-0000-0000-000000000001', 1, 'Personal Information',  'Collect name, DOB, contact details', 'info_collection'),
  ('00000000-0000-0000-0000-000000000001', 2, 'Address Details',       'Permanent and current address',      'info_collection'),
  ('00000000-0000-0000-0000-000000000001', 3, 'Emergency Contact',     'Emergency contact details',          'info_collection'),
  ('00000000-0000-0000-0000-000000000001', 4, 'ID Proof Upload',       'Aadhar, PAN, Passport',              'document_upload'),
  ('00000000-0000-0000-0000-000000000001', 5, 'Address Proof Upload',  'Utility bill or rental agreement',   'document_upload'),
  ('00000000-0000-0000-0000-000000000001', 6, 'Education Certificates','Degree and mark sheets',             'document_upload'),
  ('00000000-0000-0000-0000-000000000001', 7, 'Contract Signing',      'Employment contract acceptance',     'form'),
  ('00000000-0000-0000-0000-000000000001', 8, 'HR Approval',           'Final HR sign-off',                  'approval');
