const LOCALE = 'en-AU';
const TIMEZONE = 'Australia/Sydney';

export function formatMatchDate(date: string | Date): string {
  return new Date(date).toLocaleDateString(LOCALE, {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    timeZone: TIMEZONE,
  });
}

export function formatMatchTime(date: string | Date): string {
  return new Date(date).toLocaleTimeString(LOCALE, {
    hour: '2-digit',
    minute: '2-digit',
    timeZone: TIMEZONE,
  });
}

export function formatShortDate(date: string | Date): string {
  return new Date(date).toLocaleDateString(LOCALE, {
    month: 'short',
    day: 'numeric',
    timeZone: TIMEZONE,
  });
}

export function formatHeight(height: string): string {
  const match = height.match(/(\d+)\s*ft\s*(\d+)\s*in/i);
  if (match) {
    const cm = Math.round(parseInt(match[1]) * 30.48 + parseInt(match[2]) * 2.54);
    return `${cm} cm`;
  }
  return height;
}

export function computeAge(dateOfBirth: Date): number {
  const today = new Date();
  let age = today.getFullYear() - dateOfBirth.getFullYear();
  const monthDiff = today.getMonth() - dateOfBirth.getMonth();
  if (monthDiff < 0 || (monthDiff === 0 && today.getDate() < dateOfBirth.getDate())) {
    age--;
  }
  return age;
}
