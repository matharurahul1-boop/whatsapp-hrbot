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
  overdued: 'overdue', overdu: 'overdue', assinged: 'assigned',
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

// Negation words this router knows how to correctly resolve into the
// opposite of a positive filter, rather than misreading them as a positive
// filter (the bug behind "All tushar's tasks without overdue" returning the
// org-wide OVERDUE list). Kept as one shared list so priority/status/
// deadline negation detection can't drift out of sync with each other.
const NEGATION_PREFIX = '\\b(?:without|excluding|except|not|never)\\s+(?:any\\s+)?';

type FilterMatch = { value: string; negated: boolean };

function requestedTaskPriority(message: string): FilterMatch | null {
  const negRe = new RegExp(NEGATION_PREFIX + '(?:(urgent|high|medium|low)\\s+priority|(urgent|high|medium|low))\\b', 'i');
  const negMatch = message.match(negRe);
  if (negMatch) return { value: (negMatch[1] ?? negMatch[2]).toLowerCase(), negated: true };
  if (/\burgent\b/i.test(message)) return { value: 'urgent', negated: false };
  if (/\bhigh\b/i.test(message)) return { value: 'high', negated: false };
  if (/\bmedium\b/i.test(message)) return { value: 'medium', negated: false };
  if (/\blow\b/i.test(message)) return { value: 'low', negated: false };
  return null;
}

/**
 * Deadline filter — mirrors the dashboard's DEADLINE_OPTIONS
 * (overdue/today/week/none in TaskKanban.tsx). Kept to unambiguous phrases
 * only ("due today"/"due this week", not bare "today"/"week") so it never
 * collides with the possessive-name pattern (e.g. "today's tasks" is NOT
 * treated as a deadline filter — "today" would otherwise get captured as if
 * it were a person's name).
 */
function requestedTaskDeadline(message: string): string | null {
  // Negation must be checked BEFORE the bare "overdue" check below — e.g.
  // "tasks without overdue" contains the word "overdue" too, and without
  // this ordering it would be misread as a request FOR overdue tasks
  // instead of a request to EXCLUDE them. Observed live: "All tushar's
  // tasks without overdue" returned the org-wide overdue list — the exact
  // opposite of what was asked, and it also dropped "tushar" entirely.
  // (deadline stays a plain string, not a FilterMatch, since 'not_overdue'
  // is already its own distinct value rather than {value:'overdue',negated}
  // — the executor treats it as a genuinely different query shape.)
  if (new RegExp(NEGATION_PREFIX + '(?:the\\s+)?overdue\\b', 'i').test(message)) return 'not_overdue';
  if (/\boverdue\b/i.test(message)) return 'overdue';
  if (/\bdue\s+today\b/i.test(message)) return 'today';
  if (/\bdue\s+this\s+week\b/i.test(message) || /\bdue\s+(?:with)?in\s+(?:a|the\s+next)?\s*week\b/i.test(message)) return 'week';
  if (/\bno\s+deadline\b/i.test(message) || /\bwithout\s+(?:a\s+)?deadline\b/i.test(message)) return 'none';
  return null;
}

// Shared by requestedCreatorName and stripFilterModifiers so the two can
// never disagree about where the name ends — a non-greedy capture bounded
// by a lookahead for the next comma/"and"/"or"/end-of-string, rather than a
// fixed word count, so both "assigned by Shilpa" and "assigned by Tushar
// Bali" resolve correctly without also swallowing whatever clause follows
// (e.g. "assigned by shilpa and overdued" must capture only "shilpa").
const CREATOR_NAME_RE_SOURCE = '\\b(?:assigned|created)\\s+by\\s+([\\p{L}][\\p{L} .\'-]*?)(?=\\s*(?:,|\\band\\b|\\bor\\b|$))';

/**
 * "Assigned by NAME" / "created by NAME" — who created/assigned the task,
 * independent of who it's assigned TO (assignee_name). Previously had no
 * representation at all in the deterministic router, so this clause was
 * silently dropped rather than either filtered or bailed out on — observed
 * live: "assigned by shilpa" was ignored entirely, returning tasks created
 * by anyone.
 */
function requestedCreatorName(message: string): string | null {
  return message.match(new RegExp(CREATOR_NAME_RE_SOURCE, 'iu'))?.[1]?.trim() || null;
}

