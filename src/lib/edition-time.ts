export interface EditionMatchTimes {
  venue: string;
  viewer: string;
  venueTimeZone: string;
  viewerTimeZone: string;
  sameTimeZone: boolean;
}

function formatZonedDateTime(date: Date, timeZone: string): string {
  return new Intl.DateTimeFormat('en-AU', {
    timeZone,
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    hour: 'numeric',
    minute: '2-digit',
    timeZoneName: 'short',
  }).format(date);
}

export function formatEditionMatchTimes(
  date: Date,
  venueTimeZone: string,
  viewerTimeZone: string
): EditionMatchTimes {
  return {
    venue: formatZonedDateTime(date, venueTimeZone),
    viewer: formatZonedDateTime(date, viewerTimeZone),
    venueTimeZone,
    viewerTimeZone,
    sameTimeZone: venueTimeZone === viewerTimeZone,
  };
}
