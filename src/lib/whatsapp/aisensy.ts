/**
 * AISensy Campaign API wrapper.
 *
 * Every outgoing WhatsApp message is sent via AISensy's Campaign API
 * (https://backend.aisensy.com/campaign/t1/api/v2). The response is
 * normalised back to the WAApiResponse shape so the rest of the codebase
 * needs no changes.
 */

const AISENSY_CAMPAIGN_URL = 'https://backend.aisensy.com/campaign/t1/api/v2';

export interface AISensyPayload {
  apiKey:          string;
  campaignName:    string;
  destination:     string;
  userName:        string;
  source:          string;
  templateParams?: string[];
  media?: {
    url:       string;
    filename?: string;
  };
  buttons?:       unknown[];
  carouselCards?: unknown[];
  location?:      Record<string, unknown>;
  attributes?:    Record<string, unknown>;
}

interface AISensyRaw {
  status?:    string;
  message?:   string;
  messageId?: string;
  messages?:  Array<{ id: string }>;
  [key: string]: unknown;
}

function toWAResponse(raw: AISensyRaw, to: string) {
  return {
    messaging_product: 'whatsapp' as const,
    contacts: [{ input: to, wa_id: to }],
    messages: raw.messages ?? [{ id: raw.messageId ?? `aisensy-${Date.now()}` }],
  };
}

export async function aisensySend(payload: AISensyPayload) {
  const res = await fetch(AISENSY_CAMPAIGN_URL, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify(payload),
  });

  const raw: AISensyRaw = await res.json().catch(() => ({}));

  if (!res.ok) {
    throw new Error(
      `AISensy ${res.status}: ${raw.message ?? JSON.stringify(raw)}`
    );
  }

  return toWAResponse(raw, payload.destination);
}
