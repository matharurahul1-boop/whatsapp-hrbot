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

test('deadline filter ("overdue"/"due today"/"due this week"/"no deadline") is recognized and never blocked', () => {
  // Observed live: "Overdue tasks" fell through to the AI (no status/priority/
  // name/scope keyword to trip the deterministic route), which fabricated a
  // wrong result — including an already-Done task as "overdue" and missing
  // several genuinely overdue tasks the dashboard showed correctly.
  assert.deepEqual(routing.quickTaskListArgs('overdue tasks'), { deadline_filter: 'overdue', scope: 'all' });
  assert.deepEqual(routing.quickTaskListArgs('Overdue tasks'), { deadline_filter: 'overdue', scope: 'all' });
  assert.deepEqual(routing.quickTaskListArgs('show all overdue tasks'), { deadline_filter: 'overdue', scope: 'all' });
  assert.deepEqual(routing.quickTaskListArgs('my overdue tasks'), { deadline_filter: 'overdue', assignee_name: 'mine' });
  assert.deepEqual(routing.quickTaskListArgs('tasks due today'), { deadline_filter: 'today', scope: 'all' });
  assert.deepEqual(routing.quickTaskListArgs('tasks due this week'), { deadline_filter: 'week', scope: 'all' });
  assert.deepEqual(routing.quickTaskListArgs('tasks with no deadline'), { deadline_filter: 'none', scope: 'all' });
  // Combines correctly with a named person.
  assert.deepEqual(routing.quickTaskListArgs("Rashmi's overdue tasks"), { deadline_filter: 'overdue', assignee_name: 'Rashmi' });
  assert.deepEqual(routing.quickTaskListArgs('Ashish overdue tasks'), { deadline_filter: 'overdue', assignee_name: 'Ashish' });
  // Combines correctly with priority filter.
  assert.deepEqual(routing.quickTaskListArgs('high priority overdue tasks'), { priority_filter: 'high', deadline_filter: 'overdue', scope: 'all' });
  // Genuine field queries/mutations about the deadline field must still be excluded.
  assert.equal(routing.quickTaskListArgs('what is the deadline of task Payroll'), null);
  assert.equal(routing.quickTaskListArgs('update task Payroll deadline to tomorrow'), null);
  // "today's tasks" must NOT be misread as a deadline filter — "today" here
  // reads as an (invalid, excluded) possessive name, so this falls through
  // to a generic org-wide list rather than a deadline filter.
  assert.deepEqual(routing.quickTaskListArgs("today's tasks"), { scope: 'all' });
});

test('combined filters ("<priority/status/deadline> tasks assigned to/for/of <name>") resolve to that person, not the whole org', () => {
  // Observed live: "Medium tasks assigned to rashmi" returned the org-wide
  // "All Medium Priority tasks" list — the bare priority word "Medium"
  // wasn't being stripped before matching the "tasks (of|for|assigned to)
  // NAME" pattern, which requires "tasks" to be the very first word, so the
  // leading modifier broke the match entirely and "assigned to rashmi" was
  // silently dropped.
  assert.deepEqual(routing.quickTaskListArgs('Medium tasks assigned to rashmi'), { priority_filter: 'medium', assignee_name: 'rashmi' });
  assert.deepEqual(routing.quickTaskListArgs('high priority tasks assigned to rashmi'), { priority_filter: 'high', assignee_name: 'rashmi' });
  assert.deepEqual(routing.quickTaskListArgs('urgent tasks for rashmi'), { priority_filter: 'urgent', assignee_name: 'rashmi' });
  assert.deepEqual(routing.quickTaskListArgs('pending tasks assigned to rashmi'), { status_filter: 'active', assignee_name: 'rashmi' });
  assert.deepEqual(routing.quickTaskListArgs('overdue tasks assigned to rashmi'), { deadline_filter: 'overdue', assignee_name: 'rashmi' });
  assert.deepEqual(routing.quickTaskListArgs('completed tasks of rashmi'), { status_filter: 'done', assignee_name: 'rashmi' });
  // Also fixes the equivalent possessive phrasing for a bare level word.
  assert.deepEqual(routing.quickTaskListArgs("rashmi's medium tasks"), { priority_filter: 'medium', assignee_name: 'rashmi' });
  // Bare priority filter with no name still resolves org-wide, unaffected.
  assert.deepEqual(routing.quickTaskListArgs('medium tasks'), { priority_filter: 'medium', scope: 'all' });
});

