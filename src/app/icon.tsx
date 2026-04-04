import { ImageResponse } from 'next/og';
import { readFile } from 'fs/promises';
import { join } from 'path';

export const runtime = 'nodejs';
export const size = { width: 32, height: 32 };
export const contentType = 'image/png';

export default async function Icon() {
  const imageData = await readFile(join(process.cwd(), 'public/netball-cleaned-white.png'));
  const base64 = imageData.toString('base64');
  const dataUrl = `data:image/png;base64,${base64}`;

  return new ImageResponse(
    (
      <div
        style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          background: '#0D1117',
          borderRadius: 6,
        }}
      >
        <img
          src={dataUrl}
          width={26}
          height={26}
          style={{ objectFit: 'contain' }}
        />
      </div>
    ),
  );
}
