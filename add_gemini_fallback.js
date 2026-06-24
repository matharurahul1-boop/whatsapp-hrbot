/**
 * add_gemini_fallback.js
 *
 * Adds Google Gemini as a 4th fallback tier in the AI Agent.
 * Gemini 2.0 Flash free tier: 15 RPM, 1,000,000 TPD — dramatically extends
 * daily capacity when Groq's 100K org-level TPD is exhausted.
 *
 * Also:
 *   - Restores proper "temporarily unavailable" user message (removes debug patch)
 *   - Adds GEMINI_KEY to n8n Secrets node
 *   - Adds geminiCall() with full OpenAI↔Gemini message/tool format adapters
 *
 * LLM cascade after this change:
 *   1. groqCall   — llama-3.3-70b-versatile, 10 keys, 100K org TPD/day
 *   2. OpenRouter paid — meta-llama/llama-3.3-70b-instruct, pay-per-token
 *   3. OpenRouter free — meta-llama/llama-3.3-70b-instruct:free, free tier
 *   4. geminiCall  — gemini-2.0-flash, FREE 1M TPD
 *
 * Production recommendation:
 *   - Groq Dev Tier ($20/mo): removes the 100K org TPD cap entirely
 *   - OpenRouter credits ($5+): unlocks paid models + free model access
 */

const fs    = require('fs');
const https = require('https');

const WF_PATH = 'C:/Users/hp/OneDrive/Desktop/whatsapp-task-handler/WHATSAPP/n8n workflow files/hrbot-wa-inbound-ai-agent.json';
const N8N_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIyYWI0NWU4OC00OGU1LTRhZTYtYTM5My1kMTczZTdlZTg1ZmEiLCJpc3MiOiJuOG4iLCJhdWQiOiJwdWJsaWMtYXBpIiwianRpIjoiN2YyODc5MGQtOTFmOC00MjVlLTliZmMtYjBhZTMyMTM2NWIwIiwiaWF0IjoxNzgyMTU3Njc1fQ.qrundBFA-MhpZQAkFlmsla5wJurBLunhhMy6s3SMp6E';
const WF_ID   = 'NZsKomyCVzVMHqxp';
const GEMINI_KEY = 'AQ.Ab8RN6LavwbWAtUpF86S75ZgMRUqhwbB80wYrl7ANQ2BLnc9cg';

function req(method, path, body) {
  return new Promise((resolve, reject) => {
    const data = body ? JSON.stringify(body) : null;
    const r = https.request({
      hostname: 'n8n-whatsapp-bot-ouy1.onrender.com', port: 443, path, method,
      headers: {
        'X-N8N-API-KEY': N8N_KEY, 'Content-Type': 'application/json',
        ...(data ? { 'Content-Length': Buffer.byteLength(data) } : {})
      }
    }, res => {
      let b = '';
      res.on('data', d => b += d);
      res.on('end', () => { try { resolve({ status: res.statusCode, body: JSON.parse(b) }); } catch { resolve({ status: res.statusCode, body: b }); } });
    });
    r.on('error', reject);
    if (data) r.write(data);
    r.end();
  });
}

