const test = require('node:test');
const assert = require('node:assert/strict');

let dates;
test.before(async () => {
  dates = await import('../src/lib/utils/date.ts');
});

test('parses IST deadlines and relative dates deterministically', () => {
  const today = dates.todayISO();
  const tomorrow = new Date(`${today}T00:00:00Z`);
  tomorrow.setUTCDate(tomorrow.getUTCDate() + 1);
  const tomorrowYmd = tomorrow.toISOString().slice(0, 10);

  assert.equal(dates.parseDeadlineString('tomorrow 5pm'), `${tomorrowYmd}T11:30:00`);
  assert.equal(dates.parseDeadlineString('today noon'), `${today}T06:30:00`);
  assert.equal(dates.parseDeadlineString('in 3 days 09:15')?.slice(11), '03:45:00');
});

test('rejects impossible dates and times', () => {
  assert.equal(dates.parseDeadlineString('31-02-2026 5pm'), null);
  assert.equal(dates.parseDeadlineString('12-07-2026 25:00'), null);
  assert.equal(dates.parseDeadlineString('12-07-2026 13:99'), null);
  assert.equal(dates.parseDeadlineString('not a date someday'), null);
});

test('defaults date-only deadlines to 5 PM IST', () => {
  assert.equal(dates.parseDeadlineString('12-07-2026'), '2026-07-12T11:30:00');
});

test('business-day calculation rejects weekend-only ranges', () => {
  assert.equal(dates.calcBusinessDays('2026-07-11', '2026-07-12'), 0);
  assert.equal(dates.calcBusinessDays('2026-07-10', '2026-07-13'), 2);
});
