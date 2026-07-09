const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { execFileSync } = require('node:child_process');

const read = path => fs.readFileSync(path, 'utf8');

test('every mutating bot tool is protected by the hard confirmation gate', () => {
  const source = read('src/lib/ai/agent.ts');
  const set = source.match(/const CONFIRM_BEFORE_EXEC = new Set\(\[([\s\S]*?)\]\);/)?.[1] ?? '';
  for (const tool of ['create_task','update_task','complete_task','delete_task','assign_task','apply_leave','approve_leave','reject_leave','cancel_leave','check_in','check_out','set_reminder','configure_reminders','add_task_note','start_onboarding']) {
    assert.match(set, new RegExp(`['"]${tool}['"]`), `${tool} must require confirmation`);
  }
});

test('tracked test utilities contain no embedded JWTs or internal bearer secrets', () => {
  const source = read('run_tests.js') + read('verify_upgrades.js');
  assert.doesNotMatch(source, /eyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}/);
  assert.doesNotMatch(source, /const\s+(?:N8N_KEY|WEBHOOK_SECRET)\s*=\s*['"]/);
});

test('source-controlled files contain no provider credentials', () => {
  const files = execFileSync('git', ['ls-files', '-co', '--exclude-standard'], { encoding: 'utf8' })
    .split(/\r?\n/)
    .filter(Boolean)
    .filter(path => /\.(?:js|json|ts|tsx|sql|md|ya?ml)$/i.test(path))
    .filter(path => !['package-lock.json', 'test/production-guards.test.js'].includes(path) && fs.existsSync(path));
  const secretPattern = /(github_pat_|sb_secret_|gsk_[A-Za-z0-9]|sk-or-v1-[A-Za-z0-9]{20,}|AIza[A-Za-z0-9_-]{20,}|EAAV[A-Za-z0-9]{20,}|eyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,})/;
  const offenders = files.filter(path => secretPattern.test(read(path)));
  assert.deepEqual(offenders, [], `credential-like values found in: ${offenders.join(', ')}`);
});

test('production cron does not trust a caller-controlled x-vercel-cron header', () => {
  assert.doesNotMatch(read('src/app/api/reminders/run/route.ts'), /x-vercel-cron/);
});

test('organization secrets migration revokes browser access', () => {
  const sql = read('supabase/migrations/202607060001_secure_org_secrets_and_rls.sql');
  assert.match(sql, /REVOKE ALL ON organization_secrets FROM anon, authenticated, PUBLIC/i);
  assert.match(sql, /security_invoker = true/i);
});

test('task-list requests use the deterministic fast path and reasoning leaks are blocked', () => {
  const source = read('src/lib/ai/agent.ts');
  assert.match(read('src/lib/ai/routing.ts'), /function quickTaskListArgs/);
  assert.match(source, /dispatchTool\('list_tasks', taskListArgs/);
  assert.match(source, /the user \(\?:is\|says\|wrote\|typed/);
  const webhookSource = read('src/app/api/webhooks/whatsapp/route.ts');
  assert.match(webhookSource, /looksLikeInternalReasoning/);
  assert.match(webhookSource, /text\.trim\(\)\.length > 900/);
});

test('task permissions allow organization-wide view/create/update but block employee deletion', () => {
  const executor = read('src/lib/ai/executor.ts');
  const taskApi = read('src/app/api/tasks/[id]/route.ts');
  assert.match(executor, /user_role === 'employee'[\s\S]{0,120}Employees cannot delete tasks/);
  assert.doesNotMatch(executor, /Employees can only create tasks for themselves/);
  assert.doesNotMatch(executor, /Employees can only update a task's status/);
  assert.match(taskApi, /profile\.role === 'employee'[\s\S]{0,120}Employees cannot delete tasks/);
});

test('WhatsApp inbox first render and refresh use the same recent organization log scope', () => {
  const page = read('src/app/(dashboard)/whatsapp/page.tsx');
  const api = read('src/app/api/wa-logs/route.ts');
  const ui = read('src/components/whatsapp/WAInterface.tsx');
  assert.match(page, /canViewOrganizationChats/);
  assert.match(page, /ascending:\s*false/);
  assert.match(page, /limit\(1000\)/);
  assert.match(api, /1000/);
  assert.match(ui, /wa-logs\?limit=1000/);
});

test('task creation and edit flows never silently select the first ambiguous assignee', () => {
  const agent = read('src/lib/ai/agent.ts');
  const executor = read('src/lib/ai/executor.ts');
  assert.match(agent, /partialMatches\.length > 1/);
  assert.match(agent, /Please use the full name/);
  assert.match(executor, /matchingUsers\?\.length/);
  assert.match(executor, /Multiple people match/);
  const createTaskExecutor = executor.match(/async CREATE_TASK[\s\S]*?async LIST_TASKS/)?.[0] ?? '';
  assert.doesNotMatch(createTaskExecutor, /ilike\('full_name',[\s\S]{0,100}limit\(1\)\.maybeSingle/);
});

test('agent recipient notifications are awaited, organization-scoped, and failure-aware', () => {
  const agent = read('src/lib/ai/agent.ts');
  assert.match(agent, /await sendUserNotifications\(result\.notify, orgId\)/);
  assert.match(agent, /await sendSmartText\(u\.wa_number, notif\.message, orgId,/);
  assert.match(agent, /\n\s*status,\s*\n/);
  assert.match(agent, /failure_reason/);
  assert.doesNotMatch(agent, /sendUserNotifications\(result\.notify, orgId\)\.catch/);
});

test('all mutation confirmations canonicalize database users, priority, and status before display', () => {
  const agent = read('src/lib/ai/agent.ts');
  assert.match(agent, /async function canonicalizeConfirmation/);
  assert.match(agent, /\.from\('users'\)\.select\('full_name'\)/);
  assert.match(agent, /PRIORITY_CANONICAL/);
  assert.match(agent, /STATUS_CANONICAL/);
  assert.match(agent, /const checked = await canonicalizeConfirmation\(parsed\.tool, parsed\.args, orgId\)/);
  assert.match(agent, /displayReply = buildToolConfirmation\(parsed\.tool, checked\.args\)/);
  assert.match(agent, /confirm_payload: \{ tool: parsed\.tool, args: checked\.args \}/);
});
