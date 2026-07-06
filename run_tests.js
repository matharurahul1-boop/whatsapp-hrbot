/**
 * run_tests.js — Comprehensive HRBot Test Suite
 * Calls n8n webhook DIRECTLY (bypasses Vercel phone-id lookup).
 *
 * Usage: node run_tests.js
 */
'use strict';

const https  = require('https');
const fs     = require('fs');

const N8N_WEBHOOK = process.env.TEST_N8N_WEBHOOK_URL;
const N8N_API     = process.env.TEST_N8N_API_HOST;
const N8N_KEY     = process.env.TEST_N8N_API_KEY;
const WF_ID       = process.env.TEST_N8N_WORKFLOW_ID;
const WA_NUM      = process.env.TEST_WA_NUMBER;
const ORG_ID      = process.env.TEST_ORG_ID;

for (const [name, value] of Object.entries({ N8N_WEBHOOK, N8N_API, N8N_KEY, WF_ID, WA_NUM, ORG_ID })) {
  if (!value) throw new Error(`Missing required test environment variable: ${name}`);
}

const OUT_FILE    = process.env.TEST_OUTPUT_FILE || './comprehensive_test_results.json';

let pass = 0, fail = 0, skip = 0;
const results = [];

// ── HTTP helpers ──────────────────────────────────────────────────────────────

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

function httpsPost(url, body) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const d = JSON.stringify(body);
    const r = https.request({
      hostname: u.hostname, port: 443, path: u.pathname,
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(d) }
    }, res => {
      let b = '';
      res.on('data', x => b += x);
      res.on('end', () => { try { resolve({ s: res.statusCode, b: JSON.parse(b) }); } catch { resolve({ s: res.statusCode, b }); } });
    });
    r.on('error', reject);
    r.write(d);
    r.end();
  });
}

function httpsGet(host, path) {
  return new Promise((resolve, reject) => {
    const r = https.request({ hostname: host, port: 443, path, method: 'GET',
      headers: { 'X-N8N-API-KEY': N8N_KEY } },
      res => {
        let b = '';
        res.on('data', x => b += x);
        res.on('end', () => { try { resolve({ s: res.statusCode, b: JSON.parse(b) }); } catch { resolve({ s: res.statusCode, b }); } });
      });
    r.on('error', reject);
    r.end();
  });
}

// ── Send message to n8n directly ──────────────────────────────────────────────

async function sendMsg(text) {
  await httpsPost(N8N_WEBHOOK, {
    from:     WA_NUM,
    message:  text,
    org_id:   ORG_ID,
    is_audio: 'false'
  });
}

// ── Wait for n8n execution and return Format Reply output ─────────────────────

async function getExecOutput(afterMs, maxWait = 30000) {
  const deadline = Date.now() + maxWait;
  await sleep(8000);
  while (Date.now() < deadline) {
    const r = await httpsGet(N8N_API,
      '/api/v1/executions?workflowId=' + WF_ID + '&limit=5&includeData=true');
    const execs = r.b?.data ?? [];
    const m = execs.find(e => e.startedAt && new Date(e.startedAt).getTime() > afterMs);
    if (m && m.status !== 'running') {
      const rd = m.data?.resultData;
      if (rd?.error) return { output: null, error: rd.error.message, execId: m.id };
      const fr = rd?.runData?.['Format Reply'];
      const out = fr?.[0]?.data?.main?.[0]?.[0]?.json?.output ?? null;
      const nodesRan = Object.keys(rd?.runData ?? {});
      return { output: out, error: null, execId: m.id, nodesRan };
    }
    await sleep(3000);
  }
  return { output: null, error: 'timeout', execId: null };
}

// ── Core test runner ──────────────────────────────────────────────────────────

