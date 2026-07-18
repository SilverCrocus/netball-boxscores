import type { EditionFeatureFlags, FixtureLifecycleStatus } from '@/lib/edition-capabilities';

interface MatchCoverageNoticeProps {
  status: FixtureLifecycleStatus;
  features: EditionFeatureFlags;
}

const STATUS_COPY: Partial<Record<FixtureLifecycleStatus, { heading: string; body: string }>> = {
  SCHEDULED: {
    heading: 'Scheduled fixture',
    body: 'The fixture is confirmed. Scores and match statistics will appear here when result data becomes available.',
  },
  DELAYED: {
    heading: 'Match delayed',
    body: 'The fixture is delayed. CentrePass will show scores and statistics after play begins and data becomes available.',
  },
  POSTPONED: {
    heading: 'Match postponed',
    body: 'This fixture has been postponed. Check back after a new start time is confirmed.',
  },
  CANCELLED: {
    heading: 'Match cancelled',
    body: 'This fixture was cancelled, so no score or match statistics will be shown.',
  },
  ABANDONED: {
    heading: 'Match abandoned',
    body: 'This fixture was abandoned. Any result will remain unavailable until a final outcome is published.',
  },
};

export function MatchCoverageNotice({ status, features }: MatchCoverageNoticeProps) {
  const lifecycleCopy = STATUS_COPY[status];
  const detailsUnavailable = !features.playerBoxScore.available
    && !features.scoreFlow.available
    && !features.matchEvents.available;

  if (!lifecycleCopy && !detailsUnavailable) return null;

  const heading = lifecycleCopy?.heading ?? 'Detailed match data unavailable';
  const body = lifecycleCopy?.body
    ?? 'The result is available, but player statistics, momentum, and play-by-play have not been supplied for this match.';

  return (
    <section
      aria-labelledby="match-coverage-heading"
      className="mb-8 rounded-2xl border border-outline-variant/40 bg-surface-container-low px-6 py-7 text-center"
    >
      <span aria-hidden="true" className="material-symbols-outlined text-3xl text-secondary">
        {status === 'SCHEDULED' ? 'event_upcoming' : 'info'}
      </span>
      <h2 id="match-coverage-heading" className="mt-2 font-headline text-xl font-black text-primary">
        {heading}
      </h2>
      <p className="mx-auto mt-2 max-w-2xl text-sm leading-6 text-on-surface-variant">
        {body}
      </p>
    </section>
  );
}
