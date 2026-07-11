export type OrgPlan = 'free' | 'pro' | 'enterprise';
export type UserRole = 'super_admin' | 'admin' | 'hr' | 'hr_assistant' | 'manager' | 'employee';
export type OnboardingStatus = 'pending' | 'in_progress' | 'completed';
export type MessageDirection = 'inbound' | 'outbound';
export type MessageRole = 'user' | 'assistant' | 'system';
export type ConversationStatus = 'active' | 'idle' | 'closed';
export type ConversationModule = 'task' | 'onboarding' | 'leave' | 'attendance' | 'general';
export type MessageSource = 'whatsapp' | 'dashboard' | 'n8n' | 'api' | 'biometric' | 'auto';
export type TaskStatus = 'pending' | 'in_progress' | 'completed' | 'cancelled';
export type TaskPriority = 'low' | 'medium' | 'high' | 'urgent';
export type LeaveRequestStatus = 'pending' | 'approved' | 'rejected' | 'cancelled';
export type AttendanceStatus = 'present' | 'absent' | 'half_day' | 'late' | 'on_leave';
export type OnboardingSessionStatus = 'pending' | 'in_progress' | 'completed' | 'rejected';
export type DocumentType = 'id_proof' | 'address_proof' | 'photo' | 'contract' | 'education_certificate' | 'experience_letter' | 'other';
export type WorkflowStatus = 'running' | 'success' | 'failed';
export type NotificationChannel = 'whatsapp' | 'in_app' | 'email';
export type NotificationStatus = 'pending' | 'sent' | 'failed' | 'read';

export interface Organization {
  id: string;
  name: string;
  whatsapp_number: string | null;
  wa_phone_number_id: string | null;
  wa_access_token: string | null;
  plan: OrgPlan;
  settings: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

export interface User {
  id: string;
  organization_id: string;
  full_name: string;
  email: string;
  whatsapp_number: string | null;
  role: UserRole;
  employee_id: string | null;
  department: string | null;
  designation: string | null;
  manager_id: string | null;
  onboarding_status: OnboardingStatus;
  is_active: boolean;
  avatar_url: string | null;
  metadata: Record<string, unknown>;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
}

export interface Conversation {
  id: string;
  organization_id: string;
  user_id: string | null;
  whatsapp_number: string;
  channel: MessageSource;
  status: ConversationStatus;
  current_module: ConversationModule | null;
  current_intent: string | null;
  context_state: Record<string, unknown>;
  last_message_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface Message {
  id: string;
  conversation_id: string;
  organization_id: string;
  direction: MessageDirection;
  role: MessageRole;
  content: string;
  media_url: string | null;
  media_type: string | null;
  wa_message_id: string | null;
  intent: string | null;
  tokens_used: number | null;
  latency_ms: number | null;
  metadata: Record<string, unknown>;
  created_at: string;
}

export interface Task {
  id: string;
  organization_id: string;
  title: string;
  description: string | null;
  assigned_to: string | null;
  assigned_by: string | null;
  status: TaskStatus;
  priority: TaskPriority;
  due_date: string | null;
  due_time: string | null;
  tags: string[];
  source: MessageSource;
  wa_conversation_id: string | null;
  completed_at: string | null;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
}

export interface TaskComment {
  id: string;
  task_id: string;
  user_id: string | null;
  content: string;
  source: MessageSource;
  created_at: string;
}

export interface LeaveType {
  id: string;
  organization_id: string;
  name: string;
  default_days: number;
  carry_forward: boolean;
  requires_approval: boolean;
  color: string;
  is_active: boolean;
  created_at: string;
}

export interface LeaveBalance {
  id: string;
  user_id: string;
  leave_type_id: string;
  year: number;
  total_days: number;
  used_days: number;
  remaining_days: number;
}

export interface LeaveRequest {
  id: string;
  organization_id: string;
  user_id: string;
  leave_type_id: string;
  start_date: string;
  end_date: string;
  total_days: number;
  reason: string | null;
  status: LeaveRequestStatus;
  approved_by: string | null;
  approved_at: string | null;
  rejection_reason: string | null;
  source: MessageSource;
  created_at: string;
  updated_at: string;
}

export interface AttendanceRecord {
  id: string;
  organization_id: string;
  user_id: string;
  date: string;
  check_in_time: string | null;
  check_out_time: string | null;
  total_hours: number | null;
  status: AttendanceStatus;
  location: { lat: number; lng: number; address?: string } | null;
  source: MessageSource;
  notes: string | null;
  created_at: string;
}

export interface OnboardingSession {
  id: string;
  organization_id: string;
  user_id: string;
  initiated_by: string | null;
  current_step: number;
  total_steps: number;
  status: OnboardingSessionStatus;
  collected_data: Record<string, unknown>;
  completed_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface Notification {
  id: string;
  organization_id: string;
  user_id: string;
  type: string;
  title: string;
  body: string;
  channel: NotificationChannel;
  status: NotificationStatus;
  sent_at: string | null;
  read_at: string | null;
  metadata: Record<string, unknown>;
  created_at: string;
}
