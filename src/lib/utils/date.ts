import { format, parseISO, differenceInBusinessDays, addDays } from 'date-fns';

export function formatDate(dateStr: string): string {
  try {
    return format(parseISO(dateStr), 'dd MMM yyyy');
  } catch {
    return dateStr;
  }
}

export function formatTime(timeStr: string): string {
  const [h, m] = timeStr.split(':').map(Number);
  return `${h % 12 || 12}:${m.toString().padStart(2, '0')} ${h >= 12 ? 'PM' : 'AM'}`;
}

/** Parse a deadline string from the DB as a UTC Date.
 *  No-tz strings (timestamp column) are treated as UTC.
 *  Strings with tz info (Z or ±HH:MM) are parsed as-is. */
export function deadlineToUTCDate(dateStr: string): Date {
  const hasOffset = /Z$|[+-]\d{2}:\d{2}$/.test(dateStr.trim());
  return new Date(hasOffset ? dateStr : dateStr.replace(' ', 'T') + 'Z');
}

export function formatDateTime(dateStr: string): string {
  try {
    const d = deadlineToUTCDate(dateStr);
    // Intl.DateTimeFormat with explicit timeZone always gives IST regardless of
    // whether this runs on a Vercel (UTC) server or an IST browser.
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone: 'Asia/Kolkata',
      day: '2-digit', month: 'short', year: 'numeric',
      hour: '2-digit', minute: '2-digit', hour12: true,
    }).formatToParts(d);
    const get = (t: string) => parts.find(p => p.type === t)?.value ?? '';
    return `${get('day')} ${get('month')} ${get('year')}, ${get('hour')}:${get('minute')} ${get('dayPeriod').toUpperCase()}`;
  } catch {
    return dateStr;
  }
}

export function calcBusinessDays(start: string, end: string): number {
  try {
    const s = parseISO(start);
    const e = parseISO(end);
    return Math.max(1, differenceInBusinessDays(addDays(e, 1), s));
  } catch {
    return 1;
  }
}

/**
 * Returns today's date in YYYY-MM-DD format using IST (Asia/Kolkata).
 * UTC would give the wrong date after 11 PM IST (i.e. before 5:30 AM UTC next day).
 */
export function todayISO(): string {
  return new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });
}

/** Alias of todayISO() — explicitly signals IST intent at call sites */
export const todayIST = todayISO;

export function istNow(): string {
  return new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' });
}

/** Convert a deadline string (UTC from DB) to YYYY-MM-DDTHH:MM in IST for datetime-local inputs */
export function toISTInputValue(isoStr: string): string {
  const d = deadlineToUTCDate(isoStr);
  if (isNaN(d.getTime())) return isoStr;
  return d.toLocaleString('sv-SE', { timeZone: 'Asia/Kolkata' }).slice(0, 16).replace(' ', 'T');
}
