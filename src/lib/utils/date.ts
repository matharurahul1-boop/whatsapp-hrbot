import { format, parseISO, differenceInBusinessDays, addDays } from 'date-fns';

export function formatDate(dateStr: string): string {
  try {
    return format(parseISO(dateStr), 'dd MMM yyyy');
  } catch {
    return dateStr;
  }
}

export function formatDateTime(dateStr: string): string {
  try {
    return format(parseISO(dateStr), 'dd MMM yyyy, hh:mm a');
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
