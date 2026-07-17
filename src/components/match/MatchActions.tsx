'use client';

import { useEffect, useState } from 'react';
import { useSession } from 'next-auth/react';
import { useRouter } from 'next/navigation';
import type { MatchStatus } from '@prisma/client';
import { matchHref } from '@/lib/edition-links';

interface MatchActionsProps {
  matchId: string;
  status: MatchStatus;
  competitionId: string;
}

interface UserMatchResource {
  matchId: string;
}

export function MatchActions({ matchId, status, competitionId }: MatchActionsProps) {
  const { status: sessionStatus } = useSession();
  const router = useRouter();
  const [favorite, setFavorite] = useState(false);
  const [reminder, setReminder] = useState(false);
  const [pending, setPending] = useState<'favorite' | 'reminder' | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    if (sessionStatus !== 'authenticated') return;
    const controller = new AbortController();

    async function load() {
      try {
        const [favoritesResponse, remindersResponse] = await Promise.all([
          fetch('/api/user/favorites', { signal: controller.signal }),
          status === 'SCHEDULED'
            ? fetch('/api/user/reminders', { signal: controller.signal })
            : Promise.resolve(null),
        ]);
        if (favoritesResponse.ok) {
          const favorites = await favoritesResponse.json() as UserMatchResource[];
          setFavorite(favorites.some((item) => item.matchId === matchId));
        }
        if (remindersResponse?.ok) {
          const reminders = await remindersResponse.json() as UserMatchResource[];
          setReminder(reminders.some((item) => item.matchId === matchId));
        }
      } catch (caught) {
        if (!(caught instanceof DOMException && caught.name === 'AbortError')) {
          setError('Could not load your match actions.');
        }
      }
    }

    void load();
    return () => controller.abort();
  }, [matchId, sessionStatus, status]);

  async function toggle(
    resource: 'favorite' | 'reminder',
    current: boolean,
    update: (value: boolean) => void,
  ) {
    if (sessionStatus !== 'authenticated') {
      const callbackUrl = matchHref(matchId, competitionId);
      router.push(`/auth/signin?callbackUrl=${encodeURIComponent(callbackUrl)}`);
      return;
    }

    setPending(resource);
    setError('');
    update(!current);
    try {
      const response = await fetch(`/api/user/${resource === 'favorite' ? 'favorites' : 'reminders'}`, {
        method: current ? 'DELETE' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ matchId }),
      });
      if (!response.ok) throw new Error('Request failed');
    } catch {
      update(current);
      const resourceLabel = resource === 'favorite' ? 'favourite' : 'reminder';
      setError(`Could not ${current ? 'remove' : 'add'} this ${resourceLabel}. Please try again.`);
    } finally {
      setPending(null);
    }
  }

  return (
    <div className="mb-10">
      <div className="flex flex-wrap justify-center gap-3">
        <button
          type="button"
          aria-pressed={favorite}
          disabled={pending === 'favorite'}
          onClick={() => toggle('favorite', favorite, setFavorite)}
          className={`inline-flex min-h-11 items-center gap-2 rounded-xl border px-4 font-headline text-sm font-bold transition-colors disabled:opacity-60 ${favorite ? 'border-secondary bg-secondary-container/20 text-secondary' : 'border-outline-variant text-primary'}`}
        >
          <span aria-hidden="true" className="material-symbols-outlined">{favorite ? 'favorite' : 'favorite_border'}</span>
          {favorite ? 'Favourited' : 'Favourite'}
        </button>
        {status === 'SCHEDULED' && (
          <button
            type="button"
            aria-pressed={reminder}
            disabled={pending === 'reminder'}
            onClick={() => toggle('reminder', reminder, setReminder)}
            className={`inline-flex min-h-11 items-center gap-2 rounded-xl border px-4 font-headline text-sm font-bold transition-colors disabled:opacity-60 ${reminder ? 'border-secondary bg-secondary-container/20 text-secondary' : 'border-outline-variant text-primary'}`}
          >
            <span aria-hidden="true" className="material-symbols-outlined">{reminder ? 'notifications_active' : 'notifications'}</span>
            {reminder ? 'Reminder set' : 'Remind me'}
          </button>
        )}
      </div>
      {status === 'SCHEDULED' && (
        <p className="mt-2 text-center font-label text-[11px] text-on-surface-variant">In-app reminder</p>
      )}
      {error && <p role="alert" className="mt-3 text-center text-sm text-error">{error}</p>}
    </div>
  );
}
