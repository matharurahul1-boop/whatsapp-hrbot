// ─── Conversation State Machine ───────────────────────────────────────────────

export type FlowState =
  | 'IDLE'            // No active flow
  | 'SLOT_FILLING'    // Collecting missing required info
  | 'CONFIRMING'      // Waiting for user yes/no
  | 'AUDIO_CONFIRM'   // Voice message transcribed, waiting for yes/no before dispatch
  | 'EXECUTING'       // Running tool (internal, not persisted long)
  | 'COMPLETE';       // Flow done, about to reset

// ─── Intent & Module ──────────────────────────────────────────────────────────

export type AgentModule =
  | 'task'
  | 'leave'
  | 'attendance'
  | 'onboarding'
  | 'general';

export type AgentIntent =
  // Task
  | 'CREATE_TASK'
  | 'ASSIGN_TASK'
  | 'LIST_TASKS'
  | 'COMPLETE_TASK'
  | 'UPDATE_TASK'
  | 'DELETE_TASK'
  | 'SET_REMINDER'
  | 'TASK_DETAILS'
  // Leave
  | 'APPLY_LEAVE'
  | 'CHECK_LEAVE_BALANCE'
  | 'CANCEL_LEAVE'
  | 'APPROVE_LEAVE'
  | 'REJECT_LEAVE'
  | 'LIST_LEAVES'
  // Attendance
  | 'CHECK_IN'
  | 'CHECK_OUT'
  | 'MY_ATTENDANCE'
  | 'TEAM_ATTENDANCE'
  | 'WHO_ABSENT'
  // Onboarding
  | 'START_ONBOARDING'
  | 'ONBOARDING_STATUS'
  | 'UPLOAD_DOCUMENT'
  // Users
  | 'LIST_USERS'
  // Settings
  | 'CONFIGURE_REMINDERS'
  // General
  | 'GREETING'
  | 'HELP'
  | 'UNKNOWN';

export type SupportedLanguage = 'en' | 'hi' | 'mixed';

// ─── Slot System ──────────────────────────────────────────────────────────────

export type SlotType =
  | 'string'
  | 'date'       // resolves to YYYY-MM-DD
  | 'datetime'   // resolves to ISO string
  | 'time'       // resolves to HH:MM
  | 'number'
  | 'enum'
  | 'person'     // resolves to user name/id lookup
  | 'boolean';

export interface SlotDefinition {
  name: string;
  type: SlotType;
  required: boolean;
  question_en: string;           // Question to ask in English
  question_hi: string;           // Question to ask in Hindi
  enum_values?: string[];        // For enum type
  validation?: (val: string) => boolean;
  hint?: string;                 // Shown after first failed attempt
}

export interface SlotValues {
  [key: string]: string | null;
}

// ─── Conversation Context (stored in conversations.context_state) ─────────────

export interface ConversationContext {
  flow: AgentIntent | null;       // Current active intent/flow
  flow_state: FlowState;
  module: AgentModule | null;
  slots: SlotValues;              // All slots collected so far
  pending_slot: string | null;    // Next slot to ask for
  confirm_payload: Record<string, unknown> | null; // What we're about to execute
  confirm_message: string | null; // Human-readable confirmation prompt
  retry_count: number;            // Retries on current slot
  error_context: string | null;   // Last error message for recovery
  language: SupportedLanguage;
  turn_count: number;             // Total turns in this flow
  // Persists across flow resets so follow-up messages like "update the same task"
  // don't have to re-specify the task title.
  last_task_title?: string | null;
  // Stores the transcribed text from a voice message while waiting for yes/no.
  pending_transcript?: string | null;
}

export const EMPTY_CONTEXT: ConversationContext = {
  flow: null,
  flow_state: 'IDLE',
  module: null,
  slots: {},
  pending_slot: null,
  confirm_payload: null,
  confirm_message: null,
  retry_count: 0,
  error_context: null,
  language: 'en',
  turn_count: 0,
  pending_transcript: null,
};

// ─── Classified Intent ─────────────────────────────────────────────────────────

export interface ClassifiedIntent {
  module: AgentModule;
  intent: AgentIntent;
  confidence: number;             // 0.0 – 1.0
  extracted_slots: SlotValues;    // Entities found in current message
  language: SupportedLanguage;
  is_affirmative: boolean;        // "yes", "haan", "confirm", "ok"
  is_negative: boolean;           // "no", "nahi", "cancel"
  raw_text: string;
}

// ─── Tool Execution ───────────────────────────────────────────────────────────

export interface ToolInput {
  intent: AgentIntent;
  slots: SlotValues;
  org_id: string;
  user_id: string;
  user_role: string;
  user_name: string;
  user_department: string | null;
  manager_id: string | null;
  raw_message?: string;           // original WhatsApp message (for AI handler)
}

export interface ToolResult {
  success: boolean;
  reply: string;                  // WhatsApp-ready message
  data?: Record<string, unknown>;
  notify?: Array<{                // Users to notify via WA
    user_id: string;
    message: string;
  }>;
  n8n_trigger?: {                 // n8n workflow to fire
    workflow: string;
    payload: Record<string, unknown>;
  };
  // When true, agent keeps the flow alive in SLOT_FILLING so the user can
  // correct the bad value without restarting from scratch.
  recoverable?: boolean;
  retry_slot?:  string;
}

// ─── Agent Response ───────────────────────────────────────────────────────────

export interface AgentTurn {
  reply: string;                  // Send this to WhatsApp
  new_context: ConversationContext;
  tool_result?: ToolResult;
  debug?: Record<string, unknown>;
}

// ─── User Identity ────────────────────────────────────────────────────────────

export interface AgentUser {
  id: string;
  organization_id: string;
  full_name: string;
  first_name: string;
  role: string;
  department: string | null;
  designation: string | null;
  manager_id: string | null;
  whatsapp_number: string;
  employee_id: string | null;
}
