const testCaseDateTime = (() => {
  const dateOnly = /^\d{4}-\d{2}-\d{2}$/;
  const timestamp = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/i;
  const displayDay = { month: 'short', day: 'numeric', year: 'numeric' };
  const calendarDate = new Intl.DateTimeFormat('en-US', { ...displayDay, timeZone: 'UTC' });
  const localTime = new Intl.DateTimeFormat('en-US', {
    ...displayDay, hour: 'numeric', minute: '2-digit', hour12: true,
  });
  const localDay = new Intl.DateTimeFormat('en-US', { year: 'numeric', month: '2-digit', day: '2-digit' });
  const parts = (format, date) => Object.fromEntries(format.formatToParts(date).map(({ type, value }) => [type, value]));

  function parse(value) {
    if (typeof value !== 'string' || (!dateOnly.test(value) && !timestamp.test(value))) return null;
    // Date accepts out-of-range calendar dates and normalizes them to another day.
    const day = value.slice(0, 10);
    const calendar = new Date(`${day}T00:00:00Z`);
    if (Number.isNaN(calendar.getTime()) || calendar.toISOString().slice(0, 10) !== day) return null;
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? null : date;
  }

  function format(value, fallback = 'Not recorded') {
    const date = parse(value);
    if (!date) return fallback;
    if (dateOnly.test(value)) return calendarDate.format(date);
    const { month, day, year, hour, minute, dayPeriod } = parts(localTime, date);
    return `${month} ${day}, ${year}, ${hour}:${minute} ${dayPeriod}`;
  }

  function dayKey(value) {
    const date = parse(value);
    if (!date) return '';
    if (dateOnly.test(value)) return value;
    const { year, month, day } = parts(localDay, date);
    return `${year.padStart(4, '0')}-${month}-${day}`;
  }

  function inRange(value, from, to) {
    if (!from && !to) return true;
    const day = dayKey(value);
    return Boolean(day && (!from || day >= from) && (!to || day <= to));
  }

  function isDateField(field, value) {
    return field?.type?.toLowerCase() === 'datetime'
      || (typeof value === 'string' && (dateOnly.test(value) || timestamp.test(value)));
  }

  return { parse, format, dayKey, inRange, isDateField };
})();
