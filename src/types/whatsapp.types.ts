// WhatsApp Cloud API payload types

export interface WAWebhookPayload {
  object: string;
  entry: WAEntry[];
}

export interface WAEntry {
  id: string;
  changes: WAChange[];
}

export interface WAChange {
  value: WAValue;
  field: string;
}

export interface WAValue {
  messaging_product: string;
  metadata: WAMetadata;
  contacts?: WAContact[];
  messages?: WAMessage[];
  statuses?: WAStatus[];
  errors?: WAError[];
}

export interface WAMetadata {
  display_phone_number: string;
  phone_number_id: string;
}

export interface WAContact {
  profile: { name: string };
  wa_id: string;
}

export interface WAMessage {
  id: string;
  from: string;
  timestamp: string;
  type: WAMessageType;
  text?: { body: string };
  image?: WAMedia;
  document?: WAMedia & { filename?: string };
  audio?: WAMedia;
  video?: WAMedia;
  sticker?: WAMedia;
  location?: WALocation;
  button?: WAButton;
  interactive?: WAInteractive;
  reaction?: WAReaction;
  context?: { message_id: string; from: string };
}

export type WAMessageType =
  | 'text' | 'image' | 'document' | 'audio' | 'video'
  | 'sticker' | 'location' | 'button' | 'interactive'
  | 'reaction' | 'unsupported';

export interface WAMedia {
  id: string;
  mime_type?: string;
  sha256?: string;
  caption?: string;
}

export interface WALocation {
  latitude: number;
  longitude: number;
  name?: string;
  address?: string;
}

export interface WAButton {
  payload: string;
  text: string;
}

export interface WAInteractive {
  type: 'button_reply' | 'list_reply';
  button_reply?: { id: string; title: string };
  list_reply?: { id: string; title: string; description?: string };
}

export interface WAReaction {
  message_id: string;
  emoji: string;
}

export interface WAStatus {
  id: string;
  status: 'sent' | 'delivered' | 'read' | 'failed';
  timestamp: string;
  recipient_id: string;
  errors?: WAError[];
}

export interface WAError {
  code: number;
  title: string;
  message?: string;
  error_data?: { details: string };
}

// Outbound message types
export interface WASendTextPayload {
  messaging_product: 'whatsapp';
  recipient_type: 'individual';
  to: string;
  type: 'text';
  text: { body: string; preview_url?: boolean };
}

export interface WASendInteractivePayload {
  messaging_product: 'whatsapp';
  recipient_type: 'individual';
  to: string;
  type: 'interactive';
  interactive: WAInteractiveObject;
}

export interface WAInteractiveObject {
  type: 'button' | 'list';
  header?: { type: 'text'; text: string };
  body: { text: string };
  footer?: { text: string };
  action: WAButtonAction | WAListAction;
}

export interface WAButtonAction {
  buttons: Array<{ type: 'reply'; reply: { id: string; title: string } }>;
}

export interface WAListAction {
  button: string;
  sections: Array<{
    title: string;
    rows: Array<{ id: string; title: string; description?: string }>;
  }>;
}

export interface WASendDocumentPayload {
  messaging_product: 'whatsapp';
  recipient_type: 'individual';
  to: string;
  type: 'document';
  document: { link: string; caption?: string; filename?: string };
}

export type WAOutboundPayload =
  | WASendTextPayload
  | WASendInteractivePayload
  | WASendDocumentPayload;

export interface WAApiResponse {
  messaging_product: string;
  contacts: Array<{ input: string; wa_id: string }>;
  messages: Array<{ id: string }>;
}

// Parsed inbound message (normalized)
export interface ParsedInboundMessage {
  wa_message_id: string;
  from_number: string;
  contact_name: string;
  phone_number_id: string;
  type: WAMessageType;
  text: string | null;
  media_id: string | null;
  media_mime_type: string | null;
  media_filename: string | null;
  location: WALocation | null;
  button_payload: string | null;
  timestamp: string;
  raw: WAMessage;
}
