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

/** Parse common task-list requests without an LLM round-trip. */
export function quickTaskListArgs(message: string): Record<string, string> | null {
  // Strip leading "give me" / "send me" / "tell me" filler — these verbs
  // aren't part of the list/show/get/display alternation used below, and
  // leaving the bare "me" in place falsely trips the self-reference check,
  // pre-empting a real third-party reference later in the sentence
  // (e.g. "give me list of his task" was being read as "my tasks").
  const t = normalizeCommandText(message).replace(/[?.!,;]+$/, '')
    .replace(/^(?:please\s+)?(?:give|send|tell)\s+me\s+/i, '');
  if (!/\btasks?\b/i.test(t)) return null;
  if (/\b(details?|info|status|deadline|priority|assignee|update|change|delete|remove|complete|finish|assign|create|add|note)\b/i.test(t) && !/\b(completed|done|finished)\s+tasks?\b/i.test(t)) {
    return null;
  }
  if (!/\b(list|show|get|display|pending|open|completed|done|finished|all|my|mine)\b/i.test(t) && !/[’']s\s+tasks?$/i.test(t)) {
    return null;
  }

  const args: Record<string, string> = {};
  const isAllScope = /\b(all|entire|whole|team|everyone|everybody|organisation|organization|company)\b/i.test(t);
  if (/\b(completed|done|finished)\b/i.test(t)) args.status_filter = 'done';
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
    const match = t.match(pattern);
    const name = match?.[1]
      ?.replace(/^of\s+/i, '')
      .replace(/(?:[’']s)$/i, '')
      .trim();
    if (name && !/^(?:all|team|everyone|everybody|organisation|organization|company|pending|open|completed|done|finished|the|of|a|an|my|mine)$/i.test(name)) {
      args.assignee_name = name;
      break;
    }
  }
  // Phrases such as "entire tasks" and "whole task list" describe scope,
  // never an employee called "entire" or "whole".
  if (isAllScope) {
    delete args.assignee_name;
    args.scope = 'all';
    return args;
  }
  // Generic requests such as "list of tasks" always mean the caller's own
  // tasks. Expand scope only when the user explicitly asks for all/team tasks.
  if (!args.assignee_name && !/\b(all|team|everyone|everybody|organisation|organization|company)\b/i.test(t)) {
    args.assignee_name = 'mine';
  } else if (!args.assignee_name) {
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
