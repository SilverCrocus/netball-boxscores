export const SYDNEY_TIME_ZONE = 'Australia/Sydney';

interface CalendarDate {
  year: number;
  month: number;
  day: number;
}

function getCalendarDate(date: Date, timeZone: string): CalendarDate {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date);

  const value = (type: Intl.DateTimeFormatPartTypes) =>
    Number(parts.find((part) => part.type === type)?.value);

  return { year: value('year'), month: value('month'), day: value('day') };
}

function getTimeZoneOffsetMs(date: Date, timeZone: string): number {
  const timeZoneName = new Intl.DateTimeFormat('en-US', {
    timeZone,
    timeZoneName: 'longOffset',
  }).formatToParts(date).find((part) => part.type === 'timeZoneName')?.value;
  const match = timeZoneName?.match(/^GMT([+-])(\d{2}):(\d{2})$/);
  if (!match) throw new Error(`Unable to determine offset for ${timeZone}`);

  const direction = match[1] === '+' ? 1 : -1;
  return direction * (Number(match[2]) * 60 + Number(match[3])) * 60_000;
}

function localMidnightToUtc(date: CalendarDate, timeZone: string): Date {
  const targetUtcMs = Date.UTC(date.year, date.month - 1, date.day);
  let utcMs = targetUtcMs;

  // Offset can differ between the UTC guess and the resolved local instant on
  // a DST transition day, so resolve until it stabilizes.
  for (let attempt = 0; attempt < 4; attempt++) {
    const resolvedUtcMs = targetUtcMs - getTimeZoneOffsetMs(new Date(utcMs), timeZone);
    if (resolvedUtcMs === utcMs) break;
    utcMs = resolvedUtcMs;
  }

  return new Date(utcMs);
}

function nextCalendarDate(date: CalendarDate): CalendarDate {
  const next = new Date(Date.UTC(date.year, date.month - 1, date.day + 1));
  return {
    year: next.getUTCFullYear(),
    month: next.getUTCMonth() + 1,
    day: next.getUTCDate(),
  };
}

export function getSydneyDayBounds(at: Date = new Date()): { start: Date; end: Date } {
  const localDate = getCalendarDate(at, SYDNEY_TIME_ZONE);
  return {
    start: localMidnightToUtc(localDate, SYDNEY_TIME_ZONE),
    end: localMidnightToUtc(nextCalendarDate(localDate), SYDNEY_TIME_ZONE),
  };
}
