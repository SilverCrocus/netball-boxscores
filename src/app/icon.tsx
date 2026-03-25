import { ImageResponse } from 'next/og';

export const runtime = 'nodejs';
export const size = { width: 32, height: 32 };
export const contentType = 'image/png';

export default function Icon() {
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
        {/* Outer pulse ring */}
        <div
          style={{
            position: 'absolute',
            width: 28,
            height: 28,
            borderRadius: '50%',
            border: '1px solid rgba(99, 102, 241, 0.3)',
            display: 'flex',
          }}
        />
        {/* Inner circle with gradient border */}
        <div
          style={{
            width: 22,
            height: 22,
            borderRadius: '50%',
            border: '1.5px solid #6366F1',
            background: 'rgba(99, 102, 241, 0.15)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <span
            style={{
              color: 'white',
              fontSize: 14,
              fontWeight: 800,
              fontFamily: 'system-ui, sans-serif',
              lineHeight: 1,
              marginTop: -1,
            }}
          >
            C
          </span>
        </div>
      </div>
    ),
    { ...size },
  );
}
