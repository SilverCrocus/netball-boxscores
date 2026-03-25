import { ImageResponse } from 'next/og';
import { readFile } from 'fs/promises';
import { join } from 'path';

export const runtime = 'nodejs';
export const alt = 'CentrePass - Suncorp Super Netball Scores';
export const size = { width: 1200, height: 630 };
export const contentType = 'image/png';

export default async function OgImage() {
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
        }}
      >
        <div
          style={{
            display: 'flex',
            fontSize: 72,
            fontWeight: 700,
            color: '#FFFFFF',
            fontFamily: 'Lexend',
            marginBottom: 16,
          }}
        >
          CentrePass
        </div>
        <div
          style={{
            display: 'flex',
            fontSize: 28,
            color: '#94A3B8',
            textAlign: 'center',
          }}
        >
          Suncorp Super Netball Scores, Stats & Fixtures
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