/**
 * Strip every recognized filter-descriptor phrase (priority level, deadline
 * bucket including negation, status word) from the message, wherever it
 * occurs — not just directly adjacent to "tasks". These words are never
 * legitimately part of a real person's name, so unconditional stripping is
 * safe, and using ONE shared implementation for both the possessive-name
 * check and the personPatterns loop below (previously two separate,
 * drifting copies) means a filter word taught to one can't be silently
 * missed by the other. The result is used purely for name-extraction — the
 * actual filter values themselves come from requestedTaskPriority/
 * requestedTaskStatus/requestedTaskDeadline above, run on the original text.
 */
function stripFilterModifiers(text: string): string {
  let out = text
    // Negated phrases stripped FIRST, whole phrase at once (negation word +
    // filter word together) — so a recognized negation leaves no leftover
    // "without"/"not"/etc. behind for the unhandled-negation guard further
    // down in quickTaskListArgs to trip over. Order matches
    // requestedTaskPriority/requestedTaskStatus/requestedTaskDeadline's own
    // negation handling so this strip never disagrees with what was
    // actually extracted as a filter.
    .replace(new RegExp(NEGATION_PREFIX + '(?:the\\s+)?overdue\\b', 'ig'), '')
    .replace(new RegExp(NEGATION_PREFIX + '(?:(?:urgent|high|medium|low)\\s+priority|urgent|high|medium|low)\\b', 'ig'), '');
  for (const [, wordRe] of STATUS_WORD_GROUPS) {
    out = out.replace(new RegExp(NEGATION_PREFIX + wordRe + '\\b', 'ig'), '');
  }
  return out
    .replace(/\boverdue\b/ig, '')
    .replace(/\bdue\s+today\b/ig, '')
    .replace(/\bdue\s+this\s+week\b/ig, '')
    .replace(/\bno\s+deadline\b/ig, '')
    .replace(/\bwithout\s+(?:a\s+)?deadline\b/ig, '')
    .replace(/\b(?:urgent|high|medium|low)\s+priority\b/ig, '')
    // Reversed order — "priority high"/"priority is high" (e.g. "whose
    // priority is high and overdued") — requestedTaskPriority() already
    // recognizes the bare level word regardless of position, but without
    // this strip "priority is" is left as orphaned leftover text, which
    // breaks the end-anchored name-matching patterns below just as badly as
    // an unstripped negation word would. Observed live: "Tushar Bali's tasks
    // priority high and overdued" dropped "Tushar Bali" entirely and
    // returned the org-wide list.
    .replace(/\bpriority\s+(?:is\s+)?(?:urgent|high|medium|low)\b/ig, '')
    // Bare level word with no "priority" suffix — e.g. "Medium tasks
    // assigned to rashmi" (requestedTaskPriority() already recognizes a
    // bare level word as a real priority filter; this strip needs to match
    // that same recognition, or the leading modifier is left in place and
    // breaks name-matching patterns anchored on "tasks" being first/last).
    .replace(/\b(?:urgent|high|medium|low)\b/ig, '')
    .replace(/\b(?:completed|complete|done|finished|closed|cancelled|canceled|dropped|abandoned|in[\s_-]*progress|wip|ongoing|underway|started|working\s+on|to[\s_-]*do|todo|pending|open|not\s+started|active)\b/ig, '')
    // "assigned by NAME" / "created by NAME" — the creator, not the
    // assignee. Must be stripped for the SAME reason every other filter
    // phrase is: left in place, it would sit between the real assignee name
    // and "tasks" (or trail after it) and risk being swept into the wrong
    // capture group, or contribute a stray "assigned"/"by" the exclusion
    // list would have to special-case.
    .replace(new RegExp(CREATOR_NAME_RE_SOURCE, 'igu'), '')
    .replace(/\s+/g, ' ')
    .trim();
}

// Ordered so more specific phrasings win over broader ones — unchanged from
// the original if-chain's precedence (cancelled > in_progress > todo >
// pending/open/active > done), just expressed as data so the same list can
// drive both the negated and non-negated lookups below without drifting.
const STATUS_WORD_GROUPS: Array<[string, string]> = [
  ['cancelled', '(?:cancelled|canceled|dropped|abandoned)'],
  ['in_progress', '(?:in[\\s_-]*progress|wip|ongoing|underway|started|working\\s+on)'],
  ['todo', '(?:to[\\s_-]*do|todo|new)'],
  // "pending"/"open" mean "not yet done" in everyday HR usage — broader than
  // strictly not-started, so this covers both todo AND in_progress tasks
  // (unlike "to do"/"todo" above, which means specifically not-started).
  ['active', '(?:pending|open|active)'],
  ['done', '(?:completed|complete|done|finished|closed)'],
];

