/**
 * POST /api/policy/ask
 *
 * Body: { question: string, orgId?: string }
 *
 * Fetches all active policy documents for the org and uses Groq
 * (llama-3.3-70b-versatile) to answer the question from that context.
 * Returns { answer: string }
 *
 * Also called internally by the WhatsApp webhook when a user's message
 * looks like a policy question (starts with ?, or contains "policy",
 * "leave", "rule", "benefit", etc.).
 */

import { NextRequest, NextResponse } from 'next/server';
import { createClient }              from '@/lib/supabase/server';
import { createAdminClient }         from '@/lib/supabase/admin';

const GROQ_API = 'https://api.groq.com/openai/v1/chat/completions';
const MODEL    = 'llama-3.3-70b-versatile';

export async function POST(req: NextRequest) {
  // Auth: require a logged-in user OR a shared secret (for WhatsApp webhook use)
  const secret       = process.env.POLICY_SECRET ?? process.env.ESCALATION_SECRET;
  const headerSecret = req.headers.get('x-policy-secret');

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  let orgId = '';
  let authorized = false;

  if (secret && headerSecret === secret) {
    // Internal call from webhook — orgId must be in body
    authorized = true;
  } else if (user) {
    const db = createAdminClient();
    const { data: profile } = await db
      .from('users')
      .select('organization_id, role')
      .eq('id', user.id)
      .single();
    if (profile) {
      orgId      = profile.organization_id;
      authorized = true;
    }
  }

  if (!authorized) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const body     = await req.json();
  const question = (body.question as string)?.trim();
  if (!orgId) orgId = (body.orgId as string) ?? '';

  if (!question || !orgId) {
    return NextResponse.json({ error: 'question and orgId required' }, { status: 400 });
  }

  const db = createAdminClient();

  // Fetch org policy documents
  const { data: docs } = await db
    .from('policy_documents')
    .select('title, category, content')
    .eq('organization_id', orgId)
    .eq('is_active', true)
    .order('created_at', { ascending: false })
    .limit(20);

  if (!docs || docs.length === 0) {
    return NextResponse.json({
      answer: "I don't have any policy documents loaded yet. Please ask your HR team to upload the relevant policies.",
    });
  }

  // Build context string (truncate to avoid token limits)
  const MAX_CHARS = 12000;
  let context = '';
  for (const doc of docs) {
    const block = `\n## ${doc.title} (${doc.category})\n${doc.content}\n`;
    if ((context + block).length > MAX_CHARS) break;
    context += block;
  }

  const groqKey = process.env.GROQ_API_KEY;
  if (!groqKey) {
    return NextResponse.json({ error: 'GROQ_API_KEY not configured' }, { status: 500 });
  }

  const systemPrompt = `You are an HR Policy Assistant. Answer employee questions strictly based on the provided company policy documents. If the information is not in the documents, say so and advise the employee to contact HR directly. Be concise, friendly, and professional. Format your response for WhatsApp (use plain text, not markdown headers).

COMPANY POLICY DOCUMENTS:
${context}`;

  try {
    const groqRes = await fetch(GROQ_API, {
      method:  'POST',
      headers: {
        Authorization:  `Bearer ${groqKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model:       MODEL,
        temperature: 0.2,
        max_tokens:  600,
        messages: [
          { role: 'system',  content: systemPrompt },
          { role: 'user',    content: question },
        ],
      }),
    });

    if (!groqRes.ok) {
      const err = await groqRes.text();
      console.error('[policy/ask] Groq error:', err);
      return NextResponse.json({ error: 'AI service error' }, { status: 500 });
    }

    const groqJson = await groqRes.json();
    const answer   = groqJson.choices?.[0]?.message?.content?.trim() ?? 'Sorry, I could not generate an answer. Please contact HR.';

    // Block leaked chain-of-thought from reaching the user
    const isLeakedReasoning = /^(?:we need to|i need to (?:parse|analyze|check|look)|let me (?:analyze|think|check|parse|fetch|get)|the user (?:has provided|said|asked for)|to handle this|i'?ll (?:list|fetch|get|show|retrieve)|according to)/i.test(answer.slice(0, 160));
    if (isLeakedReasoning) {
      console.warn('[policy/ask] Groq leaked chain-of-thought, suppressing');
      return NextResponse.json({ answer: 'I was unable to generate a clear answer. Please contact HR directly or refer to the policy document.' });
    }

    return NextResponse.json({ answer });
  } catch (err) {
    console.error('[policy/ask] Unexpected error:', err);
    return NextResponse.json({ error: 'Internal error' }, { status: 500 });
  }
}
