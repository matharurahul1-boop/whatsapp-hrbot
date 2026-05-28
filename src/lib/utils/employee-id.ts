import { createAdminClient } from '@/lib/supabase/admin';

export async function generateEmployeeId(): Promise<string> {
  const db = createAdminClient();
  const { data } = await db.rpc('generate_employee_id');
  return (data as string) ?? `EMP-${Date.now()}`;
}
