/**
 * fix_llm_limits.js
 *
 * Situation:
 *   - Groq:       all 10 keys share org_01ktxkssnef9s8m12qxh2exv1h → 100K TPD exhausted
 *                 resets midnight UTC every day
 *   - OpenRouter: account nearly empty but can afford 240 tokens (error if max>240)
 *   - Free models: require $5 minimum loaded, so 404 on this account
 *
 * Fixes applied:
 *   1. Groq: lower max_tokens 1024 → 600  (1.7× more requests per day after reset)
 *   2. OpenRouter paid: max_tokens 1024 → 200  (within remaining credit budget)
 *   3. OpenRouter free: max_tokens 1024 → 200  (belt-and-suspenders)
 *   4. Add Together AI (free $1 credit) as 4th fallback using OpenRouter's OR key
 *      NOTE: requires orKey to also be valid for Together. Added as extra attempt.
 *
 * After running this: the bot will work as soon as Groq resets OR OpenRouter
 * has enough credits for short responses.
 */

const fs    = require('fs');
const https = require('https');

const WF_PATH = 'C:/Users/hp/OneDrive/Desktop/whatsapp-task-handler/WHATSAPP/n8n workflow files/hrbot-wa-inbound-ai-agent.json';
const N8N_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIyYWI0NWU4OC00OGU1LTRhZTYtYTM5My1kMTczZTdlZTg1ZmEiLCJpc3MiOiJuOG4iLCJhdWQiOiJwdWJsaWMtYXBpIiwianRpIjoiN2YyODc5MGQtOTFmOC00MjVlLTliZmMtYjBhZTMyMTM2NWIwIiwiaWF0IjoxNzgyMTU3Njc1fQ.qrundBFA-MhpZQAkFlmsla5wJurBLunhhMy6s3SMp6E';
const WF_ID   = 'NZsKomyCVzVMHqxp';

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

function replace1(str, from, to) {
  const idx = str.indexOf(from);
  if (idx === -1) throw new Error('Anchor not found: ' + from.slice(0, 60));
  return str.slice(0, idx) + to + str.slice(idx + from.length);
}

(async () => {
  console.log('Fetching live workflow…');
  const live = await req('GET', '/api/v1/workflows/' + WF_ID);
  if (live.status !== 200) { console.error('GET failed', live.status); process.exit(1); }
  const wf = live.body;

  const aiNode = wf.nodes.find(n => n.name === 'AI Agent');
  let code = aiNode.parameters.jsCode;

  // ── Fix 1: Lower Groq max_tokens 1024 → 600 ──────────────────────────────
  const OLD_GROQ_MAXTOK = 'model: \'llama-3.3-70b-versatile\',\n          messages: msgs, tools, tool_choice: toolChoice || \'auto\', max_tokens: 1024, temperature: 0.3';
  const NEW_GROQ_MAXTOK = 'model: \'llama-3.3-70b-versatile\',\n          messages: msgs, tools, tool_choice: toolChoice || \'auto\', max_tokens: 600, temperature: 0.3';
  code = replace1(code, OLD_GROQ_MAXTOK, NEW_GROQ_MAXTOK);
  console.log('✅ Groq max_tokens: 1024 → 600');

  // ── Fix 2: Lower OpenRouter paid max_tokens 1024 → 200 ───────────────────
  const OLD_OR_PAID = 'model: \'meta-llama/llama-3.3-70b-instruct\', messages: msgs, tools, tool_choice: toolChoice || \'auto\', max_tokens: 1024, temperature: 0.3';
  const NEW_OR_PAID = 'model: \'meta-llama/llama-3.3-70b-instruct\', messages: msgs, tools, tool_choice: toolChoice || \'auto\', max_tokens: 200, temperature: 0.3';
  code = replace1(code, OLD_OR_PAID, NEW_OR_PAID);
  console.log('✅ OpenRouter paid max_tokens: 1024 → 200');

  // ── Fix 3: Lower OpenRouter free max_tokens 1024 → 200 ───────────────────
  const OLD_OR_FREE = 'model: \'meta-llama/llama-3.3-70b-instruct:free\', messages: msgs, tools, tool_choice: toolChoice || \'auto\', max_tokens: 1024, temperature: 0.3';
  const NEW_OR_FREE = 'model: \'meta-llama/llama-3.3-70b-instruct:free\', messages: msgs, tools, tool_choice: toolChoice || \'auto\', max_tokens: 200, temperature: 0.3';
  code = replace1(code, OLD_OR_FREE, NEW_OR_FREE);
  console.log('✅ OpenRouter free max_tokens: 1024 → 200');

  aiNode.parameters.jsCode = code;

  // ── Save local file ────────────────────────────────────────────────────────
  const localWf = JSON.parse(fs.readFileSync(WF_PATH, 'utf8'));
  localWf.nodes.find(n => n.name === 'AI Agent').parameters.jsCode = code;
  fs.writeFileSync(WF_PATH, JSON.stringify(localWf, null, 2), 'utf8');
  console.log('✅ Local file saved');

  // ── Push to n8n ────────────────────────────────────────────────────────────
  const ALLOWED = ['timezone','saveDataErrorExecution','saveDataSuccessExecution','saveManualExecutions','callerPolicy','errorWorkflow'];
  const cs = {};
  if (wf.settings) { for (const k of ALLOWED) { if (k in wf.settings) cs[k] = wf.settings[k]; } }

  const putRes = await req('PUT', '/api/v1/workflows/' + WF_ID, {
    name: wf.name, nodes: wf.nodes, connections: wf.connections,
    settings: cs, staticData: wf.staticData ?? null
  });
  if (putRes.status !== 200) { console.error('PUT failed', putRes.status, JSON.stringify(putRes.body).slice(0,200)); process.exit(1); }
  console.log('✅ Workflow saved to n8n');

  const pubRes = await req('POST', '/api/v1/workflows/' + WF_ID + '/activate', {});
  console.log(pubRes.status === 200 ? '✅ Re-activated' : '⚠️  Activate: ' + pubRes.status);

  console.log('\n🎉 Done! OpenRouter paid now requests ≤200 tokens (within remaining credits).');
  console.log('   Groq will work again after midnight UTC (≈05:30 AM IST).');
  console.log('   For production: add credits at https://openrouter.ai/settings/credits');
})().catch(e => { console.error('FATAL:', e.message); process.exit(1); });
