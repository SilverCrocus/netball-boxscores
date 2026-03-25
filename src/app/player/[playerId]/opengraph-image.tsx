import { ImageResponse } from 'next/og';
import { readFile } from 'fs/promises';
import { join } from 'path';
import { prisma } from '@/lib/db';

export const runtime = 'nodejs';
export const alt = 'Player Profile';
export const size = { width: 1200, height: 630 };
export const contentType = 'image/png';

export default async function PlayerOgImage({
  params,
}: {
  params: Promise<{ playerId: string }>;
}) {
  const { playerId } = await params;
  const player = await prisma.player.findUnique({
    where: { id: playerId },
    select: {
      name: true,
      position: true,
      photoUrl: true,
      team: { select: { name: true, abbreviation: true, logoUrl: true } },
    },
  });

  const lexendBold = await readFile(
    join(process.cwd(), 'src/assets/fonts/Lexend-Bold.ttf'),
  );
  const manropeRegular = await readFile(
    join(process.cwd(), 'src/assets/fonts/Manrope-Regular.ttf'),
  );

  return new ImageResponse(
    (
      <div
        style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          alignItems: 'center',
          background: 'linear-gradient(135deg, #0D1117 0%, #1A1F2E 50%, #0D1117 100%)',
          fontFamily: 'Manrope',
          padding: 48,
          gap: 48,
        }}
      >
        {/* Player photo */}
        <div style={{ display: 'flex', flexShrink: 0 }}>
          {player?.photoUrl ? (
            <img
              src={player.photoUrl}
              width={200}
              height={200}
              style={{ objectFit: 'cover', borderRadius: 100 }}
            />
          ) : (
            <div style={{ display: 'flex', width: 200, height: 200, background: '#374151', borderRadius: 100, alignItems: 'center', justifyContent: 'center', fontSize: 64, color: '#fff', fontFamily: 'Lexend' }}>
              {player?.name?.[0] ?? '?'}
            </div>
          )}
        </div>

        {/* Player info */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <div style={{ display: 'flex', fontSize: 56, fontWeight: 700, color: '#FFFFFF', fontFamily: 'Lexend', lineHeight: 1.1 }}>
            {player?.name ?? 'Player'}
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
            <div style={{ display: 'flex', padding: '6px 16px', background: '#1E293B', borderRadius: 8, fontSize: 22, color: '#94A3B8', fontFamily: 'Lexend' }}>
              {player?.position ?? ''}
            </div>
            <div style={{ display: 'flex', fontSize: 24, color: '#94A3B8' }}>
              {player?.team.name ?? ''}
            </div>
          </div>
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
        { name: 'Lexend', data: lexendBold, weight: 700, style: 'normal' as const },
        { name: 'Manrope', data: manropeRegular, weight: 400, style: 'normal' as const },
      ],
    },
  );
}
