const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

function dateTime(timeZone) {
  const context = vm.createContext({ Intl: {
    DateTimeFormat: function (locale, options) { return new Intl.DateTimeFormat(locale, { timeZone, ...options }); },
  } });
  return vm.runInContext(fs.readFileSync('frontend/test-case-date-time.js', 'utf8') + '\ntestCaseDateTime', context);
}

test('timestamps display in browser-local time with abbreviated English months and no seconds', () => {
  const source = '2026-03-23T22:59:39.49Z';
  assert.equal(dateTime('UTC').format(source), 'Mar 23, 2026, 10:59 PM');
  assert.equal(dateTime('America/New_York').format(source), 'Mar 23, 2026, 6:59 PM');
  assert.equal(dateTime('Asia/Shanghai').format(source), 'Mar 24, 2026, 6:59 AM');
  assert.equal(dateTime('UTC').format('2026-06-01T00:05:00Z'), 'Jun 1, 2026, 12:05 AM');
  assert.equal(dateTime('UTC').format('2026-06-01T12:05:00Z'), 'Jun 1, 2026, 12:05 PM');
});

test('date-only values keep the same calendar date and invalid timestamps have a fallback', () => {
  const dates = dateTime('America/New_York');
  assert.equal(dates.format('2024-02-29'), 'Feb 29, 2024');
  for (const value of [null, undefined, '', 'not a date', '2026-02-30', '2026-02-30T09:00:00Z', '2026-04-30Tbad']) {
    assert.equal(dates.format(value), 'Not recorded');
    assert.equal(dates.inRange(value, '2026-01-01', '2026-12-31'), false);
  }
});

test('local range boundaries follow both daylight saving transitions', () => {
  const dates = dateTime('America/New_York');
  assert.equal(dates.format('2026-03-08T06:59:00Z'), 'Mar 8, 2026, 1:59 AM');
  assert.equal(dates.format('2026-03-08T07:00:00Z'), 'Mar 8, 2026, 3:00 AM');
  assert.equal(dates.inRange('2026-03-08T04:59:59.999Z', '2026-03-08', '2026-03-08'), false);
  assert.equal(dates.inRange('2026-03-08T05:00:00Z', '2026-03-08', '2026-03-08'), true);
  assert.equal(dates.inRange('2026-03-09T03:59:59.999Z', '2026-03-08', '2026-03-08'), true);
  assert.equal(dates.inRange('2026-03-09T04:00:00Z', '2026-03-08', '2026-03-08'), false);
  const first = '2026-11-01T05:30:00Z', second = '2026-11-01T06:30:00Z';
  assert.equal(dates.format(first), dates.format(second));
  assert.ok(dates.parse(first) < dates.parse(second));
  assert.equal(dates.inRange(first, '2026-11-01', '2026-11-01'), true);
  assert.equal(dates.inRange(second, '2026-11-01', '2026-11-01'), true);
});
