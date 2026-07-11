-- Add the HR Assistant role to the user_role enum.
-- Postgres requires ALTER TYPE ... ADD VALUE to run outside a transaction
-- block and cannot be used in the same transaction as a statement that
-- reads the new value — keep this migration to just the one statement.
ALTER TYPE user_role ADD VALUE IF NOT EXISTS 'hr_assistant';
