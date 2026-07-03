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
        const yr = m[3] ? m[3] : String(new Date().getFullYear());
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
        const yr = m[3] ? m[3] : String(new Date().getFullYear());
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
      if (m12[3].toLowerCase() === 'pm' && h !== 12) h += 12;
      if (m12[3].toLowerCase() === 'am' && h === 12) h = 0;
      hhmm = `${String(h).padStart(2,'0')}:${String(mn).padStart(2,'0')}`;
    } else {
      // "HH:MM" or "H:MM"
      const m24 = t.match(/^(\d{1,2}):(\d{2})$/);
      if (m24) hhmm = `${m24[1].padStart(2,'0')}:${m24[2]}`;
    }
  }

  // ── Build UTC ISO ─────────────────────────────────────────────────────────
  const dt = new Date(`${ymd}T${hhmm}:00+05:30`);
  return isNaN(dt.getTime()) ? null : dt.toISOString().slice(0, 19);
}

/** Convert a deadline string (UTC from DB) to YYYY-MM-DDTHH:MM in IST for datetime-local inputs */
export function toISTInputValue(isoStr: string): string {
  const d = deadlineToUTCDate(isoStr);
  if (isNaN(d.getTime())) return isoStr;
  return d.toLocaleString('sv-SE', { timeZone: 'Asia/Kolkata' }).slice(0, 16).replace(' ', 'T');
}