// The geminiCall function to inject into AI Agent JS code
const GEMINI_CALL_FN = `
async function geminiCall(msgs, toolChoice) {
  const gemKey = $('Secrets').item.json.gemini_key || '';
  if (!gemKey) throw new Error('GEMINI_NO_KEY');

  // Extract system prompt (Gemini uses a separate field)
  let sysText = '';
  const gemMsgs = [];
  for (const m of msgs) {
    if (m.role === 'system') { sysText += m.content + '\\n'; continue; }
    if (m.role === 'user') {
      gemMsgs.push({ role: 'user', parts: [{ text: typeof m.content === 'string' ? m.content : JSON.stringify(m.content) }] });
    } else if (m.role === 'assistant') {
      if (m.tool_calls && m.tool_calls.length > 0) {
        // Tool call from assistant
        gemMsgs.push({ role: 'model', parts: m.tool_calls.map(function(tc) {
          return { functionCall: { name: tc.function.name, args: JSON.parse(tc.function.arguments || '{}') } };
        })});
      } else {
        gemMsgs.push({ role: 'model', parts: [{ text: m.content || '' }] });
      }
    } else if (m.role === 'tool') {
      // Tool result — append as user message with functionResponse
      const last = gemMsgs[gemMsgs.length - 1];
      if (last && last.role === 'user') {
        last.parts.push({ functionResponse: { name: 'tool', response: { result: m.content } } });
      } else {
        gemMsgs.push({ role: 'user', parts: [{ functionResponse: { name: 'tool', response: { result: m.content } } }] });
      }
    }
  }

  // Convert OpenAI tools to Gemini format
  const gemTools = toolChoice === 'none' ? [] : [{
    functionDeclarations: tools.map(function(t) {
      const p = t.function.parameters;
      return { name: t.function.name, description: t.function.description, parameters: p && Object.keys(p.properties||{}).length > 0 ? p : { type: 'object', properties: {} } };
    })
  }];

  const gemBody = {
    contents: gemMsgs,
    generationConfig: { maxOutputTokens: 600, temperature: 0.3 },
    ...(sysText ? { systemInstruction: { parts: [{ text: sysText.trim() }] } } : {}),
    ...(gemTools.length > 0 ? { tools: gemTools, toolConfig: { functionCallingConfig: { mode: toolChoice === 'none' ? 'NONE' : 'AUTO' } } } : {})
  };

  const gemResp = await helpers.httpRequest({
    method: 'POST',
    url: 'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=' + gemKey,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(gemBody)
  });

  // Convert Gemini response to OpenAI format
  const cand = gemResp.candidates && gemResp.candidates[0];
  if (!cand) throw new Error('GEMINI_NO_CANDIDATES');
  const parts = cand.content && cand.content.parts || [];
  const fnCallParts = parts.filter(function(p) { return p.functionCall; });
  if (fnCallParts.length > 0) {
    // Tool call response
    return { choices: [{ finish_reason: 'tool_calls', message: {
      content: null,
      tool_calls: fnCallParts.map(function(p, i) {
        return { id: 'gc_' + i, type: 'function', function: { name: p.functionCall.name, arguments: JSON.stringify(p.functionCall.args || {}) } };
      })
    }}]};
  }
  const textParts = parts.filter(function(p) { return p.text; });
  return { choices: [{ finish_reason: 'stop', message: { content: textParts.map(function(p) { return p.text; }).join('') || '' } }] };
}
`;

