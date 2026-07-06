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
  assert.deepEqual(routing.quickTaskListArgs('list all tasks'), {});
  assert.deepEqual(routing.quickTaskListArgs("List of mahima's tasks"), { assignee_name: 'mahima' });
  assert.deepEqual(routing.quickTaskListArgs('show Prnay tasks'), { assignee_name: 'Prnay' });
  assert.deepEqual(routing.quickTaskListArgs('my completed taks'), { status_filter: 'done', assignee_name: 'mine' });
  assert.deepEqual(routing.quickTaskListArgs("show Mahima's completed tasks"), { status_filter: 'done', assignee_name: 'Mahima' });
});

test('does not misroute task mutations as task-list requests', () => {
  for (const message of ['create a task', 'delete task Payroll', 'update task Payroll', 'assign task Payroll to Mahima', 'show details of task Payroll', 'show task status']) {
    assert.equal(routing.quickTaskListArgs(message), null, message);
  }
});
