import Link from 'next/link';
import Image from 'next/image';
import type { Position } from '@prisma/client';
import type { PositionConfig } from './position-config';
import { computeAge } from '@/lib/format';

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
    };
    teamId: string;
  };
  positionConfig: PositionConfig;
  statHighlightValues: (number | string)[];
}

export function PlayerHero({ player, positionConfig, statHighlightValues }: PlayerHeroProps) {
  const [firstName, ...restName] = player.name.split(' ');
  const lastName = restName.join(' ');

  return (
    <section className="kinetic-gradient rounded-xl overflow-hidden relative min-h-[500px] flex flex-col justify-end p-8 md:p-12 text-white shadow-2xl">
      {/* Back link */}
      <div className="absolute top-6 left-6 z-20">
        <Link
          href={`/team/${player.team.slug}`}
          className="inline-flex items-center gap-2 text-sm font-label text-slate-300 hover:text-white transition-colors"
        >
          <span className="material-symbols-outlined text-lg">arrow_back</span>
          {player.team.name}
        </Link>
      </div>

      <div className="relative z-10 w-full flex flex-col md:flex-row items-end justify-between gap-8 mt-12">
        {/* Left: photo + name + bio info */}
        <div className="flex-1 flex flex-col md:flex-row items-start md:items-end gap-8">
          {/* Player photo */}
          <div className="w-32 h-32 md:w-44 md:h-44 rounded-full overflow-hidden bg-white/10 backdrop-blur-xl border-4 border-lime-400 flex-shrink-0 shadow-inner">
            {player.photoUrl ? (
              <Image
                src={player.photoUrl}
                alt={player.name}
                width={176}
                height={176}
                className="w-full h-full object-cover"
              />
            ) : (
              <div className="w-full h-full flex items-center justify-center">
                <span className="font-headline font-black text-7xl text-lime-400 italic tracking-tighter">
                  {player.name.charAt(0)}
                </span>
              </div>
            )}
          </div>

          <div className="flex-1">
            {/* Position badge */}
            <div className="flex items-center gap-3 mb-3">
              <span className="bg-lime-400/20 text-lime-400 px-3 py-1 rounded-full font-label text-sm font-bold tracking-widest uppercase">
                {player.position}
              </span>
            </div>

            {/* Player name */}
            <h1 className="font-headline text-6xl md:text-8xl font-black italic tracking-tighter leading-none mb-4">
              {firstName}
              <br />
              <span className="text-lime-400">{lastName}</span>
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
                  <span>{player.height}</span>
                </>
              )}
              <span className="text-slate-500">&bull;</span>
              <Link
                href={`/team/${player.team.slug}`}
                className="text-lime-400 hover:text-lime-300 transition-colors font-bold"
              >
                {player.team.name}
              </Link>
            </p>
          </div>
        </div>

        {/* Right: stat highlights */}
        <div className="flex gap-4 md:gap-6 pb-2 flex-shrink-0">
          {positionConfig.highlights.map((highlight, i) => (
            <div
              key={highlight.key}
              className="bg-white/5 backdrop-blur-md px-5 py-4 rounded-xl border-l-4 border-lime-400 text-center min-w-[100px]"
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
