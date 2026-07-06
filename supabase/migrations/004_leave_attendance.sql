-- ─── Enums ────────────────────────────────────────────────────────────────────
CREATE TYPE leave_request_status AS ENUM ('pending', 'approved', 'rejected', 'cancelled');
CREATE TYPE attendance_status    AS ENUM ('present', 'absent', 'half_day', 'late', 'on_leave');

-- ─── Leave Types (per org) ────────────────────────────────────────────────────
CREATE TABLE leave_types (
  id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  organization_id     UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name                TEXT NOT NULL,
  max_days_per_year   INTEGER NOT NULL DEFAULT 12,
  carry_forward       BOOLEAN NOT NULL DEFAULT false,
  requires_approval   BOOLEAN NOT NULL DEFAULT true,
  color_hex           TEXT NOT NULL DEFAULT '#22c55e',
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_leave_types_org ON leave_types(organization_id);

-- ─── Leave Balances ───────────────────────────────────────────────────────────
CREATE TABLE leave_balances (
  id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  employee_id         UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  leave_type_id       UUID NOT NULL REFERENCES leave_types(id) ON DELETE CASCADE,
  year                INTEGER NOT NULL,
  total_days          DECIMAL(5,1) NOT NULL DEFAULT 0,
  used_days           DECIMAL(5,1) NOT NULL DEFAULT 0,
  UNIQUE (employee_id, leave_type_id, year),
  CONSTRAINT positive_used CHECK (used_days >= 0),
  CONSTRAINT used_lte_total CHECK (used_days <= total_days)
);

CREATE INDEX idx_leave_balances_employee ON leave_balances(employee_id, year);

-- Computed column: remaining days
ALTER TABLE leave_balances
  ADD COLUMN remaining_days DECIMAL(5,1)
  GENERATED ALWAYS AS (total_days - used_days) STORED;

-- ─── Leave Requests ───────────────────────────────────────────────────────────
CREATE TABLE leave_requests (
  id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  organization_id     UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  employee_id         UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  leave_type_id       UUID NOT NULL REFERENCES leave_types(id) ON DELETE RESTRICT,
  start_date          DATE NOT NULL,
  end_date            DATE NOT NULL,
  total_days          DECIMAL(5,1) NOT NULL,
  reason              TEXT,
  status              leave_request_status NOT NULL DEFAULT 'pending',
  approved_by         UUID REFERENCES users(id) ON DELETE SET NULL,
  approved_at         TIMESTAMPTZ,
  rejection_reason    TEXT,
  source              message_source NOT NULL DEFAULT 'dashboard',
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT valid_date_range CHECK (end_date >= start_date)
);

CREATE INDEX idx_leave_requests_org ON leave_requests(organization_id);
CREATE INDEX idx_leave_requests_employee ON leave_requests(employee_id);
CREATE INDEX idx_leave_requests_status ON leave_requests(organization_id, status);
CREATE INDEX idx_leave_requests_dates ON leave_requests(start_date, end_date);

-- ─── Attendance Records ───────────────────────────────────────────────────────
CREATE TABLE attendance_records (
  id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  organization_id     UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  employee_id         UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  date                DATE NOT NULL,
  check_in_time       TIMESTAMPTZ,
  check_out_time      TIMESTAMPTZ,
  total_hours         DECIMAL(4,2),
  status              attendance_status NOT NULL DEFAULT 'absent',
  location            JSONB,
  source              message_source NOT NULL DEFAULT 'whatsapp',
  notes               TEXT,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (employee_id, date)
);

CREATE INDEX idx_attendance_org_date ON attendance_records(organization_id, date DESC);
CREATE INDEX idx_attendance_employee_date ON attendance_records(employee_id, date DESC);

-- Auto-calculate total_hours on check_out
CREATE OR REPLACE FUNCTION calc_total_hours()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.check_in_time IS NOT NULL AND NEW.check_out_time IS NOT NULL THEN
    NEW.total_hours := ROUND(
      EXTRACT(EPOCH FROM (NEW.check_out_time - NEW.check_in_time)) / 3600,
      2
    );
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_attendance_calc_hours
  BEFORE INSERT OR UPDATE ON attendance_records
  FOR EACH ROW EXECUTE FUNCTION calc_total_hours();

-- ─── updated_at triggers ──────────────────────────────────────────────────────
CREATE TRIGGER trg_leave_requests_updated_at
  BEFORE UPDATE ON leave_requests
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();