test('"All <name>\'s tasks" (leading "all") names a specific person, not the whole org', () => {
  // Same class of bug as "<name>'s all tasks" (trailing "all") but with the
  // word order flipped — "all" sitting before the possessive name instead
  // of after it. Observed live: "All tushar's tasks without overdue"
  // returned the org-wide overdue list, dropping "tushar" entirely.
  assert.deepEqual(routing.quickTaskListArgs("All tushar's tasks"), { assignee_name: 'tushar' });
  assert.deepEqual(routing.quickTaskListArgs("all Rashmi's completed tasks"), { status_filter: 'done', assignee_name: 'Rashmi' });
  // Genuine org-wide possessives (no real person named) must still resolve
  // to org-wide scope, not be misread as a person named "everyone"/"team".
  assert.deepEqual(routing.quickTaskListArgs("all everyone's tasks"), { scope: 'all' });
});

test('negated deadline filter ("without overdue"/"not overdue"/"excluding overdue") is the opposite of "overdue", never confused with it', () => {
  // Observed live: "All tushar's tasks without overdue" returned the
  // org-wide OVERDUE list — the literal opposite of what was asked, because
  // requestedTaskDeadline() only recognized the bare word "overdue" and had
  // no way to notice it was being negated.
  assert.deepEqual(routing.quickTaskListArgs("All tushar's tasks without overdue"), { deadline_filter: 'not_overdue', assignee_name: 'tushar' });
  assert.deepEqual(routing.quickTaskListArgs("tushar's tasks without overdue"), { deadline_filter: 'not_overdue', assignee_name: 'tushar' });
  assert.deepEqual(routing.quickTaskListArgs('tasks not overdue'), { deadline_filter: 'not_overdue', scope: 'all' });
  assert.deepEqual(routing.quickTaskListArgs('tasks excluding overdue'), { deadline_filter: 'not_overdue', scope: 'all' });
  assert.deepEqual(routing.quickTaskListArgs('tasks except overdue'), { deadline_filter: 'not_overdue', scope: 'all' });
  // Un-negated "overdue" must still resolve to the plain filter, unaffected.
  assert.deepEqual(routing.quickTaskListArgs('overdue tasks'), { deadline_filter: 'overdue', scope: 'all' });
});

test('negation generalizes to status and priority filters too, not just deadline', () => {
  // The "without overdue" fix was deadline-specific — but the same inversion
  // risk exists for status/priority: "tasks excluding done" naively matches
  // "done" as a positive status filter unless negation is checked first.
  assert.deepEqual(routing.quickTaskListArgs('tasks excluding done'), { exclude_status_filter: 'done', scope: 'all' });
  assert.deepEqual(routing.quickTaskListArgs('tasks not cancelled'), { exclude_status_filter: 'cancelled', scope: 'all' });
  assert.deepEqual(routing.quickTaskListArgs('tasks without pending ones'), { exclude_status_filter: 'active', scope: 'all' });
  assert.deepEqual(routing.quickTaskListArgs('tasks without high priority'), { exclude_priority_filter: 'high', scope: 'all' });
  assert.deepEqual(routing.quickTaskListArgs('not urgent tasks'), { exclude_priority_filter: 'urgent', scope: 'all' });
  // Combines correctly with a named person, same as the deadline case.
  assert.deepEqual(routing.quickTaskListArgs("tushar's tasks without high priority"), { exclude_priority_filter: 'high', assignee_name: 'tushar' });
  assert.deepEqual(routing.quickTaskListArgs("All rashmi's tasks excluding done"), { exclude_status_filter: 'done', assignee_name: 'rashmi' });
  // Un-negated phrasing must still resolve to the plain positive filter.
  assert.deepEqual(routing.quickTaskListArgs('done tasks'), { status_filter: 'done', scope: 'all' });
  assert.deepEqual(routing.quickTaskListArgs('high priority tasks'), { priority_filter: 'high', scope: 'all' });
  // "not started" is a fixed idiom for todo, not a negation of anything —
  // must not be misread as "everything except in-progress".
  assert.deepEqual(routing.quickTaskListArgs('not started tasks'), { status_filter: 'todo', scope: 'all' });
});

test('bails out to the AI (returns null) on negation phrasing it is not specifically taught, instead of guessing wrong', () => {
  // Rather than hand-coding an ever-growing list of negation phrasings, the
  // router recognizes its own blind spots: any negation word left over after
  // stripping every filter phrase it knows how to resolve means something in
  // the message wasn't accounted for — silently guessing here risks the
  // exact inversion bug this whole feature was built to prevent, so it defers
  // to the AI (which still calls the same real list_tasks tool) instead.
  assert.equal(routing.quickTaskListArgs('tushar tasks besides the urgent ones'), null);
  assert.equal(routing.quickTaskListArgs('tasks other than done ones'), null);
  assert.equal(routing.quickTaskListArgs('list tasks, leave out cancelled'), null);
  assert.equal(routing.quickTaskListArgs('tasks not assigned to anyone'), null);
});

