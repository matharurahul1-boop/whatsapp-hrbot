/**
 * update_keys.js — replace all 3 old Groq keys with 10 new ones
 */
const fs    = require('fs');
const https = require('https');

const WF_PATH = 'C:/Users/hp/OneDrive/Desktop/whatsapp-task-handler/WHATSAPP/n8n workflow files/hrbot-wa-inbound-ai-agent.json';
const N8N_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIyYWI0NWU4OC00OGU1LTRhZTYtYTM5My1kMTczZTdlZTg1ZmEiLCJpc3MiOiJuOG4iLCJhdWQiOiJwdWJsaWMtYXBpIiwianRpIjoiN2YyODc5MGQtOTFmOC00MjVlLTliZmMtYjBhZTMyMTM2NWIwIiwiaWF0IjoxNzgyMTU3Njc1fQ.qrundBFA-MhpZQAkFlmsla5wJurBLunhhMy6s3SMp6E';

const NEW_KEYS = [
  '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',
  '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',
  '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',
  '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',
  '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',
  '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',
  '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',
  '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',
  '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',
  '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'
];

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

(async () => {
  // ── Fetch live workflow ────────────────────────────────────────────────────
  console.log('Fetching live workflow from n8n…');
  const live = await req('GET', '/api/v1/workflows/NZsKomyCVzVMHqxp');
  const wf = live.body;

  // ── 1. Update Secrets node ─────────────────────────────────────────────────
  const secNode = wf.nodes.find(n => n.name === 'Secrets');
  const existing = secNode.parameters.assignments.assignments;

  // Keep non-Groq entries (supabase, openrouter) unchanged
  const nonGroq = existing.filter(a => !a.name.startsWith('groq_key'));

  // Build 10 new Groq key entries
  const groqEntries = NEW_KEYS.map((key, i) => ({
    id:    i === 0 ? 'groq-key' : 'groq_key_' + (i + 1),
    name:  i === 0 ? 'groq_key' : 'groq_key_' + (i + 1),
    value: key,
    type:  'string'
  }));

  secNode.parameters.assignments.assignments = [...groqEntries, ...nonGroq];
  console.log('✅ Secrets node: 10 Groq keys set, Supabase + OpenRouter preserved');

  // ── 2. Update AI Agent key variables + rotation ────────────────────────────
  const aiNode = wf.nodes.find(n => n.name === 'AI Agent');
  let code = aiNode.parameters.jsCode;

  // Expand key variable declarations (old 3 → new 10)
  const OLD_VARS = "const groqKey  = $('Secrets').item.json.groq_key;\nconst groqKey2 = $('Secrets').item.json.groq_key_2 || '';\nconst groqKey3 = $('Secrets').item.json.groq_key_3 || '';";
  const NEW_VARS  = [
    "const groqKey  = $('Secrets').item.json.groq_key;",
    "const groqKey2 = $('Secrets').item.json.groq_key_2  || '';",
    "const groqKey3 = $('Secrets').item.json.groq_key_3  || '';",
    "const groqKey4 = $('Secrets').item.json.groq_key_4  || '';",
    "const groqKey5 = $('Secrets').item.json.groq_key_5  || '';",
    "const groqKey6 = $('Secrets').item.json.groq_key_6  || '';",
    "const groqKey7 = $('Secrets').item.json.groq_key_7  || '';",
    "const groqKey8 = $('Secrets').item.json.groq_key_8  || '';",
    "const groqKey9 = $('Secrets').item.json.groq_key_9  || '';",
    "const groqKey10= $('Secrets').item.json.groq_key_10 || '';"
  ].join('\n');

  if (!code.includes(OLD_VARS)) {
    console.error('❌ Key vars anchor not found in AI Agent code');
    process.exit(1);
  }
  code = code.replace(OLD_VARS, NEW_VARS);
  console.log('✅ Key variable declarations: 3 → 10');

  // Expand the keys array in groqCall
  const OLD_ARR = 'const keys = [groqKey, groqKey2, groqKey3].filter(Boolean);';
  const NEW_ARR  = 'const keys = [groqKey,groqKey2,groqKey3,groqKey4,groqKey5,groqKey6,groqKey7,groqKey8,groqKey9,groqKey10].filter(Boolean);';

  if (!code.includes(OLD_ARR)) {
    console.error('❌ Keys array anchor not found');
    process.exit(1);
  }
  code = code.replace(OLD_ARR, NEW_ARR);
  console.log('✅ groqCall rotation: 3 → 10 keys');

  aiNode.parameters.jsCode = code;

  // ── 3. Save local file ─────────────────────────────────────────────────────
  const localWf = JSON.parse(fs.readFileSync(WF_PATH, 'utf8'));
  localWf.nodes.find(n => n.name === 'Secrets').parameters.assignments.assignments =
    secNode.parameters.assignments.assignments;
  localWf.nodes.find(n => n.name === 'AI Agent').parameters.jsCode = code;
  fs.writeFileSync(WF_PATH, JSON.stringify(localWf, null, 2), 'utf8');
  console.log('✅ Local workflow file saved');

  // ── 4. Push to n8n ─────────────────────────────────────────────────────────
  const ALLOWED = ['timezone','saveDataErrorExecution','saveDataSuccessExecution','saveManualExecutions','callerPolicy','errorWorkflow'];
  const cs = {};
  if (wf.settings) { for (const k of ALLOWED) { if (k in wf.settings) cs[k] = wf.settings[k]; } }

  const putRes = await req('PUT', '/api/v1/workflows/NZsKomyCVzVMHqxp', {
    name: wf.name, nodes: wf.nodes, connections: wf.connections,
    settings: cs, staticData: wf.staticData ?? null
  });
  if (putRes.status !== 200) {
    console.error('❌ PUT failed:', putRes.status, JSON.stringify(putRes.body).slice(0, 300));
    process.exit(1);
  }
  console.log('✅ Workflow updated on n8n');

  const pubRes = await req('POST', '/api/v1/workflows/NZsKomyCVzVMHqxp/activate', {});
  console.log(pubRes.status === 200 ? '✅ Published' : '⚠️  Publish: ' + pubRes.status);

  console.log('\n🎉 All 10 Groq keys are live — bot should respond immediately!');
})().catch(e => { console.error('FATAL:', e.message); process.exit(1); });
