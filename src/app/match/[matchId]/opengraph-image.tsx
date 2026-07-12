import { ImageResponse } from 'next/og';
import { readFile } from 'fs/promises';
import { join } from 'path';
import { prisma } from '@/lib/db';

export const runtime = 'nodejs';
export const alt = 'Match Score';
export const size = { width: 1200, height: 630 };
export const contentType = 'image/png';

export default async function MatchOgImage({
  params,
}: {
  params: Promise<{ matchId: string }>;
}) {
  const { matchId } = await params;
  const match = await prisma.match.findUnique({
    where: { id: matchId },
    select: {
      round: true,
      venue: true,
      status: true,
      homeScore: true,
      awayScore: true,
      homeTeam: { select: { name: true, abbreviation: true, logoUrl: true } },
      awayTeam: { select: { name: true, abbreviation: true, logoUrl: true } },
    },
  });

  const lexendBold = await readFile(
    join(process.cwd(), 'src/assets/fonts/Lexend-Bold.ttf'),
  );
  const manropeRegular = await readFile(
    join(process.cwd(), 'src/assets/fonts/Manrope-Regular.ttf'),
  );

  const isCompleted = match?.status === 'COMPLETED';
  const homeName = match?.homeTeam.abbreviation ?? 'HOME';
  const awayName = match?.awayTeam.abbreviation ?? 'AWAY';

  return new ImageResponse(
    (
      <div
        style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          background: 'linear-gradient(135deg, #0D1117 0%, #1A1F2E 50%, #0D1117 100%)',
          fontFamily: 'Manrope',
          gap: 24,
        }}
      >
        {/* Round label */}
        <div style={{ display: 'flex', fontSize: 24, color: '#94A3B8' }}>
          Round {match?.round ?? '?'}
        </div>

        {/* Score row */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 48 }}>
          {/* Home team */}
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 12 }}>
            {match?.homeTeam.logoUrl ? (
              <img
                src={match.homeTeam.logoUrl}
                alt={match.homeTeam.name}
                width={80}
                height={80}
                style={{ objectFit: 'contain' }}
              />
            ) : (
              <div style={{ display: 'flex', width: 80, height: 80, background: '#374151', borderRadius: 40, alignItems: 'center', justifyContent: 'center', fontSize: 32, color: '#fff', fontFamily: 'Lexend' }}>
                {homeName[0]}
              </div>
            )}
            <div style={{ display: 'flex', fontSize: 24, color: '#E2E8F0', fontFamily: 'Lexend' }}>
              {homeName}
            </div>
          </div>

          {/* Score or VS */}
          <div style={{ display: 'flex', fontSize: 64, color: '#FFFFFF', fontFamily: 'Lexend', fontWeight: 700 }}>
            {isCompleted ? `${match?.homeScore} - ${match?.awayScore}` : 'vs'}
          </div>

          {/* Away team */}
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 12 }}>
            {match?.awayTeam.logoUrl ? (
              <img
                src={match.awayTeam.logoUrl}
                alt={match.awayTeam.name}
                width={80}
                height={80}
                style={{ objectFit: 'contain' }}
              />
            ) : (
              <div style={{ display: 'flex', width: 80, height: 80, background: '#374151', borderRadius: 40, alignItems: 'center', justifyContent: 'center', fontSize: 32, color: '#fff', fontFamily: 'Lexend' }}>
                {awayName[0]}
              </div>
            )}
            <div style={{ display: 'flex', fontSize: 24, color: '#E2E8F0', fontFamily: 'Lexend' }}>
              {awayName}
            </div>
          </div>
        </div>

        {/* Venue */}
        <div style={{ display: 'flex', fontSize: 20, color: '#64748B' }}>
          {match?.venue ?? ''}
        </div>

        {/* Branding */}
        <div style={{ display: 'flex', position: 'absolute', bottom: 24, right: 32, fontSize: 18, color: '#475569', fontFamily: 'Lexend' }}>
          CentrePass
        </div>
      </div>
    ),
    {
      ...size,
      fonts: [
        { name: 'Lexend', data: lexendBold, weight: 700, style: 'normal' },
        { name: 'Manrope', data: manropeRegular, weight: 400, style: 'normal' },
      ],
    },
  );
}