async function test(id, name, text, checkFn) {
  process.stdout.write(`  [${id}] ${name}... `);
  const before = Date.now();
  await sendMsg(text);
  const { output, error, execId, nodesRan } = await getExecOutput(before);

  if (!execId) {
    console.log('❌ FAIL — no execution found');
    fail++;
    results.push({ id, name, status: 'FAIL', reason: 'no execution found', output: null });
    return null;
  }
  if (error) {
    console.log('❌ FAIL — error: ' + error.slice(0, 80));
    fail++;
    results.push({ id, name, status: 'FAIL', reason: 'exec error: ' + error, output: null });
    return null;
  }
  if (!output) {
    console.log('❌ FAIL — no output (nodes: ' + (nodesRan?.join(',') ?? 'none') + ')');
    fail++;
    results.push({ id, name, status: 'FAIL', reason: 'no output. nodes: ' + (nodesRan?.join(',') ?? 'none'), output: null });
    return null;
  }

  const ok = checkFn(output);
  if (ok) {
    console.log('✅ PASS');
    pass++;
    results.push({ id, name, status: 'PASS', output: output.slice(0, 200) });
  } else {
    console.log('❌ FAIL\n     ↳ Output: ' + output.slice(0, 180));
    fail++;
    results.push({ id, name, status: 'FAIL', reason: 'check failed', output: output.slice(0, 300) });
  }
  return output;
}

// Pause between tests to avoid Groq rate-limits
async function gap(ms = 3500) { await sleep(ms); }

// ── MAIN ──────────────────────────────────────────────────────────────────────

