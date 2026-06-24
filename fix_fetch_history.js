/**
 * fix_fetch_history.js
 * Fixes the Fetch History node so it always outputs ≥1 item,
 * even when wa_bot_sessions returns [] for new users.
 *
 * Root cause: n8n HTTP Request (typeVersion 4.2) with an empty-array
 * JSON response creates 0 output items → all downstream nodes are skipped.
 * Fix: set alwaysOutputData:true on the node (standard n8n node property).
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
        'X-N8N-API-KEY': N8N_KEY,
        'Content-Type': 'application/json',
        ...(data ? { 'Content-Length': Buffer.byteLength(data) } : {})
      }
    }, res => {
      let b = '';
      res.on('data', d => b += d);
      res.on('end', () => {
        try { resolve({ status: res.statusCode, body: JSON.parse(b) }); }
        catch { resolve({ status: res.statusCode, body: b }); }
      });
    });
    r.on('error', reject);
    if (data) r.write(data);
    r.end();
  });
}

(async () => {
  // ── 1. Fetch live workflow ─────────────────────────────────────────────────
  console.log('Fetching live workflow…');
  const live = await req('GET', '/api/v1/workflows/' + WF_ID);
  if (live.status !== 200) {
    console.error('❌ GET failed:', live.status, JSON.stringify(live.body).slice(0, 200));
    process.exit(1);
  }
  const wf = live.body;

  // ── 2. Patch Fetch History node ────────────────────────────────────────────
  const fhNode = wf.nodes.find(n => n.name === 'Fetch History');
  if (!fhNode) {
    console.error('❌ "Fetch History" node not found in workflow');
    process.exit(1);
  }

  // alwaysOutputData is a standard top-level n8n node property
  fhNode.alwaysOutputData = true;
  console.log('✅ Set alwaysOutputData:true on Fetch History node');

  // ── 3. Also update local file ──────────────────────────────────────────────
  const localWf = JSON.parse(fs.readFileSync(WF_PATH, 'utf8'));
  const localFh = localWf.nodes.find(n => n.name === 'Fetch History');
  if (localFh) {
    localFh.alwaysOutputData = true;
    fs.writeFileSync(WF_PATH, JSON.stringify(localWf, null, 2), 'utf8');
    console.log('✅ Local workflow file updated');
  }

  // ── 4. Push back to n8n ────────────────────────────────────────────────────
  const ALLOWED = ['timezone','saveDataErrorExecution','saveDataSuccessExecution',
                   'saveManualExecutions','callerPolicy','errorWorkflow'];
  const cs = {};
  if (wf.settings) {
    for (const k of ALLOWED) { if (k in wf.settings) cs[k] = wf.settings[k]; }
  }

  const putRes = await req('PUT', '/api/v1/workflows/' + WF_ID, {
    name:        wf.name,
    nodes:       wf.nodes,
    connections: wf.connections,
    settings:    cs,
    staticData:  wf.staticData ?? null
  });
  if (putRes.status !== 200) {
    console.error('❌ PUT failed:', putRes.status, JSON.stringify(putRes.body).slice(0, 300));
    process.exit(1);
  }
  console.log('✅ Workflow saved to n8n');

  // ── 5. Re-activate ────────────────────────────────────────────────────────
  const pubRes = await req('POST', '/api/v1/workflows/' + WF_ID + '/activate', {});
  if (pubRes.status === 200) {
    console.log('✅ Workflow re-activated');
  } else {
    console.log('⚠️  Activate returned:', pubRes.status);
  }

  console.log('\n🎉 Fix deployed! Fetch History now always outputs at least 1 item.');
  console.log('   First-time users (no session) will work correctly.');
})().catch(e => { console.error('FATAL:', e.message); process.exit(1); });
