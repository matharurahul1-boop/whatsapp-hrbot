import { NextRequest, NextResponse } from 'next/server';
import { createClient }             from '@/lib/supabase/server';

const GROQ_API = 'https://api.groq.com/openai/v1/chat/completions';
const MODEL    = 'llama-3.3-70b-versatile';   // fast + smart, free on Groq

async function groq(system: string, user: string): Promise<string> {
  const key = process.env.GROQ_API_KEY;
  if (!key) throw new Error('GROQ_API_KEY not set');

  const res = await fetch(GROQ_API, {
    method:  'POST',
    headers: { 'Authorization': `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model:       MODEL,
      temperature: 0.4,
      max_tokens:  400,
      messages: [
        { role: 'system', content: system },
        { role: 'user',   content: user   },
      ],
    }),
  });

  if (!res.ok) {
    const err = await res.text().catch(() => '');
    throw new Error(`Groq ${res.status}: ${err}`);
  }

  const json = await res.json();
  return (json.choices?.[0]?.message?.content ?? '').trim();
}

// ── POST /api/ai-features ─────────────────────────────────────────────────
export async function POST(req: NextRequest) {
  // Auth
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { feature, messages, lastMessage } = await req.json();

  try {
    // ── 1. Smart Reply Suggestions ────────────────────────────────────────
    if (feature === 'suggestions') {
      if (!lastMessage) return NextResponse.json({ suggestions: [] });

      // Build a short conversation context (last 6 messages)
      const ctx = (messages as { direction: string; message_text: string | null }[])
        .slice(-6)
        .map(m => `${m.direction === 'incoming' ? 'Employee' : 'HR'}: ${m.message_text ?? ''}`)
        .join('\n');

      const raw = await groq(
        `You are an HR manager assistant. Given the conversation context and the employee's last message,
suggest exactly 3 short, professional reply options for the HR manager to send.
Rules:
- Each reply must be 1-2 sentences max
- Keep it warm, professional, HR-appropriate
- Vary the tone: one formal, one friendly, one action-oriented
- Output ONLY a JSON array of 3 strings, nothing else. Example: ["reply1","reply2","reply3"]`,
        `Conversation context:\n${ctx}\n\nEmployee's last message: "${lastMessage}"\n\nSuggest 3 replies:`
      );

      let suggestions: string[] = [];
      try {
        // Extract JSON array from response
        const match = raw.match(/\[[\s\S]*\]/);
        suggestions = match ? JSON.parse(match[0]) : [];
      } catch {
        // Fallback: split by newlines
        suggestions = raw.split('\n').filter(s => s.trim()).slice(0, 3);
      }

      return NextResponse.json({ suggestions: suggestions.slice(0, 3) });
    }

    // ── 2. Conversation Summary ───────────────────────────────────────────
    if (feature === 'summary') {
      if (!messages?.length) return NextResponse.json({ summary: 'No messages to summarize.' });

      const convo = (messages as { direction: string; message_text: string | null; wa_timestamp: string | null }[])
        .filter(m => m.message_text)
        .map(m => `${m.direction === 'incoming' ? 'Employee' : 'HR'}: ${m.message_text}`)
        .join('\n');

      const summary = await groq(
        `You are an HR analytics assistant. Summarize the following WhatsApp conversation between an employee and HR.
Output format — strict markdown bullet points:
• **Topic**: what is the main subject?
• **Key requests**: what did the employee ask for?
• **HR actions**: what did HR do or promise?
• **Status**: resolved / pending / escalation needed
• **Tone**: employee's overall tone (frustrated / happy / neutral / urgent)
Keep each bullet to one line. Be factual and concise.`,
        `Conversation:\n${convo}`
      );

      return NextResponse.json({ summary });
    }

    // ── 3. Sentiment Analysis ─────────────────────────────────────────────
    if (feature === 'sentiment') {
      if (!messages?.length) return NextResponse.json({ sentiment: 'neutral', score: 50 });

      // Only analyse the employee's last 10 incoming messages
      const employeeMsgs = (messages as { direction: string; message_text: string | null }[])
        .filter(m => m.direction === 'incoming' && m.message_text)
        .slice(-10)
        .map(m => m.message_text)
        .join(' | ');

      if (!employeeMsgs.trim()) return NextResponse.json({ sentiment: 'neutral', score: 50 });

      const raw = await groq(
        `You are a sentiment analyser for HR conversations. Analyse the employee's messages.
Output ONLY valid JSON in this exact format, nothing else:
{"sentiment":"positive"|"neutral"|"negative"|"urgent","score":0-100,"emoji":"😊"|"😐"|"😟"|"🚨","reason":"one short sentence"}
- score: 0=very negative, 50=neutral, 100=very positive
- urgent: override if words like resign/quit/complaint/harass/emergency/sick appear`,
        `Employee messages: ${employeeMsgs}`
      );

      let result = { sentiment: 'neutral', score: 50, emoji: '😐', reason: '' };
      try {
        const match = raw.match(/\{[\s\S]*\}/);
        if (match) result = { ...result, ...JSON.parse(match[0]) };
      } catch { /* use defaults */ }

      return NextResponse.json(result);
    }

    return NextResponse.json({ error: 'Unknown feature' }, { status: 400 });

  } catch (err: unknown) {
    console.error('[AI Features] Error:', err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'AI feature failed' },
      { status: 500 }
    );
  }
}
