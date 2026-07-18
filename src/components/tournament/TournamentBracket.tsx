import { TeamBadge } from '@/components/ui/TeamBadge';
import type {
  TournamentBracketMatch,
  TournamentBracketSide,
  TournamentBracketStage,
} from '@/lib/tournament/types';

interface TournamentBracketProps {
  stages: TournamentBracketStage[];
  sourceTimezone: string;
}
const STAGE_STYLES: Record<TournamentBracketStage['type'], {
  eyebrow: string;
  accent: string;
  marker: string;
}> = {
  CLASSIFICATION: {
    eyebrow: 'Final placing',
    accent: 'border-l-outline',
    marker: 'bg-outline',
  },
  SEMI_FINALS: {
    eyebrow: 'Medal qualification',
    accent: 'border-l-primary-container',
    marker: 'bg-primary-container',
  },
  MEDAL_MATCHES: {
    eyebrow: 'Podium',
    accent: 'border-l-secondary',
    marker: 'bg-secondary',
  },
};

function formatVenueDateTime(value: string, timeZone: string): string {
  return new Intl.DateTimeFormat('en-AU', {
    timeZone,
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    hour: 'numeric',
    minute: '2-digit',
    timeZoneName: 'short',
  }).format(new Date(value));
}

function statusLabel(status: string): string {
  return status.toLowerCase().replaceAll('_', ' ').replace(/^./, (letter) => letter.toUpperCase());
}

function BracketSide({ side }: { side: TournamentBracketSide }) {
  return (
    <div className={`grid min-h-16 grid-cols-[auto_1fr_auto] items-center gap-3 rounded-xl px-3 py-3 ${
      side.resolved ? 'bg-surface-container-low' : 'border border-dashed border-outline-variant bg-surface'
    }`}>
      {side.team ? (
        <TeamBadge team={side.team} size={36} variant="away" />
      ) : (
        <span
          aria-hidden="true"
          className="flex h-9 w-9 items-center justify-center rounded-lg bg-surface-container-high text-on-surface-variant"
        >
          <span className="material-symbols-outlined text-[19px]">route</span>
        </span>
      )}
      <span className="min-w-0">
        <span className={`block font-headline text-sm font-bold leading-tight ${
          side.resolved ? 'text-primary' : 'text-on-surface-variant'
        }`}>
          {side.label}
        </span>
        {!side.resolved ? (
          <span className="mt-1 block font-label text-[9px] font-bold uppercase tracking-[0.13em] text-outline">
            Qualification route
          </span>
        ) : null}
      </span>
      {side.score !== null ? (
        <span className="font-headline text-2xl font-black text-primary" aria-label={`${side.score} goals`}>
          {side.score}
        </span>
      ) : null}
    </div>
  );
}

function BracketMatchCard({
  match,
  sourceTimezone,
}: {
  match: TournamentBracketMatch;
  sourceTimezone: string;
}) {
  const headingId = `${match.id}-heading`;
  return (
    <article className="rounded-2xl border border-outline-variant bg-surface-container-lowest p-4 shadow-md">
      <header className="mb-4 flex items-start justify-between gap-3">
        <div>
          <h4 id={headingId} className="font-headline text-sm font-black uppercase leading-tight text-primary">
            {match.label}
          </h4>
          <p className="mt-1 font-label text-[10px] font-semibold text-on-surface-variant">
            {formatVenueDateTime(match.scheduledAt, sourceTimezone)} · {match.venue}
          </p>
        </div>
        <span className="shrink-0 rounded-full bg-surface-container px-2.5 py-1 font-label text-[9px] font-bold uppercase tracking-wider text-on-surface-variant">
          {statusLabel(match.status)}
        </span>
      </header>
      <div className="space-y-2" aria-labelledby={headingId}>
        <BracketSide side={match.sideA} />
        <div className="flex items-center gap-2 px-3" aria-hidden="true">
          <span className="h-px flex-1 bg-outline-variant" />
          <span className="font-label text-[9px] font-black uppercase tracking-[0.18em] text-outline">vs</span>
          <span className="h-px flex-1 bg-outline-variant" />
        </div>
        <BracketSide side={match.sideB} />
      </div>
    </article>
  );
}

export function TournamentBracket({ stages, sourceTimezone }: TournamentBracketProps) {
  return (
    <div className="grid items-start gap-6 lg:grid-cols-3">
      {stages.map((stage) => {
        const style = STAGE_STYLES[stage.type];
        return (
          <section
            key={stage.id}
            aria-labelledby={`${stage.id}-heading`}
            className={`relative border-l-4 pl-4 ${style.accent}`}
          >
            <span
              aria-hidden="true"
              className={`absolute -left-[9px] top-2 h-3.5 w-3.5 rounded-full border-4 border-surface ${style.marker}`}
            />
            <header className="mb-4 pl-1">
              <p className="font-label text-[10px] font-bold uppercase tracking-[0.18em] text-on-surface-variant">
                {style.eyebrow}
              </p>
              <h3 id={`${stage.id}-heading`} className="mt-1 font-headline text-2xl font-black uppercase text-primary">
                {stage.name}
              </h3>
              <p className="mt-1 font-body text-xs text-on-surface-variant">
                {stage.matches.length} {stage.matches.length === 1 ? 'match' : 'matches'}
              </p>
            </header>
            <div className="space-y-4">
              {stage.matches.map((match) => (
                <BracketMatchCard
                  key={match.id}
                  match={match}
                  sourceTimezone={sourceTimezone}
                />
              ))}
            </div>
          </section>
        );
      })}
    </div>
  );
}
