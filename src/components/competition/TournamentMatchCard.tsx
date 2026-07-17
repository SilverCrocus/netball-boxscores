import Link from 'next/link';
import { TeamBadge } from '@/components/ui/TeamBadge';
import type {
  EditionScheduleFixture,
  EditionScheduleSide,
} from '@/lib/edition-schedule';

interface TournamentMatchCardProps {
  fixture: EditionScheduleFixture;
  presentationMode?: 'public' | 'draft-preview';
}

function TeamSide({ side, variant }: {
  side: EditionScheduleSide;
  variant: 'home' | 'away';
}) {
  return (
    <div className="flex min-w-0 flex-col items-center gap-2 text-center">
      {side.team ? (
        <TeamBadge team={side.team} size={52} variant={variant} />
      ) : (
        <span
          aria-hidden="true"
          className="flex h-[52px] w-[52px] items-center justify-center rounded-xl border border-dashed border-outline bg-surface-container text-xl font-black text-on-surface-variant"
        >
          ?
        </span>
      )}
      <span className="w-full break-words font-headline text-sm font-black uppercase leading-tight text-primary [overflow-wrap:anywhere] sm:text-base">
        {side.displayName}
      </span>
      {!side.resolved && (
        <span className="font-label text-[10px] font-bold uppercase tracking-wider text-on-surface-variant">
          Qualifier
        </span>
      )}
    </div>
  );
}

function CardContents({ fixture, presentationMode = 'public' }: TournamentMatchCardProps) {
  const scoreLabel = fixture.score
    ? `${fixture.sideA.displayName} ${fixture.score.sideA}, ${fixture.sideB.displayName} ${fixture.score.sideB}`
    : `${fixture.sideA.displayName} versus ${fixture.sideB.displayName}`;
  const live = fixture.status === 'LIVE';

  return (
    <>
      <div className="flex min-w-0 items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="break-words font-label text-[10px] font-black uppercase tracking-[0.16em] text-secondary [overflow-wrap:anywhere]">
            {fixture.contextLabel}
          </p>
          <time
            dateTime={fixture.scheduledAt.toISOString()}
            className="mt-1 block font-headline text-xl font-black tracking-tight text-primary"
          >
            {fixture.localTimeLabel}
          </time>
        </div>
        <span className={`shrink-0 rounded-full px-3 py-1 font-label text-[10px] font-black uppercase tracking-wider ${
          live
            ? 'bg-secondary text-white'
            : fixture.status === 'COMPLETED'
              ? 'bg-primary text-white'
              : 'bg-surface-container-high text-on-surface-variant'
        }`}>
          {fixture.statusLabel}
        </span>
      </div>

      <div
        className="my-6 grid min-w-0 grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center gap-3"
        aria-label={scoreLabel}
      >
        <TeamSide side={fixture.sideA} variant="home" />
        {fixture.score ? (
          <div className="flex items-center gap-2 font-headline text-3xl font-black tracking-tighter text-primary sm:text-4xl">
            <span>{fixture.score.sideA}</span>
            <span className="text-lg text-outline" aria-hidden="true">–</span>
            <span>{fixture.score.sideB}</span>
          </div>
        ) : (
          <span className="font-headline text-sm font-black uppercase italic text-outline" aria-hidden="true">
            v
          </span>
        )}
        <TeamSide side={fixture.sideB} variant="away" />
      </div>

      <div className="flex min-w-0 flex-wrap items-center justify-between gap-2 border-t border-surface-container pt-4">
        <span className="flex min-w-0 items-center gap-1.5 font-label text-[10px] font-bold uppercase tracking-wide text-on-surface-variant">
          <span className="material-symbols-outlined text-base" aria-hidden="true">location_on</span>
          <span className="break-words [overflow-wrap:anywhere]">{fixture.venue}</span>
        </span>
        {presentationMode === 'draft-preview' ? (
          <span className="font-label text-[10px] font-bold uppercase tracking-wide text-on-surface-variant">
            Private preview only
          </span>
        ) : fixture.href ? (
          <span className="flex items-center gap-1 font-label text-[10px] font-black uppercase tracking-wider text-secondary">
            Match centre
            <span className="material-symbols-outlined text-base transition-transform group-hover:translate-x-0.5" aria-hidden="true">
              arrow_forward
            </span>
          </span>
        ) : (
          <span className="font-label text-[10px] font-bold uppercase tracking-wide text-on-surface-variant">
            Awaiting qualification
          </span>
        )}
      </div>
    </>
  );
}

const cardClassName = 'group block h-full min-w-0 rounded-2xl border border-outline-variant/50 bg-surface-container-lowest p-5 shadow-sm transition-[box-shadow,border-color,transform] duration-200 hover:-translate-y-0.5 hover:border-secondary/50 hover:shadow-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-secondary focus-visible:ring-offset-2';

export function TournamentMatchCard({ fixture, presentationMode = 'public' }: TournamentMatchCardProps) {
  const label = `${fixture.sideA.displayName} versus ${fixture.sideB.displayName}, ${fixture.localTimeLabel}`;

  if (fixture.href && presentationMode === 'public') {
    return (
      <Link
        href={fixture.href}
        prefetch={false}
        aria-label={`Open ${label}`}
        className={cardClassName}
        data-testid="edition-fixture"
      >
        <CardContents fixture={fixture} presentationMode={presentationMode} />
      </Link>
    );
  }

  return (
    <article
      aria-label={label}
      className={cardClassName}
      data-testid="edition-fixture"
    >
      <CardContents fixture={fixture} presentationMode={presentationMode} />
    </article>
  );
}
