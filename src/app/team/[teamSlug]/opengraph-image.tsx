import { ImageResponse } from 'next/og';
import { readFile } from 'fs/promises';
import { join } from 'path';
import { prisma } from '@/lib/db';

export const runtime = 'nodejs';
export const alt = 'Team Profile';
export const size = { width: 1200, height: 630 };
export const contentType = 'image/png';

export default async function TeamOgImage({
  params,
}: {
  params: Promise<{ teamSlug: string }>;
}) {
  const { teamSlug } = await params;
  const team = await prisma.team.findUnique({
    where: { slug: teamSlug },
    select: { name: true, abbreviation: true, logoUrl: true },
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
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          background: 'linear-gradient(135deg, #0D1117 0%, #1A1F2E 50%, #0D1117 100%)',
          fontFamily: 'Manrope',
          gap: 24,
        }}
      >
        {team?.logoUrl ? (
          <img
            src={team.logoUrl}
            alt={team.name}
            width={120}
            height={120}
            style={{ objectFit: 'contain' }}
          />
        ) : (
          <div style={{ display: 'flex', width: 120, height: 120, background: '#374151', borderRadius: 60, alignItems: 'center', justifyContent: 'center', fontSize: 48, color: '#fff', fontFamily: 'Lexend' }}>
            {team?.abbreviation?.[0] ?? '?'}
          </div>
        )}
        <div style={{ display: 'flex', fontSize: 48, fontWeight: 700, color: '#FFFFFF', fontFamily: 'Lexend' }}>
          {team?.name ?? 'Team'}
        </div>
        <div style={{ display: 'flex', fontSize: 24, color: '#94A3B8' }}>
          Suncorp Super Netball
        </div>
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
