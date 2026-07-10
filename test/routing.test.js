const test = require('node:test');
const assert = require('node:assert/strict');

let routing;
test.before(async () => {
  routing = await import('../src/lib/ai/routing.ts');
});

test('normalizes common action spelling mistakes without changing names', () => {
  assert.equal(routing.normalizeCommandText('udpate priorty of Payroll taks'), 'update priority of Payroll task');
  assert.equal(routing.normalizeCommandText('aproove leav for Mahima'), 'approve leave for Mahima');
  assert.equal(routing.normalizeCommandText('chekin attendence'), 'checkin attendance');
});

test('routes self, team, person, typo, and completed task-list requests', () => {
  assert.deepEqual(routing.quickTaskListArgs('my tasks'), { assignee_name: 'mine' });
  assert.deepEqual(routing.quickTaskListArgs('list of tasks'), { scope: 'all' });
  assert.deepEqual(routing.quickTaskListArgs('show tasks'), { scope: 'all' });
  assert.deepEqual(routing.quickTaskListArgs('list all tasks'), { scope: 'all' });
  assert.deepEqual(routing.quickTaskListArgs('list of all tasks'), { scope: 'all' });
  assert.deepEqual(routing.quickTaskListArgs('list of all completed tasks'), { status_filter: 'done', scope: 'all' });
  assert.deepEqual(routing.quickTaskListArgs('list of all to do tasks'), { status_filter: 'todo', scope: 'all' });
  assert.deepEqual(routing.quickTaskListArgs('list of all in progress tasks'), { status_filter: 'in_progress', scope: 'all' });
  assert.deepEqual(routing.quickTaskListArgs('list of all cancelled tasks'), { status_filter: 'cancelled', scope: 'all' });
  assert.deepEqual(routing.quickTaskListArgs('list of entire tasks'), { scope: 'all' });
  assert.deepEqual(routing.quickTaskListArgs('show whole task list'), { scope: 'all' });
  assert.deepEqual(routing.quickTaskListArgs('List of all my tasks'), { assignee_name: 'mine' });
  assert.deepEqual(routing.quickTaskListArgs('all my completed tasks'), { status_filter: 'done', assignee_name: 'mine' });
  for (const message of [
    'list of every task',
    'show each task',
    "show everyone's tasks",
    "list everybody's tasks",
    'list all employee tasks',
    'show tasks for all users',
    'show full task list',
    'show complete task list',
    'get total task list',
    'list organization-wide tasks',
    'show company wide tasks',
    'display tasks across the team',
    'list workforce tasks',
  ]) {
    assert.deepEqual(routing.quickTaskListArgs(message), { scope: 'all' }, message);
  }
  assert.deepEqual(routing.quickTaskListArgs('show team tasks'), { scope: 'all' });
  assert.deepEqual(routing.quickTaskListArgs("List of mahima's tasks"), { assignee_name: 'mahima' });
  assert.deepEqual(routing.quickTaskListArgs('show Prnay tasks'), { assignee_name: 'Prnay' });
  assert.deepEqual(routing.quickTaskListArgs('my completed taks'), { status_filter: 'done', assignee_name: 'mine' });
  assert.deepEqual(routing.quickTaskListArgs("show Mahima's completed tasks"), { status_filter: 'done', assignee_name: 'Mahima' });
  assert.deepEqual(routing.quickTaskListArgs("show Mahima's in progress tasks"), { status_filter: 'in_progress', assignee_name: 'Mahima' });
  assert.deepEqual(routing.quickTaskListArgs('my pending tasks'), { status_filter: 'active', assignee_name: 'mine' });
  assert.deepEqual(routing.quickTaskListArgs('give me my tasks'), { assignee_name: 'mine' });
  assert.deepEqual(routing.quickTaskListArgs('give me list of his task'), { assignee_name: 'his' });
  assert.deepEqual(routing.quickTaskListArgs('please send me list of her tasks'), { assignee_name: 'her' });
});

test('bare "<name> <status> tasks" with no possessive/prefix resolves to the named person', () => {
  // Previously fell through this quick-route (returned scope:'all' or null)
  // because none of the personPatterns matched a bare name with no
  // possessive, verb prefix, or preposition — observed live: "Ashish pending
  // tasks" incorrectly returned the org-wide "All To Do tasks" list.
  // status_filter is 'active' (todo + in_progress) — "pending" means "not
  // yet done" in everyday usage, broader than strictly not-started.
  assert.deepEqual(routing.quickTaskListArgs('Ashish pending tasks'), { status_filter: 'active', assignee_name: 'Ashish' });
  assert.deepEqual(routing.quickTaskListArgs('Rashmi completed tasks'), { status_filter: 'done', assignee_name: 'Rashmi' });
  // "in progress" wasn't recognized by the old hardcoded trigger-word list
  // even though requestedTaskStatus() already understood it — this message
  // used to bypass the deterministic route entirely (returned null).
  assert.deepEqual(routing.quickTaskListArgs('Tushar in progress tasks'), { status_filter: 'in_progress', assignee_name: 'Tushar' });
  // Bare command verbs must never be captured as a "name" by the new
  // catch-all bare-name pattern.
  assert.deepEqual(routing.quickTaskListArgs('show tasks'), { scope: 'all' });
  assert.deepEqual(routing.quickTaskListArgs('pending tasks'), { status_filter: 'active', scope: 'all' });
});