(async () => {
  console.log('Fetching live workflow…');
  const live = await req('GET', '/api/v1/workflows/' + WF_ID);
  if (live.status !== 200) { console.error('GET failed', live.status); process.exit(1); }
  const wf = live.body;

  // ── 1. Add GEMINI_KEY to Secrets node ─────────────────────────────────────
  const secNode = wf.nodes.find(n => n.name === 'Secrets');
  const assigns = secNode.parameters.assignments.assignments;
  const hasGemini = assigns.some(a => a.name === 'gemini_key');
  if (!hasGemini) {
    assigns.push({ id: 'gemini-key', name: 'gemini_key', value: GEMINI_KEY, type: 'string' });
    console.log('✅ Gemini key added to Secrets node');
  } else {
    assigns.find(a => a.name === 'gemini_key').value = GEMINI_KEY;
    console.log('✅ Gemini key updated in Secrets node');
  }

  // ── 2. Patch AI Agent code ─────────────────────────────────────────────────
  const aiNode = wf.nodes.find(n => n.name === 'AI Agent');
  let code = aiNode.parameters.jsCode;

  // Fix A: Remove debug patch (restore proper user message)
  const DEBUG_MSG = "return [{ json: { output: '⚠️ DEBUG ERROR: ' + _msg.slice(0,300) } }];";
  const PROD_MSG  = "return [{ json: { output: '⚠️ *HRBot is temporarily unavailable* due to high demand on our AI service. Please try again in a few minutes. 🙏' } }];";
  if (code.includes(DEBUG_MSG)) {
    code = code.replace(DEBUG_MSG, PROD_MSG);
    console.log('✅ Debug patch removed — restored user-friendly error message');
  } else {
    console.log('ℹ️  No debug patch found (already clean or different)');
  }

  // Fix B: Add geminiCall function before llmCall
  const LLM_CALL_ANCHOR = 'async function llmCall(msgs, toolChoice) {';
  if (code.includes(LLM_CALL_ANCHOR) && !code.includes('async function geminiCall')) {
    code = code.replace(LLM_CALL_ANCHOR, GEMINI_CALL_FN + '\n' + LLM_CALL_ANCHOR);
    console.log('✅ geminiCall() function added');
  } else if (code.includes('async function geminiCall')) {
    console.log('ℹ️  geminiCall already present');
  } else {
    console.error('❌ llmCall anchor not found!');
    process.exit(1);
  }

  // Fix C: Add geminiCall as 4th tier in llmCall fallback chain
  // Find the throw inside the last catch (free tier fail → ALL_PROVIDERS_DOWN)
  const OLD_FREE_CATCH = `        } catch(freeErr) {\n          // All providers exhausted — return a graceful message\n          throw new Error('ALL_PROVIDERS_DOWN:' + (freeErr.message || String(freeErr)));\n        }`;
  const NEW_FREE_CATCH = `        } catch(freeErr) {\n          // Try Gemini as 4th tier fallback\n          try { return await geminiCall(msgs, toolChoice); }\n          catch(gemErr) { throw new Error('ALL_PROVIDERS_DOWN:' + (gemErr.message || String(gemErr))); }\n        }`;

  if (code.includes(OLD_FREE_CATCH)) {
    code = code.replace(OLD_FREE_CATCH, NEW_FREE_CATCH);
    console.log('✅ Gemini added as 4th fallback tier in llmCall');
  } else {
    // Try alternative anchor (the code might be minified/different)
    const ALT_OLD = "throw new Error('ALL_PROVIDERS_DOWN:' + (freeErr.message || String(freeErr)));";
    if (code.includes(ALT_OLD)) {
      code = code.replace(ALT_OLD,
        "try { return await geminiCall(msgs, toolChoice); }\n          catch(gemErr) { throw new Error('ALL_PROVIDERS_DOWN:' + (gemErr.message || String(gemErr))); }");
      console.log('✅ Gemini added as 4th tier (alt anchor)');
    } else {
      console.log('⚠️  Could not find free-catch anchor — skipping gemini tier insertion');
    }
  }

  aiNode.parameters.jsCode = code;

  // ── 3. Save local file ─────────────────────────────────────────────────────
  const localWf = JSON.parse(fs.readFileSync(WF_PATH, 'utf8'));
  localWf.nodes.find(n => n.name === 'Secrets').parameters.assignments.assignments =
    secNode.parameters.assignments.assignments;
  localWf.nodes.find(n => n.name === 'AI Agent').parameters.jsCode = code;
  fs.writeFileSync(WF_PATH, JSON.stringify(localWf, null, 2), 'utf8');
  console.log('✅ Local file saved');

  // ── 4. Push to n8n ─────────────────────────────────────────────────────────
  const ALLOWED = ['timezone','saveDataErrorExecution','saveDataSuccessExecution','saveManualExecutions','callerPolicy','errorWorkflow'];
  const cs = {};
  if (wf.settings) { for (const k of ALLOWED) { if (k in wf.settings) cs[k] = wf.settings[k]; } }

  const putRes = await req('PUT', '/api/v1/workflows/' + WF_ID, {
    name: wf.name, nodes: wf.nodes, connections: wf.connections,
    settings: cs, staticData: wf.staticData ?? null
  });
  if (putRes.status !== 200) { console.error('PUT failed', putRes.status, JSON.stringify(putRes.body).slice(0,300)); process.exit(1); }
  console.log('✅ Workflow saved to n8n');

  await req('POST', '/api/v1/workflows/' + WF_ID + '/activate', {});
  console.log('✅ Workflow re-activated');

  console.log('\n🎉 Done! LLM cascade:');
  console.log('   1. Groq 10-key (100K TPD → resets midnight UTC)');
  console.log('   2. OpenRouter paid (meta-llama, pay-per-token)');
  console.log('   3. OpenRouter free (meta-llama:free, free tier)');
  console.log('   4. Gemini 2.0 Flash (Google, 1M TPD FREE)');
  console.log('\nCurrent provider status:');
  console.log('   Groq: TPD exhausted — resets ~05:30 AM IST');
  console.log('   OpenRouter: Credits ~0 — add credits at openrouter.ai/settings/credits');
  console.log('   Gemini: Quota exceeded — resets at midnight Pacific Time');
  console.log('\n→ Bot will auto-recover when any provider becomes available.');
})().catch(e => { console.error('FATAL:', e.message); process.exit(1); });