function requestedTaskStatus(message: string): FilterMatch | null {
  // "complete task list" means the full list, not only completed tasks.
  if (/\b(?:full|complete|total)\s+(?:task\s+)?list\b/i.test(message)) return null;
  // "not started" is a fixed idiom meaning todo (not-yet-begun), not a
  // negation of anything — handled before the generic negation loop below
  // so it isn't misread as "everything except in-progress" (bare "started"
  // is also a synonym for in_progress, checked further down, and would
  // otherwise win because in_progress is checked before todo).
  if (/\bnot\s+started\b/i.test(message)) return { value: 'todo', negated: false };
  for (const [value, wordRe] of STATUS_WORD_GROUPS) {
    if (new RegExp(NEGATION_PREFIX + wordRe + '\\b', 'i').test(message)) return { value, negated: true };
  }
  for (const [value, wordRe] of STATUS_WORD_GROUPS) {
    if (new RegExp('\\b' + wordRe + '\\b', 'i').test(message)) return { value, negated: false };
  }
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
  const statusResult = requestedTaskStatus(t);
  const statusFilter = statusResult && !statusResult.negated ? statusResult.value : null;
  // e.g. "tasks excluding done" / "tasks not cancelled" — the exact same
  // inversion risk that "without overdue" had, generalized: EVERY status
  // word this function recognizes can be negated, not just deadline's
  // "overdue", so this is handled the same way rather than one-off.
  const excludeStatusFilter = statusResult?.negated ? statusResult.value : null;
  // Only treated as a real priority FILTER when it's the "<level> priority"
  // shape (or "priority tasks" with no level, which just means "sort of
  // priority" and doesn't set a filter on its own) — a bare "priority"
  // elsewhere (e.g. "what is the priority of task X", "update priority")
  // is a field query/mutation, not a list filter. See hasNonFilterPriorityMention below.
  const priorityResult = requestedTaskPriority(t);
  const priorityFilter = priorityResult && !priorityResult.negated ? priorityResult.value : null;
  const excludePriorityFilter = priorityResult?.negated ? priorityResult.value : null;
  // Same reasoning as priorityFilter above — only a real filter shape
  // ("overdue"/"due today"/"due this week"/"no deadline") counts; a bare
  // "deadline" elsewhere (e.g. "what is the deadline of task X", "update
  // deadline") is a field query/mutation, not a list filter.
  const deadlineFilter = requestedTaskDeadline(t);
  // "assigned by NAME" / "created by NAME" — independent of assignee_name
  // (who the task is FOR) and every other filter; any combination of all of
  // these must resolve correctly together, not just the ones seen so far.
  const creatorName = requestedCreatorName(t);
  // "all my tasks" / "list all of my tasks" means every one of the caller's
  // own tasks, not every task in the org — self-reference always wins over
  // the generic all-scope keyword.
  const isSelfRef = /\b(my|mine|me)\b/i.test(t);
  // Name-extraction runs against the modifier-stripped text so trailing or
  // leading filter phrases never break the anchors below or get captured as
  // part of the name — e.g. "tushar's tasks without overdue" (trailing) and
  // "All tushar's tasks" (a leading "all" that means "every one of tushar's
  // tasks," not org-wide scope — see hasValidPossessiveName below) both need
  // this to resolve to a bare "tushar".
  const tClean = stripFilterModifiers(t);
  // Safety net: if a negation word survives modifier-stripping, it wasn't
  // consumed as part of a filter phrase this function specifically knows how
  // to resolve — e.g. "tasks not assigned to anyone", or a negation word
  // used in some other phrasing this function has never been taught. Rather
  // than risk silently ignoring the negation (or worse, a positive filter
  // word elsewhere in the same message flipping the meaning, as happened
  // live with "All tushar's tasks without overdue" before that specific
  // phrase was hand-taught), bail out and let the AI parse it instead: it
  // still calls the same real list_tasks tool against the same real
  // database — actual language understanding of arbitrary phrasing, backed
  // by real data and the fabrication guard, instead of an ever-growing list
  // of hand-coded exceptions that can never cover everything a user might type.
  if (/\b(?:without|excluding|except|not|never|besides|apart\s+from|other\s+than|leave\s+out|leaving\s+out|skip(?:ping)?)\b/i.test(tClean)) {
    return null;
  }
  // "NAME's all tasks" / "NAME's tasks" / "All NAME's tasks" names a
  // specific person — "all" here means "every status for that person," not
  // "everyone in the org," regardless of which side of "'s" it sits on.
  // Checked up front so a named possessive always wins over a bare "all"
  // keyword (observed live: "Rashmi's all tasks" and "All tushar's tasks"
  // both returned the org-wide list instead of that person's own tasks).
  // Excludes the same generic/scope words the all-scope check itself
  // matches, so "team's tasks"/"everyone's tasks" still correctly fall
  // through to org-wide scope below.
  // Anchored on "tasks" with a word boundary (\b), NOT end-of-string ($) —
  // trailing text this function doesn't specifically recognize (a typo, an
  // unhandled word order, an extra clause) must never be able to silently
  // wipe out an otherwise-unambiguous name. Observed live: "Tushar Bali's
  // tasks priority high and overdued" left "priority and overdued" behind
  // after stripping (word-order + typo gaps), which broke an end-anchored
  // match entirely and dropped "Tushar Bali" to the org-wide list — the
  // exact same silent-failure shape as the negation bug, just without any
  // negation word involved. A word-boundary anchor degrades gracefully
  // instead: whatever trailing text survives stripping is simply ignored,
  // since it played no part in identifying who the tasks belong to.
  const possessiveName = tClean.match(/^(.+?)[’']s\s+(?:all\s+)?tasks?\b/i)?.[1]
    ?.replace(/^(?:please\s+)?(?:list|show|get|display|give|send|tell)(?:\s+me)?(?:\s+the)?\s+/i, '')
    .replace(/^of\s+/i, '')
    .replace(/^all\s+/i, '')
    .trim();
  const hasValidPossessiveName = !!possessiveName
    && !/^(?:all|every|each|entire|whole|everyone|everybody|team|staff|workforce|company|org|organisation|organization|the|of|a|an|my|mine|today|tomorrow|week|overdue)$/i.test(possessiveName);
  if (!/\btasks?\b/i.test(t)) return null;
  // "priority" alone used to be a blanket exclusion trigger (assumed to mean
  // a field query/mutation like "what is the priority of task X" or "update
  // priority to high") — but that also silently blocked genuine filter
  // phrasing like "high priority tasks" from ever reaching this router
  // (observed live: it fell through to the AI, which answered from the
  // caller's own — often empty — task list instead of a real priority
  // filter). Only still excludes "priority" when it's NOT part of the
  // "<level> priority" filter shape this function itself now recognizes.
  const hasNonFilterPriorityMention = /\bpriority\b/i.test(t) && !priorityFilter && !excludePriorityFilter;
  const hasNonFilterDeadlineMention = /\bdeadline\b/i.test(t) && !deadlineFilter;
  if ((/\b(details?|info|status|assignee|update|change|delete|remove|complete|finish|assign|create|add|note)\b/i.test(t) || hasNonFilterPriorityMention || hasNonFilterDeadlineMention)
    && !/\b(completed|complete|done|finished|closed)\s+tasks?\b/i.test(t) && !/\b(?:full|complete|total)\s+(?:task\s+)?list\b/i.test(t)) {
    return null;
  }
  if (isAllScope && !isSelfRef && !hasValidPossessiveName) {
    return {
      ...(statusFilter ? { status_filter: statusFilter } : {}),
      ...(excludeStatusFilter ? { exclude_status_filter: excludeStatusFilter } : {}),
      ...(priorityFilter ? { priority_filter: priorityFilter } : {}),
      ...(excludePriorityFilter ? { exclude_priority_filter: excludePriorityFilter } : {}),
      ...(deadlineFilter ? { deadline_filter: deadlineFilter } : {}),
      ...(creatorName ? { creator_name: creatorName } : {}),
      scope: 'all',
    };
  }
  // Gate on statusFilter/priorityFilter/deadlineFilter (not a separate
  // hardcoded word list) so every status requestedTaskStatus recognizes —
  // including "in progress"/"cancelled", which a previous, narrower version
  // of this list omitted and caused "<name> in progress tasks" to bypass the
  // deterministic route entirely. Same reasoning applies to deadlineFilter:
  // without it, a bare "overdue tasks" (no list/show/status/name keyword)
  // fell through to the AI, which was observed fabricating/mislabeling
  // overdue results (e.g. including an already-completed task). The exclude_*
  // variants gate the same way — a negated-only filter (e.g. "tasks
  // excluding done") must not fall through to null just because
  // statusFilter/priorityFilter themselves are unset. creatorName gates the
  // same way too — "tasks assigned by shilpa" alone (no other filter/verb/
  // name) must still route deterministically.
  if (!/\b(list|show|get|display)\b/i.test(t) && !statusFilter && !excludeStatusFilter && !priorityFilter && !excludePriorityFilter && !deadlineFilter && !creatorName && !isSelfRef && !hasValidPossessiveName && !/[’']s\s+tasks?$/i.test(t)) {
    return null;
  }

  const args: Record<string, string> = {};
  if (creatorName) args.creator_name = creatorName;
  if (statusFilter) args.status_filter = statusFilter;
  if (excludeStatusFilter) args.exclude_status_filter = excludeStatusFilter;
  if (priorityFilter) args.priority_filter = priorityFilter;
  if (excludePriorityFilter) args.exclude_priority_filter = excludePriorityFilter;
  if (deadlineFilter) args.deadline_filter = deadlineFilter;
  if (/\b(my|mine|me)\b/i.test(t)) {
    args.assignee_name = 'mine';
    return args;
  }
  if (hasValidPossessiveName) {
    args.assignee_name = possessiveName;
    return args;
  }

  // Anchored on "tasks?\b", not "tasks?$", for the same reason as
  // possessiveName above — trailing text this function doesn't specifically
  // recognize must be ignored, not allowed to silently break the match and
  // wipe out an otherwise-clear name. Pattern 6 (assigned-to/of/for) is the
  // one exception: the name there is captured at the very end of the
  // pattern, so relaxing its anchor would risk sweeping trailing garbage
  // INTO the captured name rather than past it.
  const personPatterns = [
    /^(?:list|show|get|display)(?:\s+me)?(?:\s+the)?\s+(.+?)(?:[’']s)?\s+(?:completed|done|finished)\s+tasks?\b/i,
    /^(.+?)[’']s\s+(?:completed|done|finished)\s+tasks?\b/i,
    /^(?:list|show|get|display)(?:\s+me)?(?:\s+the)?(?:\s+list)?\s+of\s+(.+?)(?:[’']s)?\s+tasks?\b/i,
    /^(.+?)[’']s\s+tasks?\b/i,
    /^(?:list|show|get|display)(?:\s+me)?(?:\s+the)?\s+(.+?)\s+tasks?\b/i,
    /^(?:(?:list|show|get|display)(?:\s+me)?(?:\s+the)?(?:\s+of)?\s+)?tasks?\s+(?:of|for|assigned\s+to)\s+(.+)$/i,
    // Bare "<name> tasks" with no possessive, verb prefix, or preposition at
    // all — e.g. "Ashish tasks" or "Ashish pending tasks" (the status word
    // is already stripped from taskOwnerText above). Lowest priority: only
    // reached when none of the more specific shapes above matched. Command
    // verbs are excluded below so "show tasks" doesn't get "show" read back
    // as a person's name.
    /^(.+?)\s+tasks?\b/i,
  ];
  for (const pattern of personPatterns) {
    // Reuse the same modifier-stripped text computed above for the
    // possessive-name check, instead of a second, independently-maintained
    // stripping chain — a filter word taught to one used to be able to drift
    // out of sync with the other (see stripFilterModifiers for the shared
    // reasoning, including why this must be unconditional, not just
    // adjacent-to-"tasks").
    const taskOwnerText = tClean;
    const match = taskOwnerText.match(pattern);
    const name = match?.[1]
      ?.replace(/^(?:please\s+)?(?:list|show|get|display|give|send|tell)(?:\s+me)?(?:\s+the)?\s+/i, '')
      ?.replace(/^of\s+/i, '')
      ?.replace(/^all\s+/i, '')
      .replace(/(?:[’']s)$/i, '')
      .trim();
    if (name && !/^(?:all|team|everyone|everybody|organisation|organization|company|pending|open|completed|done|finished|the|of|a|an|my|mine|list|show|get|display|find|give|send|tell|pull|fetch|check|urgent|high|medium|low|priority|overdue|deadline|today|tomorrow|week)$/i.test(name)) {
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