test('"pending"/"open" cover both To Do and In Progress tasks, unlike strict "to do"', () => {
  assert.deepEqual(routing.quickTaskListArgs('open tasks'), { status_filter: 'active', scope: 'all' });
  // "to do"/"todo" itself stays strictly not-started — only "pending"/"open"
  // are treated as the broader "not yet done" category.
  assert.deepEqual(routing.quickTaskListArgs('to do tasks'), { status_filter: 'todo', scope: 'all' });
  assert.deepEqual(routing.quickTaskListArgs('todo tasks'), { status_filter: 'todo', scope: 'all' });
});

test('"<name>\'s all tasks" names a specific person, not the whole org', () => {
  // Observed live: "Rashmi's all tasks" returned the org-wide "All tasks"
  // list instead of Rashmi's own tasks — the bare "all" keyword was
  // short-circuiting to org-wide scope before the possessive name ("Rashmi")
  // ever got a chance to be extracted.
  assert.deepEqual(routing.quickTaskListArgs("Rashmi's all tasks"), { assignee_name: 'Rashmi' });
  assert.deepEqual(routing.quickTaskListArgs("rashmi's all tasks"), { assignee_name: 'rashmi' });
  // Generic all-scope possessives (no real person named) must still resolve
  // to org-wide scope, not be misread as a person named "everyone"/"team".
  assert.deepEqual(routing.quickTaskListArgs("everyone's tasks"), { scope: 'all' });
  assert.deepEqual(routing.quickTaskListArgs("show everyone's tasks"), { scope: 'all' });
  assert.deepEqual(routing.quickTaskListArgs("team's tasks"), { scope: 'all' });
});

test('priority filter ("<level> priority tasks") is recognized and never blocked', () => {
  // Observed live: "high priority tasks" and "high priority all tasks" both
  // fell through to the AI instead of the deterministic route, because the
  // bare word "priority" was an unconditional exclusion trigger — the AI
  // then answered from the caller's own (often empty) task list instead of
  // a real priority filter.
  assert.deepEqual(routing.quickTaskListArgs('high priority tasks'), { priority_filter: 'high', scope: 'all' });
  assert.deepEqual(routing.quickTaskListArgs('high priority all tasks'), { priority_filter: 'high', scope: 'all' });
  assert.deepEqual(routing.quickTaskListArgs('urgent tasks'), { priority_filter: 'urgent', scope: 'all' });
  assert.deepEqual(routing.quickTaskListArgs('low priority tasks'), { priority_filter: 'low', scope: 'all' });
  // Combines correctly with a named person.
  assert.deepEqual(routing.quickTaskListArgs("Rashmi's high priority tasks"), { priority_filter: 'high', assignee_name: 'Rashmi' });
  // Genuine field queries/mutations about priority must still be excluded.
  assert.equal(routing.quickTaskListArgs('what is the priority of task Payroll'), null);
  assert.equal(routing.quickTaskListArgs('update task Payroll priority to high'), null);
});

test('does not misroute task mutations as task-list requests', () => {
  for (const message of ['create a task', 'delete task Payroll', 'update task Payroll', 'assign task Payroll to Mahima', 'show details of task Payroll', 'show task status']) {
    assert.equal(routing.quickTaskListArgs(message), null, message);
  }
});

test('"mark X as completed" is a completion action, never a task-list request', () => {
  for (const message of [
    'mark new task QST as completed',
    'Mark new task QST as completed.',
    'mark Payroll task as complete',
    'mark Payroll task done',
  ]) {
    assert.equal(routing.quickTaskListArgs(message), null, message);
  }
});

test('resolves task-list pronouns from recent conversation context', () => {
  const args = routing.quickTaskListArgs('list of her tasks');
  assert.deepEqual(
    routing.resolveTaskListPronoun(args, [
      { role: 'user', content: "Please update mahima's task" },
      { role: 'assistant', content: 'Which task belonging to Mahima would you like to update?' },
    ]),
    { assignee_name: 'Mahima' },
  );
});

test('"give me list of his task" resolves to the person named earlier, not the caller', () => {
  const args = routing.quickTaskListArgs('give me list of his task');
  assert.deepEqual(args, { assignee_name: 'his' });
  assert.deepEqual(
    routing.resolveTaskListPronoun(args, [
      { role: 'user', content: "please update tushar's task" },
      { role: 'assistant', content: 'Multiple people match Tushar: · Tushar Handysolver · Tushar Bali. Please use the full name.' },
      { role: 'user', content: 'Tushar bali' },
      { role: 'assistant', content: 'Sure! Which task of Tushar Bali would you like to update? Please tell me the task title.' },
    ]),
    { assignee_name: 'Tushar Bali' },
  );
});

test('a bare task-list request defaults to everyone\'s tasks, not just the caller\'s', () => {
  assert.deepEqual(routing.quickTaskListArgs('list of completed tasks'), { status_filter: 'done', scope: 'all' });
  assert.deepEqual(routing.quickTaskListArgs('list of tasks'), { scope: 'all' });
  // Only an explicit self-reference narrows it back to the caller.
  assert.deepEqual(routing.quickTaskListArgs('my completed tasks'), { status_filter: 'done', assignee_name: 'mine' });
});
