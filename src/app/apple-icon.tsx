import { ImageResponse } from 'next/og';
import { readFile } from 'fs/promises';
import { join } from 'path';

export const runtime = 'nodejs';
export const size = { width: 180, height: 180 };
export const contentType = 'image/png';

export default async function AppleIcon() {
  const imageData = await readFile(join(process.cwd(), 'public/netball-cleaned-black.png'));
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
          background: 'white',
          borderRadius: 36,
        }}
      >
        <img
          src={dataUrl}
          width={150}
          height={150}
          style={{ objectFit: 'contain' }}
        />
      </div>
    ),
  );
}
