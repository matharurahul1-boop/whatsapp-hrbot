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
  assert.match(source, /the user \(\?:says\|wrote\|typed/);
  assert.match(read('src/app/api/webhooks/whatsapp/route.ts'), /looksLikeInternalReasoning/);
});