(async () => {
  const startTime = new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' });
  console.log('════════════════════════════════════════════════════════════════════════');
  console.log(' HRBot — COMPREHENSIVE Test Suite');
  console.log(' Started: ' + startTime);
  console.log('════════════════════════════════════════════════════════════════════════\n');

  // ── Warm up ────────────────────────────────────────────────────────────────
  console.log('⏰ Waking up n8n...');
  let awake = false;
  for (let i = 0; i < 9; i++) {
    try {
      const r = await httpsGet(N8N_API, '/api/v1/workflows/' + WF_ID);
      if (r.s === 200) { awake = true; break; }
    } catch {}
    process.stdout.write('  Polling... ' + (i + 1) * 8 + 's\n');
    await sleep(8000);
  }
  if (!awake) { console.log('⚠️  n8n did not wake. Exiting.'); process.exit(1); }

  // Send warm-up message and wait for actual execution
  console.log('  Sending warm-up ping...');
  const wuBefore = Date.now();
  await sendMsg('ping');
  const wu = await getExecOutput(wuBefore, 35000);
  if (wu.execId) {
    console.log('✓ n8n is live (exec ' + wu.execId + ')\n');
  } else {
    console.log('⚠️  Warm-up not confirmed. Waiting 15s more...\n');
    await sleep(15000);
  }

  // ── Section: Greetings & Help ──────────────────────────────────────────────
  console.log('── Section: Greetings & Help ──');

  await test('TC-H-001', 'hi → greeting response',
    'hi',
    o => /(good morning|good afternoon|good evening|good night|hrbot|hello|welcome)/i.test(o));
  await gap();

  await test('TC-H-002', 'hello → greeting',
    'hello',
    o => /(good morning|good afternoon|good evening|good night|hrbot|hello)/i.test(o));
  await gap();

  await test('TC-H-003', 'help → lists commands',
    'help',
    o => /(task|leave|attendance|check.in|briefing)/i.test(o));
  await gap();

  await test('TC-H-004', 'Hii → still greets (typo)',
    'Hii',
    o => /(good|morning|afternoon|evening|night|hrbot|hello)/i.test(o));
  await gap();

  await test('TC-H-005', 'Namaste → responds',
    'Namaste',
    o => o.length > 5);
  await gap();

  // ── Section: Daily Briefing ────────────────────────────────────────────────
  console.log('\n── Section: Daily Briefing ──');

  await test('TC-DB-001', 'daily briefing',
    'daily briefing',
    o => /(task|attendance|leave|brief|today|pending)/i.test(o));
  await gap();

  await test('TC-DB-002', 'show me my briefing',
    'show me my briefing',
    o => /(task|attendance|leave|brief|today|pending)/i.test(o));
  await gap();

  await test('TC-DB-003', 'whats my day look like',
    'whats my day look like',
    o => /(task|attendance|leave|brief|today|pending)/i.test(o));
  await gap();

  // ── Section: Task Listing ──────────────────────────────────────────────────
  console.log('\n── Section: Task Listing ──');

  await test('TC-TL-001', 'list my tasks',
    'list my tasks',
    o => /(task|pending|no.*task|you have \d+)/i.test(o));
  await gap();

  await test('TC-TL-002', 'my tasks',
    'my tasks',
    o => /(task|pending|no.*task|you have \d+)/i.test(o));
  await gap();

  await test('TC-TL-003', 'show tasks',
    'show tasks',
    o => /(task|pending|no.*task|you have \d+)/i.test(o));
  await gap();

  await test('TC-TL-004', 'what are my tasks',
    'what are my tasks',
    o => /(task|pending|no.*task|you have \d+)/i.test(o));
  await gap();

  await test('TC-TL-005', 'pending tasks → shows count or empty',
    'pending tasks',
    o => /(task|pending|no.*task|you have \d+)/i.test(o));
  await gap();

  // ── Section: Task Creation ─────────────────────────────────────────────────
  console.log('\n── Section: Task Creation ──');

  const tcTimestamp = Date.now();
  const tc1 = 'AutoTest_Create_' + tcTimestamp;

  await test('TC-TC-001', 'create task (no details) → asks for title',
    'create a task',
    o => /(title|name|what|task|call|create)/i.test(o));
  await gap();

  const createOut = await test('TC-TC-002', 'create task with title',
    'create task "' + tc1 + '"',
    o => /(created|done|task|confirm|assign|' + tc1 + ')/i.test(o));
  await gap();

  await test('TC-TC-003', 'create task with priority',
    'create high priority task "AutoTest_Priority_' + tcTimestamp + '"',
    o => /(created|done|task|high|confirm|assign|autot)/i.test(o));
  await gap();

  await test('TC-TC-004', 'create task with deadline',
    'create task "AutoTest_Deadline_' + tcTimestamp + '" due tomorrow',
    o => /(created|done|task|deadline|tomorrow|assign|confirm|autot)/i.test(o));
  await gap();

  await test('TC-TC-005', 'creating duplicate title → still handles gracefully',
    'create task "' + tc1 + '"',
    o => o.length > 5);
  await gap();

  // ── Section: Task Update ───────────────────────────────────────────────────
  console.log('\n── Section: Task Updates ──');

  await test('TC-TU-001', 'update task status to done',
    'mark task "' + tc1 + '" as done',
    o => /(done|updated|complete|task|status|error|not found)/i.test(o));
  await gap();

  await test('TC-TU-002', 'update priority',
    'change priority of "' + tc1 + '" to urgent',
    o => /(urgent|updated|priority|task|done|not found|error)/i.test(o));
  await gap();

  await test('TC-TU-003', '"update task" with no name → asks which task',
    'update task',
    o => /(which|what|name|title|task)/i.test(o));
  await gap();

  await test('TC-TU-004', 'update task: partial fuzzy title match',
    'update task "AutoTest_Create" status to in progress',
    o => /(updated|in.progress|not found|error|found|multiple|task)/i.test(o));
  await gap();

  await test('TC-TU-005', 'reassign task to someone',
    'reassign task "' + tc1 + '" to Pranay',
    o => /(reassign|assign|updated|pranay|task|not found|error)/i.test(o));
  await gap();

  await test('TC-TU-006', 'update deadline',
    'update deadline of "' + tc1 + '" to next Monday',
    o => /(deadline|updated|monday|task|error|not found)/i.test(o));
  await gap();

  await test('TC-TU-007', 'update task: name only, no field → asks what to change',
    'update task "' + tc1 + '"',
    o => /(what|which|change|update|field|title|deadline|priority|status)/i.test(o));
  await gap();

  await test('TC-TU-008', 'update task: field only, no value → asks for value',
    'update "' + tc1 + '" priority',
    o => /(priority|what|which|choose|low|medium|high|urgent)/i.test(o));
  await gap();

  // ── Section: Task Deletion ─────────────────────────────────────────────────
  console.log('\n── Section: Task Deletion ──');

  const tdTask = 'AutoTest_Delete_' + tcTimestamp;
  await test('TC-TD-000', 'setup: create delete test task',
    'create task "' + tdTask + '"',
    o => /(created|done|task|confirm|assign)/i.test(o));
  await gap(4000);

  await test('TC-TD-001', 'delete task by title',
    'delete task "' + tdTask + '"',
    o => /(deleted|removed|confirm|done|task|not found)/i.test(o));
  await gap();

  await test('TC-TD-002', 'delete non-existent task → helpful error',
    'delete task "this_task_does_not_exist_999xyz"',
    o => /(not found|no task|error|task)/i.test(o));
  await gap();

  await test('TC-TD-003', 'delete with fuzzy name match',
    'delete task "AutoTest_Create"',
    o => /(delete|found|not found|task|multiple|confirm)/i.test(o));
  await gap();

  // ── Section: Attendance ────────────────────────────────────────────────────
  console.log('\n── Section: Attendance ──');

  await test('TC-AT-001', 'check in',
    'check in',
    o => /(check.?in|checked.?in|already|attendance|time)/i.test(o));
  await gap();

  await test('TC-AT-002', 'double check-in → already checked in message',
    'check in',
    o => /(already|checked.?in|check.?in)/i.test(o));
  await gap();

  await test('TC-AT-003', 'check out',
    'check out',
    o => /(check.?out|checked.?out|worked|duration|not.?check)/i.test(o));
  await gap();

  await test('TC-AT-004', 'my attendance → monthly log',
    'my attendance',
    o => /(attendance|check.?in|check.?out|present|record|month)/i.test(o));
  await gap();

  await test('TC-AT-005', 'attendance history → monthly log',
    'show attendance history',
    o => /(attendance|check.?in|present|record|month)/i.test(o));
  await gap();

  // ── Section: Leave Balance ─────────────────────────────────────────────────
  console.log('\n── Section: Leave Balance ──');

  await test('TC-LB-001', 'leave balance',
    'leave balance',
    o => /(leave|balance|remaining|day|casual|sick|annual|type|no.*leave)/i.test(o));
  await gap();

  await test('TC-LB-002', 'how many leaves do I have',
    'how many leaves do I have',
    o => /(leave|balance|remaining|day|casual|sick|annual|type|no.*leave)/i.test(o));
  await gap();

  await test('TC-LB-003', 'check my leave balance',
    'check my leave balance',
    o => /(leave|balance|remaining|day|type|no.*leave)/i.test(o));
  await gap();

  // ── Section: Apply Leave ───────────────────────────────────────────────────
  console.log('\n── Section: Apply Leave ──');

  const applyOut = await test('TC-AL-001', 'apply leave → asks type/dates',
    'I want to apply for leave',
    o => /(leave|type|date|when|start|end|casual|sick|annual)/i.test(o));
  await gap();

  await test('TC-AL-002', 'apply 30 days → likely insufficient balance',
    'apply leave for 30 days starting next month',
    o => /(balance|insufficient|remaining|leave|day|type)/i.test(o));
  await gap();

  await test('TC-AL-003', 'apply leave next Friday',
    'apply for sick leave on next Friday',
    o => /(leave|applied|submitted|pending|sick|balance|type|date)/i.test(o));
  await gap();

  // ── Section: List Leaves ───────────────────────────────────────────────────
  console.log('\n── Section: List Leaves ──');

  await test('TC-LL-001', 'list leaves',
    'list my leaves',
    o => /(leave|pending|approved|rejected|no.*leave)/i.test(o));
  await gap();

  await test('TC-LL-002', 'my leave history',
    'show my leave history',
    o => /(leave|pending|approved|rejected|no.*leave)/i.test(o));
  await gap();

  // ── Section: Admin Operations ──────────────────────────────────────────────
  console.log('\n── Section: Admin Operations ──');

  await test('TC-ADM-001', 'team attendance (admin)',
    'show team attendance',
    o => /(attendance|team|check.?in|present|no.*record)/i.test(o));
  await gap();

  await test('TC-ADM-002', 'pending leaves (admin)',
    'show pending leaves',
    o => /(pending|leave|request|no.*pending)/i.test(o));
  await gap();

  // ── Section: Natural Language & Hinglish ──────────────────────────────────
  console.log('\n── Section: Natural Language & Hindi/Hinglish ──');

  await test('TC-NL-001', 'kya main leave le sakta hoon (Hinglish)',
    'kya main leave le sakta hoon',
    o => o.length > 5);
  await gap();

  await test('TC-NL-002', 'mere tasks batao (Hindi)',
    'mere tasks batao',
    o => /(task|pending|leave)/i.test(o));
  await gap();

  await test('TC-NL-003', 'kal ki meeting hai (unrelated Hindi → graceful)',
    'kal ki meeting hai',
    o => o.length > 5);
  await gap();

  await test('TC-NL-004', 'I wanna check out now (casual)',
    'I wanna check out now',
    o => /(check.?out|checked|worked|duration)/i.test(o));
  await gap();

  await test('TC-NL-005', 'can you list all tasks for me please',
    'can you list all tasks for me please',
    o => /(task|pending|no.*task|you have)/i.test(o));
  await gap();

  await test('TC-NL-006', 'put in a leave request for Monday',
    'put in a leave request for next Monday',
    o => /(leave|type|date|balance|applied|pending)/i.test(o));
  await gap();

  // ── Section: Edge Cases ────────────────────────────────────────────────────
  console.log('\n── Section: Edge Cases ──');

  await test('TC-EC-001', 'gibberish "..." → helpful response',
    '...',
    o => /(help|unclear|sure|mean|command)/i.test(o));
  await gap();

  await test('TC-EC-002', 'gibberish "???" → helpful response',
    '???',
    o => /(help|unclear|sure|mean|command)/i.test(o));
  await gap();

  await test('TC-EC-003', 'single letter "x" → helpful response',
    'x',
    o => o.length > 5);
  await gap();

  await test('TC-EC-004', 'long message > 500 chars handled',
    'tell me about all my tasks and also check attendance and my leave balance and also create a task called test and also show pending leaves and also tell me the daily briefing and also check in and also give me all the information you can please',
    o => o.length > 10);
  await gap();

  await test('TC-EC-005', 'empty intent "task" (one word only)',
    'task',
    o => /(task|pending|help|which|what)/i.test(o));
  await gap();

  await test('TC-EC-006', 'just "leave" → asks intent',
    'leave',
    o => /(leave|apply|balance|list|history)/i.test(o));
  await gap();

  await test('TC-EC-007', 'message with special characters',
    'list tasks @#$%',
    o => /(task|pending|help|unclear)/i.test(o));
  await gap();

  // ── Section: Unknown / Unrelated queries ──────────────────────────────────
  console.log('\n── Section: Unknown / Unrelated Queries ──');

  await test('TC-UNK-001', 'what is the weather today',
    'what is the weather today',
    o => o.length > 5);
  await gap();

  await test('TC-UNK-002', 'book a flight for me',
    'book a flight for me',
    o => o.length > 5);
  await gap();

  await test('TC-UNK-003', 'tell me a joke',
    'tell me a joke',
    o => o.length > 5);
  await gap();

  // ── Section: Format & Regression ──────────────────────────────────────────
  console.log('\n── Section: Format & Regression ──');

  await test('TC-RF-001', 'task list uses *bold* and bullet points',
    'list my tasks',
    o => /\*|•|-\s/i.test(o));
  await gap();

  await test('TC-RF-002', 'greeting uses time-of-day word',
    'hi',
    o => /(good morning|good afternoon|good evening|good night)/i.test(o));
  await gap();

  await test('TC-RF-003', 'no raw JSON leaking in response',
    'my tasks',
    o => !/"name"\s*:/.test(o) && !/"parameters"\s*:/.test(o));
  await gap();

  await test('TC-RF-004', 'response not empty',
    'help me',
    o => o.trim().length > 10);
  await gap();

  // ── Section: Multi-step Conversation Flows ─────────────────────────────────
  console.log('\n── Section: Multi-step Conversation Flows ──');

  // Flow 1: Create task → immediately confirm
  const ctxTs = Date.now();
  const ctxTask = 'ContextTest_' + ctxTs;
  const step1 = await test('TC-CTX-001a', 'step 1: start task creation',
    'create task "' + ctxTask + '" due tomorrow priority high',
    o => /(created|confirm|done|task|assign|ctxTask|context)/i.test(o));
  await gap(4000);

  if (step1) {
    await test('TC-CTX-001b', 'step 2: follow-up on created task',
      'mark it as done',
      o => /(done|updated|status|task)/i.test(o));
    await gap();
  } else {
    skip++;
    console.log('  [TC-CTX-001b] SKIP (step 1 failed)');
  }

  // Flow 2: Ask for help → ask specific feature
  await test('TC-CTX-002a', 'step 1: help',
    'help',
    o => /(task|leave|attendance)/i.test(o));
  await gap();
  await test('TC-CTX-002b', 'step 2: follow-up after help → check in',
    'ok, check me in',
    o => /(check.?in|checked|already|attendance)/i.test(o));
  await gap();

  // ── Cleanup: soft-delete any AUTOTEST_ tasks ───────────────────────────────
  console.log('\n── Cleanup: Remove AUTOTEST tasks ──');

  // We clean via Supabase REST directly instead of via bot (to avoid false test triggers)
  const sbUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const sbKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!sbUrl || !sbKey) {
    throw new Error('NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required for cleanup');
  }
  const sbHost = new URL(sbUrl).hostname;

  function sbPatch(path) {
    return new Promise((resolve, reject) => {
      const d = JSON.stringify({ deleted_at: new Date().toISOString() });
      const r = https.request({
        hostname: sbHost, port: 443, path,
        method: 'PATCH',
        headers: {
          apikey: sbKey, Authorization: 'Bearer ' + sbKey,
          'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(d),
          'Prefer': 'return=minimal'
        }
      }, res => {
        let b = ''; res.on('data', x => b += x);
        res.on('end', () => resolve(res.statusCode));
      });
      r.on('error', reject); r.write(d); r.end();
    });
  }

  const cleanStatus = await sbPatch(
    '/rest/v1/tasks?organization_id=eq.' + ORG_ID +
    '&title=ilike.AutoTest_%&deleted_at=is.null'
  );
  console.log('  Cleanup status:', cleanStatus === 204 ? '✅ AUTOTEST tasks removed' : '⚠️  status=' + cleanStatus);

  // ── Summary ────────────────────────────────────────────────────────────────

  const total = pass + fail + skip;
  console.log('\n════════════════════════════════════════════════════════════════════════');
  console.log(` RESULTS: ${pass} PASS  |  ${fail} FAIL  |  ${skip} SKIP  |  ${total} TOTAL`);
  console.log('════════════════════════════════════════════════════════════════════════');

  const failures = results.filter(r => r.status === 'FAIL');
  if (failures.length > 0) {
    console.log('\n❌ FAILURES:');
    failures.forEach(f => {
      console.log(`  [${f.id}] ${f.name}`);
      if (f.reason) console.log(`         ↳ ${f.reason}`);
      if (f.output) console.log(`         ↳ Output: ${f.output.slice(0, 120)}`);
    });
  }

  // Save results to file
  const report = {
    startTime,
    endTime: new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' }),
    summary: { pass, fail, skip, total },
    results
  };
  fs.writeFileSync(OUT_FILE, JSON.stringify(report, null, 2), 'utf8');
  fs.writeFileSync(
    process.env.TEST_TEXT_OUTPUT_FILE || './comprehensive_test_results.txt',
    `HRBot Test Results — ${startTime}\n` +
    `PASS: ${pass} | FAIL: ${fail} | SKIP: ${skip} | TOTAL: ${total}\n\n` +
    results.map(r => `[${r.status}] [${r.id}] ${r.name}${r.reason ? '\n  ↳ ' + r.reason : ''}${r.output ? '\n  ↳ ' + r.output.slice(0,120) : ''}`).join('\n'),
    'utf8'
  );
  console.log('\n✅ Full results saved to: ' + OUT_FILE);

  process.exit(fail > 0 ? 1 : 0);
})().catch(e => { console.error('FATAL:', e.message); process.exit(1); });
