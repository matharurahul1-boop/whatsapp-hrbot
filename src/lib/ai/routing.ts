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
  const t = normalizeCommandText(message).replace(/[?.!,;]+$/, '');
  if (!/\btasks?\b/i.test(t)) return null;
  if (/\b(details?|info|status|deadline|priority|assignee|update|change|delete|remove|complete|finish|assign|create|add|note)\b/i.test(t) && !/\b(completed|done|finished)\s+tasks?\b/i.test(t)) {
    return null;
  }
  if (!/\b(list|show|get|display|pending|open|completed|done|finished|all|my|mine)\b/i.test(t) && !/[’']s\s+tasks?$/i.test(t)) {
    return null;
  }

  const args: Record<string, string> = {};
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
    const name = match?.[1]?.replace(/(?:[’']s)$/i, '').trim();
    if (name && !/^(?:all|pending|open|completed|done|finished|the|of|a|an|my|mine)$/i.test(name)) {
      args.assignee_name = name;
      break;
    }
  }
  return args;
}
