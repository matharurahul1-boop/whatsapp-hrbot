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
  assert.deepEqual(routing.quickTaskListArgs('list of tasks'), { assignee_name: 'mine' });
  assert.deepEqual(routing.quickTaskListArgs('show tasks'), { assignee_name: 'mine' });
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
  assert.deepEqual(routing.quickTaskListArgs('my pending tasks'), { status_filter: 'todo', assignee_name: 'mine' });
  assert.deepEqual(routing.quickTaskListArgs('give me my tasks'), { assignee_name: 'mine' });
  assert.deepEqual(routing.quickTaskListArgs('give me list of his task'), { assignee_name: 'his' });
  assert.deepEqual(routing.quickTaskListArgs('please send me list of her tasks'), { assignee_name: 'her' });
});

test('does not misroute task mutations as task-list requests', () => {
  for (const message of ['create a task', 'delete task Payroll', 'update task Payroll', 'assign task Payroll to Mahima', 'show details of task Payroll', 'show task status']) {
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
