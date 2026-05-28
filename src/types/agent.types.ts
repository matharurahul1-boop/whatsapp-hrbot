import type { ConversationModule } from './database.types';

export type SupportedLanguage = 'en' | 'hi' | 'mixed';

export interface IntentResult {
  module: ConversationModule;
  intent: string;
  confidence: number;
  entities: IntentEntities;
  missing_fields: string[];
  language: SupportedLanguage;
  needs_clarification: boolean;
  clarification_question?: string;
}

export interface IntentEntities {
  assignee?: string;
  assignee_id?: string;
  deadline?: string;
  task_title?: string;
  task_id?: string;
  leave_type?: string;
  leave_type_id?: string;
  start_date?: string;
  end_date?: string;
  duration?: string;
  employee_name?: string;
  employee_id?: string;
  department?: string;
  status?: string;
  reason?: string;
  [key: string]: string | undefined;
}

export interface AgentContext {
  organization_id: string;
  user_id: string;
  user_name: string;
  user_role: string;
  user_department: string | null;
  manager_id: string | null;
  whatsapp_number: string;
  conversation_id: string;
  current_module: ConversationModule | null;
  context_state: Record<string, unknown>;
  recent_messages: AgentMessage[];
  language: SupportedLanguage;
}

export interface AgentMessage {
  role: 'user' | 'assistant' | 'system';
  content: string;
  created_at: string;
}

export interface AgentResponse {
  message: string;
  intent?: IntentResult;
  action_taken?: string;
  new_context_state?: Record<string, unknown>;
  module?: ConversationModule;
  metadata?: Record<string, unknown>;
}

export interface ToolCallResult {
  success: boolean;
  data?: Record<string, unknown>;
  error?: string;
  message: string;
}

// Known intents per module
export const TASK_INTENTS = [
  'CREATE_TASK', 'UPDATE_TASK', 'LIST_TASKS', 'COMPLETE_TASK',
  'ASSIGN_TASK', 'DELETE_TASK', 'SET_REMINDER', 'TASK_STATUS',
] as const;

export const LEAVE_INTENTS = [
  'APPLY_LEAVE', 'CHECK_BALANCE', 'CANCEL_LEAVE',
  'APPROVE_LEAVE', 'REJECT_LEAVE', 'LIST_LEAVES',
] as const;

export const ATTENDANCE_INTENTS = [
  'CHECK_IN', 'CHECK_OUT', 'MARK_ATTENDANCE', 'ATTENDANCE_REPORT',
  'WHO_ABSENT', 'MY_ATTENDANCE',
] as const;

export const ONBOARDING_INTENTS = [
  'START_ONBOARDING', 'UPLOAD_DOCUMENT', 'CHECK_STATUS',
  'SUBMIT_INFO', 'COMPLETE_STEP',
] as const;

export const GENERAL_INTENTS = [
  'GREETING', 'HELP', 'UNKNOWN',
] as const;

export type TaskIntent = typeof TASK_INTENTS[number];
export type LeaveIntent = typeof LEAVE_INTENTS[number];
export type AttendanceIntent = typeof ATTENDANCE_INTENTS[number];
export type OnboardingIntent = typeof ONBOARDING_INTENTS[number];
export type GeneralIntent = typeof GENERAL_INTENTS[number];
export type AnyIntent = TaskIntent | LeaveIntent | AttendanceIntent | OnboardingIntent | GeneralIntent;
