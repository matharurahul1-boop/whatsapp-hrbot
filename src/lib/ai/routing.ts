const COMMAND_TYPO_MAP: Record<string, string> = {
  taks: 'task', tsk: 'task', taske: 'task',
  crate: 'create', creat: 'create', craete: 'create',
  udpate: 'update', upadte: 'update', updte: 'update',
  delet: 'delete', delte: 'delete', remvoe: 'remove',
  complet: 'complete', compelte: 'complete', finsih: 'finish',
  assgin: 'assign', asign: 'assign', reassing: 'reassign',
  remnder: 'reminder', reminer: 'reminder',
  leav: 'leave', balnce: 'balance', pendng: 'pending',
  aproove: 'approve', aprove: 'approve', rejct: 'reject',
  attendence: 'attendance', attendace: 'attendance',
  chekin: 'checkin', chckin: 'checkin', chekout: 'checkout',
  detials: 'details', deatils: 'details', priorty: 'priority',
  deadine: 'deadline', dedline: 'deadline', assinee: 'assignee',
};

export function normalizeCommandText(message: string): string {
  return message
    .normalize('NFKC')
    .replace(/[’`]/g, "'")
    .replace(/[A-Za-z]+/g, word => COMMAND_TYPO_MAP[word.toLowerCase()] ?? word)
    .replace(/\s+/g, ' ')
    .trim();
}

/** True when a task-list request explicitly asks for organization-wide scope. */
function requestsAllTasks(message: string): boolean {
  return /\b(?:all|every|each|entire|whole)\b/i.test(message)
    || /\b(?:everyone|everybody)(?:'s)?\b/i.test(message)
    || /\b(?:team|staff|workforce|company|org|organisation|organization)(?:[ -]wide)?\b/i.test(message)
    || /\b(?:all|every|each)\s+(?:users?|employees?|people|persons?|members?|assignees?)\b/i.test(message)
    || /\b(?:full|complete|total)\s+(?:task\s+)?list\b/i.test(message)
    || /\bacross\s+(?:the\s+)?(?:team|company|org|organisation|organization|workforce)\b/i.test(message);
}

function requestedTaskStatus(message: string): string | null {
  // "complete task list" means the full list, not only completed tasks.
  if (/\b(?:full|complete|total)\s+(?:task\s+)?list\b/i.test(message)) return null;
  if (/\b(?:cancelled|canceled|dropped|abandoned)\b/i.test(message)) return 'cancelled';
  if (/\b(?:in[\s_-]*progress|wip|ongoing|underway|started|working\s+on)\b/i.test(message)) return 'in_progress';
  if (/\b(?:to[\s_-]*do|todo|pending|open|not\s+started|new)\b/i.test(message)) return 'todo';
  if (/\b(?:completed|complete|done|finished|closed)\b/i.test(message)) return 'done';
  if (/\bactive\b/i.test(message)) return 'active';
  return null;
}

/** Parse common task-list requests without an LLM round-trip. */
export function quickTaskListArgs(message: string): Record<string, string> | null {
  // Strip leading "give me" / "send me" / "tell me" filler — these verbs
  // aren't part of the list/show/get/display alternation used below, and
  // leaving the bare "me" in place falsely trips the self-reference check,
  // pre-empting a real third-party reference later in the sentence
  // (e.g. "give me list of his task" was being read as "my tasks").
  const t = normalizeCommandText(message).replace(/[?.!,;]+$/, '')
    .replace(/^(?:please\s+)?(?:give|send|tell)\s+me\s+/i, '');
  // "mark X as complete/completed/done" is a completion ACTION, not a list
  // request — but it contains "completed"/"done", which would otherwise
  // satisfy the listing-verb check further down and get misrouted into a
  // task list instead of COMPLETE_TASK (observed live: "mark new task QST
  // as completed" returned "All To Do tasks" instead of completing it).
  if (/\bmark\s+.{1,60}\s+(?:as\s+)?(?:complete|completed|done)\b/i.test(t)) return null;
  const isAllScope = requestsAllTasks(t);
  const statusFilter = requestedTaskStatus(t);
  // "all my tasks" / "list all of my tasks" means every one of the caller's
  // own tasks, not every task in the org — self-reference always wins over
  // the generic all-scope keyword.
  const isSelfRef = /\b(my|mine|me)\b/i.test(t);
  if (!/\btasks?\b/i.test(t)) return null;
  if (/\b(details?|info|status|deadline|priority|assignee|update|change|delete|remove|complete|finish|assign|create|add|note)\b/i.test(t) && !/\b(completed|complete|done|finished|closed)\s+tasks?\b/i.test(t) && !/\b(?:full|complete|total)\s+(?:task\s+)?list\b/i.test(t)) {
    return null;
  }
  if (isAllScope && !isSelfRef) return { ...(statusFilter ? { status_filter: statusFilter } : {}), scope: 'all' };
  if (!/\b(list|show|get|display|pending|open|completed|done|finished|all|my|mine)\b/i.test(t) && !/[’']s\s+tasks?$/i.test(t)) {
    return null;
  }

  const args: Record<string, string> = {};
  if (statusFilter) args.status_filter = statusFilter;
  if (/\b(my|mine|me)\b/i.test(t)) {
    args.assignee_name = 'mine';
    return args;
  }

  const personPatterns = [
    /^(?:list|show|get|display)(?:\s+me)?(?:\s+the)?\s+(.+?)(?:[’']s)?\s+(?:completed|done|finished)\s+tasks?$/i,
    /^(.+?)[’']s\s+(?:completed|done|finished)\s+tasks?$/i,
    /^(?:list|show|get|display)(?:\s+me)?(?:\s+the)?(?:\s+list)?\s+of\s+(.+?)(?:[’']s)?\s+tasks?$/i,
    /^(.+?)[’']s\s+tasks?$/i,
    /^(?:list|show|get|display)(?:\s+me)?(?:\s+the)?\s+(.+?)\s+tasks?$/i,
    /^(?:(?:list|show|get|display)(?:\s+me)?(?:\s+the)?(?:\s+of)?\s+)?tasks?\s+(?:of|for|assigned\s+to)\s+(.+)$/i,
  ];
  for (const pattern of personPatterns) {
    const taskOwnerText = t.replace(/\b(?:completed|complete|done|finished|closed|cancelled|canceled|dropped|abandoned|in[\s_-]*progress|wip|ongoing|underway|started|working\s+on|to[\s_-]*do|todo|pending|open|not\s+started|active)\b(?=\s+tasks?\b)/ig, '').replace(/\s+/g, ' ').trim();
    const match = taskOwnerText.match(pattern);
    const name = match?.[1]
      ?.replace(/^(?:list|show|get|display)(?:\s+me)?(?:\s+the)?\s+/i, '')
      ?.replace(/^of\s+/i, '')
      .replace(/(?:[’']s)$/i, '')
      .trim();
    if (name && !/^(?:all|team|everyone|everybody|organisation|organization|company|pending|open|completed|done|finished|the|of|a|an|my|mine)$/i.test(name)) {
      args.assignee_name = name;
      break;
    }
  }
  // Phrases such as "entire tasks" and "whole task list" describe scope,
  // never an employee called "entire" or "whole" — but self-reference
  // ("my"/"mine") still wins, same as the earlier isAllScope check above.
  if (isAllScope && !isSelfRef) {
    delete args.assignee_name;
    args.scope = 'all';
    return args;
  }
  // Generic requests such as "list of tasks" default to everyone's tasks —
  // only an explicit self-reference ("my"/"mine"/"me", handled earlier via
  // early return) narrows the scope to the caller. No role restriction here:
  // any role, including employee, can list any other person's or the whole
  // org's tasks through the bot.
  if (!args.assignee_name) {
    args.scope = 'all';
  }
  return args;
}

export function resolveTaskListPronoun(
  args: Record<string, string>,
  history: Array<{ role: string; content: string }>,
): Record<string, string> {
  const pronoun = args.assignee_name?.toLowerCase();
  if (!pronoun || !/^(?:her|him|his|she|he|their|theirs|them|that person)$/i.test(pronoun)) return args;

  const patterns = [
    /\bbelonging\s+to\s+\*?([\p{L}][\p{L} .'-]{0,50}?)\*?\s+would\b/iu,
    /\bwhich\s+tasks?\s+of\s+\*?([\p{L}][\p{L} .'-]{0,50}?)\*?\s+would\b/iu,
    /\b(?:update|change|edit|show|list)\s+(?:of\s+)?([\p{L}][\p{L} .'-]{0,50}?)[’']s\s+tasks?\b/iu,
    /\*([^*]+?)[’']s\s+tasks?\b/iu,
  ];

  for (let i = history.length - 1; i >= 0; i--) {
    for (const pattern of patterns) {
      const name = history[i].content.match(pattern)?.[1]?.trim();
      if (name && !/^(?:her|him|his|she|he|their|them)$/i.test(name)) {
        return { ...args, assignee_name: name };
      }
    }
  }
  return args;
}

