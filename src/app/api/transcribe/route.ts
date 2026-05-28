import { NextRequest, NextResponse } from 'next/server';
import { createClient }             from '@/lib/supabase/server';

/**
 * POST /api/transcribe
 *
 * Accepts a multipart/form-data body with an `audio` blob.
 * Sends it to Groq Whisper (whisper-large-v3) for translation → English text.
 * Supports any spoken language — Groq auto-detects and translates to English.
 */
export async function POST(req: NextRequest) {
  // ── Auth check ───────────────────────────────────────────────────────────
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const groqKey = process.env.GROQ_API_KEY;
  if (!groqKey) {
    console.error('[Transcribe] GROQ_API_KEY is not set');
    return NextResponse.json({ error: 'Transcription service not configured' }, { status: 500 });
  }

  // ── Parse audio blob ─────────────────────────────────────────────────────
  let audioBlob: Blob | null = null;
  try {
    const form = await req.formData();
    audioBlob  = form.get('audio') as Blob | null;
  } catch {
    return NextResponse.json({ error: 'Invalid form data' }, { status: 400 });
  }

  if (!audioBlob || audioBlob.size === 0) {
    return NextResponse.json({ error: 'No audio provided' }, { status: 400 });
  }

  if (audioBlob.size > 25 * 1024 * 1024) {   // Groq limit: 25 MB
    return NextResponse.json({ error: 'Audio too large (max 25 MB)' }, { status: 400 });
  }

  // ── Call Groq Whisper — translations endpoint (any lang → English) ───────
  try {
    const groqForm = new FormData();
    groqForm.append(
      'file',
      new File([audioBlob], 'recording.webm', { type: audioBlob.type || 'audio/webm' })
    );
    groqForm.append('model',           'whisper-large-v3');
    groqForm.append('response_format', 'json');
    // temperature 0 = most accurate
    groqForm.append('temperature',     '0');

    console.log(`[Transcribe] Sending ${(audioBlob.size / 1024).toFixed(1)} KB to Groq`);

    const groqRes = await fetch('https://api.groq.com/openai/v1/audio/translations', {
      method:  'POST',
      headers: { 'Authorization': `Bearer ${groqKey}` },
      body:    groqForm,
    });

    if (!groqRes.ok) {
      const errText = await groqRes.text().catch(() => '');
      console.error('[Transcribe] Groq error:', groqRes.status, errText);
      return NextResponse.json(
        { error: `Groq transcription failed (${groqRes.status})` },
        { status: 502 }
      );
    }

    const result = await groqRes.json();
    const text   = (result.text ?? '').trim();

    console.log(`[Transcribe] ✅ Result: "${text.slice(0, 100)}"`);
    return NextResponse.json({ text });

  } catch (err) {
    console.error('[Transcribe] Unexpected error:', err);
    return NextResponse.json({ error: 'Transcription failed' }, { status: 500 });
  }
}
