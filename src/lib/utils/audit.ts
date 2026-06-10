import { createAdminClient } from '@/lib/supabase/admin';

// Matches the column names in combined_migration.sql → audit_logs table
interface AuditEntry {
  org_id:      string;
  actor_id:    string;
  actor_type?: 'user' | 'system' | 'ai_agent' | 'n8n';
  action:      string;
  table_name:  string;
  record_id?:  string;
  old_data?:   Record<string, unknown> | null;
  new_data?:   Record<string, unknown> | null;
  ip_address?: string;
  source?:     string;
}

export async function writeAuditLog(entry: AuditEntry): Promise<void> {
  try {
    const db = createAdminClient();
    await db.from('audit_logs').insert({
      organization_id: entry.org_id,
      actor_id:        entry.actor_id,
      actor_type:      entry.actor_type ?? 'user',
      action:          entry.action,
      table_name:      entry.table_name,
      record_id:       entry.record_id   ?? null,
      old_data:        entry.old_data    ?? null,
      new_data:        entry.new_data    ?? null,
      ip_address:      entry.ip_address  ?? null,
      source:          entry.source      ?? 'dashboard',
    });
  } catch (e) {
    // Never crash a request because of audit log failure — but do log it
    console.error('[AuditLog] Failed to write audit entry:', e);
  }
}
