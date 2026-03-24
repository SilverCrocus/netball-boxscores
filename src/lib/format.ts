const LOCALE = 'en-AU';

export function formatMatchDate(date: string | Date): string {
  return new Date(date).toLocaleDateString(LOCALE, {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
  });
}

export function formatMatchTime(date: string | Date): string {
  return new Date(date).toLocaleTimeString(LOCALE, {
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function formatShortDate(date: string | Date): string {
  return new Date(date).toLocaleDateString(LOCALE, {
    month: 'short',
    day: 'numeric',
  });
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
