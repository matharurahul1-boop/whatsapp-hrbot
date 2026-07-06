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
    return Math.max(0, differenceInBusinessDays(addDays(e, 1), s));
  } catch {
    return 0;
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

const MONTH_MAP: Record<string, string> = {
  jan:'01', feb:'02', mar:'03', apr:'04', may:'05', jun:'06',
  jul:'07', aug:'08', sep:'09', oct:'10', nov:'11', dec:'12',
  january:'01', february:'02', march:'03', april:'04', june:'06',
  july:'07', august:'08', september:'09', october:'10', november:'11', december:'12',
};

/**
 * Convert a raw date string (any common format) + optional time string → UTC ISO
 * "2026-07-12 16:00" is already valid; this also handles:
 *   dd-mm-yyyy, dd/mm/yyyy, dd.mm.yyyy, dd-mm-yy (Indian formats)
 *   "12 Jul 2026", "Jul 12 2026", "12th July 2026", "July 12, 2026"
 *   "12-Jul-2026" (dashed month name)
 *   "tomorrow", "today", "next Monday", "in 3 days" (relative — needs todayIST)
 *
 * Time string accepts: "HH:MM", "4pm", "4:30pm", "4:30 PM", "16:00", "noon", "midnight"
 * Returns null when the date cannot be resolved.
 */
export function parseDeadlineToUTC(datePart: string, timePart: string): string | null {
  const d = datePart.trim();
  const t = timePart.trim();

  // ── Normalise date → yyyy-mm-dd ──────────────────────────────────────────
  let ymd: string | null = null;

  const baseYmd = todayISO();
  const addCalendarDays = (days: number) => {
    const base = new Date(`${baseYmd}T00:00:00Z`);
    base.setUTCDate(base.getUTCDate() + days);
    return base.toISOString().slice(0, 10);
  };
  if (/^today$/i.test(d)) ymd = baseYmd;
  else if (/^tomorrow$/i.test(d)) ymd = addCalendarDays(1);
  else if (/^(?:day after tomorrow|parso|parson)$/i.test(d)) ymd = addCalendarDays(2);
  else {
    const inDays = d.match(/^in\s+(\d{1,3})\s+days?$/i);
    if (inDays) ymd = addCalendarDays(Number(inDays[1]));
  }
  if (!ymd) {
    const nextWeekday = d.match(/^next\s+(sun(?:day)?|mon(?:day)?|tue(?:sday)?|wed(?:nesday)?|thu(?:rsday)?|fri(?:day)?|sat(?:urday)?)$/i);
    if (nextWeekday) {
      const target = ['sun','mon','tue','wed','thu','fri','sat'].indexOf(nextWeekday[1].slice(0, 3).toLowerCase());
      const base = new Date(`${baseYmd}T00:00:00Z`);
      let delta = (target - base.getUTCDay() + 7) % 7;
      if (delta === 0) delta = 7;
      ymd = addCalendarDays(delta);
    }
  }

  // 1. Already ISO: yyyy-mm-dd
  if (/^\d{4}-\d{2}-\d{2}$/.test(d)) {
    ymd = d;
  }

  // 2. dd-mm-yyyy / dd/mm/yyyy / dd.mm.yyyy  (Indian formats)
  if (!ymd) {
    const m = d.match(/^(\d{1,2})[-\/.](\d{1,2})[-\/.](\d{4})$/);
    if (m) ymd = `${m[3]}-${m[2].padStart(2,'0')}-${m[1].padStart(2,'0')}`;
  }

  // 3. dd-mm-yy / dd/mm/yy / dd.mm.yy  (2-digit year)
  if (!ymd) {
    const m = d.match(/^(\d{1,2})[-\/.](\d{1,2})[-\/.](\d{2})$/);
    if (m) ymd = `${2000 + +m[3]}-${m[2].padStart(2,'0')}-${m[1].padStart(2,'0')}`;
  }

  // 4. "12 Jul 2026", "12th July 2026"
  if (!ymd) {
    const m = d.match(/^(\d{1,2})(?:st|nd|rd|th)?\s+([a-zA-Z]+)(?:,?\s+(\d{4}))?$/i);
    if (m) {
      const mo = MONTH_MAP[m[2].toLowerCase()];
      if (mo) {
        let yr = m[3] ? m[3] : baseYmd.slice(0, 4);
        if (!m[3] && `${yr}-${mo}-${m[1].padStart(2,'0')}` < baseYmd) yr = String(Number(yr) + 1);
        ymd = `${yr}-${mo}-${m[1].padStart(2,'0')}`;
      }
    }
  }

  // 5. "Jul 12 2026", "July 12, 2026"
  if (!ymd) {
    const m = d.match(/^([a-zA-Z]+)\s+(\d{1,2})(?:st|nd|rd|th)?(?:,?\s+(\d{4}))?$/i);
    if (m) {
      const mo = MONTH_MAP[m[1].toLowerCase()];
      if (mo) {
        let yr = m[3] ? m[3] : baseYmd.slice(0, 4);
        if (!m[3] && `${yr}-${mo}-${m[2].padStart(2,'0')}` < baseYmd) yr = String(Number(yr) + 1);
        ymd = `${yr}-${mo}-${m[2].padStart(2,'0')}`;
      }
    }
  }

  // 6. "12-Jul-2026" (dashed month name)
  if (!ymd) {
    const m = d.match(/^(\d{1,2})-([a-zA-Z]+)-(\d{4})$/i);
    if (m) {
      const mo = MONTH_MAP[m[2].toLowerCase()];
      if (mo) ymd = `${m[3]}-${mo}-${m[1].padStart(2,'0')}`;
    }
  }

  if (!ymd) return null;

  // ── Normalise time → HH:MM (24h) ─────────────────────────────────────────
  let hhmm = '17:00';

  // "noon" / "midnight"
  if (/\bnoon\b/i.test(t))     hhmm = '12:00';
  else if (/\bmidnight\b/i.test(t)) hhmm = '00:00';
  else {
    // "4pm", "4:30pm", "4:30 pm", "4 PM"
    const m12 = t.match(/^(\d{1,2})(?::(\d{2}))?\s*(am|pm)$/i);
    if (m12) {
      let h = +m12[1];
      const mn = m12[2] ? +m12[2] : 0;
      if (h < 1 || h > 12 || mn > 59) return null;
      if (m12[3].toLowerCase() === 'pm' && h !== 12) h += 12;
      if (m12[3].toLowerCase() === 'am' && h === 12) h = 0;
      hhmm = `${String(h).padStart(2,'0')}:${String(mn).padStart(2,'0')}`;
    } else {
      // "HH:MM" or "H:MM"
      const m24 = t.match(/^(\d{1,2}):(\d{2})$/);
      if (m24) {
        if (+m24[1] > 23 || +m24[2] > 59) return null;
        hhmm = `${m24[1].padStart(2,'0')}:${m24[2]}`;
      } else if (t) {
        return null;
      }
    }
  }

  // ── Build UTC ISO ─────────────────────────────────────────────────────────
  const [year, month, day] = ymd.split('-').map(Number);
  const validDate = new Date(Date.UTC(year, month - 1, day));
  if (validDate.getUTCFullYear() !== year || validDate.getUTCMonth() !== month - 1 || validDate.getUTCDate() !== day) return null;
  const dt = new Date(`${ymd}T${hhmm}:00+05:30`);
  return isNaN(dt.getTime()) ? null : dt.toISOString().slice(0, 19);
}

/**
 * Parse a raw deadline string combining date + time in any format.
 * Unlike parseDeadlineToUTC (which needs date and time as separate args), this
 * handles mixed strings like:
 *   "12-07-2026 at 4pm"       → "12-07-2026" + "4pm"
 *   "12 Jul 2026, 04:00 PM"   → "12 Jul 2026" + "04:00 PM"
 *   "2026-07-12 16:00"        → "2026-07-12" + "16:00"
 *   "12-07-2026"              → date only, defaults time to 17:00
 */
export function parseDeadlineString(raw: string): string | null {
  // Strip "at" connector and trailing timezone labels (IST, UTC, GMT…)
  const s = raw.trim()
    .replace(/\s+at\s+/gi, ' ')
    .replace(/\s+(?:IST|UTC|GMT|PKT|BST|EST|PST|CST|MST)\b/gi, '');

  // Extract a time component from the END of the string.
  // Matches: "4pm", "4:30 pm", "04:00 PM", "16:00", "noon", "midnight"
  const timeRe = /(?:^|\s)(\d{1,2}(?::\d{2})?\s*(?:am|pm)|noon|midnight|\d{1,2}:\d{2})$/i;
  const timeMatch = s.match(timeRe);

  let datePart: string;
  let timePart: string;

  if (timeMatch) {
    timePart = timeMatch[1].trim();
    // Everything before the matched time is the date; strip trailing comma/semicolon
    datePart = s.slice(0, s.length - timeMatch[0].length).replace(/[,;]+$/, '').trim();
  } else {
    datePart = s.replace(/[,;]+$/, '').trim();
    timePart = '17:00';
  }

  return parseDeadlineToUTC(datePart || s, timePart);
}

/** Convert a deadline string (UTC from DB) to YYYY-MM-DDTHH:MM in IST for datetime-local inputs */
export function toISTInputValue(isoStr: string): string {
  const d = deadlineToUTCDate(isoStr);
  if (isNaN(d.getTime())) return isoStr;
  return d.toLocaleString('sv-SE', { timeZone: 'Asia/Kolkata' }).slice(0, 16).replace(' ', 'T');
}