test('a two-word name survives unrecognized trailing text (typo, reversed word order, extra prefix)', () => {
  // Observed live: "Tushar Bali's tasks priority high and overdued" dropped
  // "Tushar Bali" entirely and returned the org-wide "All High Priority
  // tasks" list. Root cause was NOT negation (the earlier safety net
  // doesn't apply here) — it was two unrelated gaps compounding: "priority
  // high" (reversed order, only "high priority" was recognized) and
  // "overdued" (a typo of "overdue") both left unstripped leftover text
  // after "tasks", which broke the then-end-anchored ("tasks?$") name
  // patterns entirely, even though "Tushar Bali's" was unambiguous.
  assert.deepEqual(
    routing.quickTaskListArgs("Tushar Bali's tasks priority high and overdued"),
    { priority_filter: 'high', deadline_filter: 'overdue', assignee_name: 'Tushar Bali' },
  );
  // Second live message, same underlying bug plus a leading "give all"
  // (no "me") prefix and a "priority is high" variant.
  assert.deepEqual(
    routing.quickTaskListArgs("Please give all tushar Bali's tasks whose priority is high and overdued"),
    { priority_filter: 'high', deadline_filter: 'overdue', assignee_name: 'tushar Bali' },
  );
  // Reversed "priority <level>" order alone, no typo involved.
  assert.deepEqual(routing.quickTaskListArgs('Rashmi tasks priority medium'), { priority_filter: 'medium', assignee_name: 'Rashmi' });
  // "overdued" typo alone, no reversed order involved.
  assert.deepEqual(routing.quickTaskListArgs("Rashmi's overdued tasks"), { deadline_filter: 'overdue', assignee_name: 'Rashmi' });
});

test('"assigned by X" / "created by X" resolves to creator_name, combining with any number of other filters', () => {
  // Observed live: "assigned by shilpa" was silently dropped entirely —
  // LIST_TASKS had no creator filter at all, so a task created by Pranay
  // was incorrectly included in a reply the user explicitly scoped to
  // "assigned by shilpa". creator_name is who CREATED the task, completely
  // independent of assignee_name (who it's assigned TO).
  assert.deepEqual(routing.quickTaskListArgs('tasks assigned by shilpa'), { creator_name: 'shilpa', scope: 'all' });
  assert.deepEqual(routing.quickTaskListArgs('tasks created by pranay'), { creator_name: 'pranay', scope: 'all' });
  // The exact live message (with its "assinged" typo) combining FOUR filters
  // at once — assignee, priority, creator, and deadline — must resolve every
  // one of them correctly together, not just whichever is easiest.
  assert.deepEqual(
    routing.quickTaskListArgs('Rashmi deep tasks whose priority is medium, assinged by shilpa and overdued'),
    { assignee_name: 'Rashmi deep', priority_filter: 'medium', deadline_filter: 'overdue', creator_name: 'shilpa' },
  );
  // Combines with a two-word creator name and a trailing clause after it.
  assert.deepEqual(
    routing.quickTaskListArgs('high priority tasks assigned by Tushar Bali and overdue'),
    { priority_filter: 'high', deadline_filter: 'overdue', creator_name: 'Tushar Bali', scope: 'all' },
  );
});

test('looksLikeRealPersonName distinguishes actual names from ordinary conversation', () => {
  // Observed live: "Thanks" (an acknowledgment after a task list) and "I'm
  // in today" (a natural reply to a check-in reminder) were both treated as
  // a person's name to look up, producing a broken "No user found matching
  // '*I'm in today*'" reply instead of being read as ordinary conversation.
  for (const notAName of [
    'Thanks', 'thanks', 'Thank you', 'thanks a lot', "I'm in today", 'I am here',
    'ok', 'okay', 'cool', 'sure', 'no problem', 'yes', 'no', 'good morning',
    'sounds great', 'got it', "we're done",
  ]) {
    assert.equal(routing.looksLikeRealPersonName(notAName), false, notAName);
  }
  for (const realName of ['Rashmi', 'Tushar Bali', 'Ashish', 'Mahima Sengar', 'Pranay', "O'Brien", 'Mary-Jane']) {
    assert.equal(routing.looksLikeRealPersonName(realName), true, realName);
  }
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
