import Link from 'next/link';
import Image from 'next/image';
import type { Position } from '@prisma/client';
import type { PositionConfig } from './position-config';
import { PlayerAvatar } from '@/components/ui/PlayerAvatar';
import { computeAge, formatHeight } from '@/lib/format';

interface PlayerHeroProps {
  player: {
    name: string;
    position: Position;
    photoUrl: string | null;
    nationality: string | null;
    dateOfBirth: Date | null;
    height: string | null;
    team: {
      name: string;
      slug: string;
      logoUrl: string | null;
      primaryColor: string | null;
    };
    teamId: string;
  };
  positionConfig: PositionConfig;
  statHighlightValues: (number | string)[];
}

export function PlayerHero({ player, positionConfig, statHighlightValues }: PlayerHeroProps) {
  const [firstName, ...restName] = player.name.split(' ');
  const lastName = restName.join(' ');
  const teamColor = player.team.primaryColor || '#a3e635';

  return (
    <section className="kinetic-gradient relative overflow-hidden rounded-xl p-4 text-white shadow-2xl sm:p-8 md:p-12">
      {/* Ghost text watermark */}
      <div className="absolute top-4 right-8 text-[8rem] md:text-[10rem] font-headline font-black italic leading-none text-white/[0.03] select-none pointer-events-none tracking-tighter">
        {lastName.toUpperCase()}
      </div>

      {/* Back link */}
      <div className="mb-6 min-w-0 sm:mb-8">
        <Link
          href={`/team/${player.team.slug}`}
          className="inline-flex max-w-full items-center gap-2 text-sm font-label text-slate-300 transition-colors hover:text-white"
        >
          <span className="material-symbols-outlined text-lg">arrow_back</span>
          <span className="truncate">{player.team.name}</span>
        </Link>
      </div>

      <div className="relative z-10 flex w-full min-w-0 flex-col items-stretch justify-between gap-8 md:flex-row md:items-end">
        {/* Left: photo + name + bio info */}
        <div className="flex min-w-0 flex-1 flex-col items-start gap-6 md:flex-row md:items-end md:gap-8">
          {/* Player photo */}
          <div
            className="w-32 h-32 md:w-44 md:h-44 rounded-full overflow-hidden bg-white/10 backdrop-blur-xl border-4 flex-shrink-0 shadow-inner"
            style={{ borderColor: teamColor }}
          >
            <PlayerAvatar
              name={player.name}
              photoUrl={player.photoUrl}
              size={176}
              className="!h-full !w-full !rounded-none"
            />
          </div>

          <div className="min-w-0 flex-1">
            {/* Position badge */}
            <div className="flex items-center gap-3 mb-3">
              <span
                className="px-3 py-1 rounded-full font-label text-sm font-bold tracking-widest uppercase"
                style={{ backgroundColor: `${teamColor}33`, color: teamColor }}
              >
                {player.position}
              </span>
            </div>

            {/* Player name */}
            <h1 className="mb-4 max-w-full font-headline text-4xl font-black italic leading-none tracking-tighter text-white break-words [overflow-wrap:anywhere] sm:text-6xl md:text-7xl">
              {firstName}
              <br />
              {lastName}
            </h1>

            {/* Bio info line */}
            <p className="font-headline text-lg md:text-xl text-slate-300 tracking-tight flex flex-wrap items-center gap-x-3 gap-y-1">
              {player.nationality && (
                <span>{player.nationality}</span>
              )}
              {player.dateOfBirth && (
                <>
                  <span className="text-slate-500">&bull;</span>
                  <span>Age {computeAge(player.dateOfBirth)}</span>
                </>
              )}
              {player.height && (
                <>
                  <span className="text-slate-500">&bull;</span>
                  <span>{formatHeight(player.height)}</span>
                </>
              )}
              {player.team.logoUrl && (
                <Image
                  src={player.team.logoUrl}
                  alt={player.team.name}
                  width={32}
                  height={32}
                  className="h-8 w-8 shrink-0 object-contain"
                />
              )}
              <Link
                href={`/team/${player.team.slug}`}
                className="hover:opacity-80 transition-colors font-bold"
                style={{ color: teamColor }}
              >
                {player.team.name}
              </Link>
            </p>
          </div>
        </div>

        {/* Right: stat highlights */}
        <div
          aria-label="Player highlights"
          className="flex w-full max-w-full flex-shrink-0 snap-x snap-mandatory justify-start gap-3 overflow-x-auto pb-3 md:w-auto md:gap-6 md:pb-2"
        >
          {positionConfig.highlights.map((highlight, i) => (
            <div
              key={highlight.key}
              className="min-w-[8.5rem] flex-1 snap-start rounded-xl border-l-4 bg-white/5 px-4 py-4 text-center backdrop-blur-md md:min-w-[100px] md:flex-none md:px-5"
              style={{ borderLeftColor: teamColor }}
            >
              <p className="font-label text-slate-400 text-xs uppercase tracking-widest mb-2">
                {highlight.label}
              </p>
              <p className="font-headline text-3xl md:text-4xl font-black text-white italic">
                {highlight.format === 'percentage'
                  ? `${statHighlightValues[i]}%`
                  : statHighlightValues[i]}
              </p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
