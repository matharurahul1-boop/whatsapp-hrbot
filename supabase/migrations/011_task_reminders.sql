-- Migration: add per-task reminder offsets column
-- Run this in the Supabase SQL editor (Dashboard → SQL → New query → Run).
--
-- reminders stores the offset keys the task creator/assignee chose, e.g.:
--   '{"1_hour","2_hours","1_day"}'
-- The Vercel Cron checks tasks whose (deadline - offset) falls within the
-- current hour and sends WhatsApp / in-app notifications accordingly.

ALTER TABLE tasks
  ADD COLUMN IF NOT EXISTS reminders TEXT[] DEFAULT '{}';

-- Allow the cron (service role) to query tasks with reminders efficiently
CREATE INDEX IF NOT EXISTS idx_tasks_deadline_reminders
  ON tasks (deadline)
  WHERE deleted_at IS NULL;
