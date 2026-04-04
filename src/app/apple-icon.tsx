import { ImageResponse } from 'next/og';

export const runtime = 'nodejs';
export const size = { width: 180, height: 180 };
export const contentType = 'image/png';

export default function AppleIcon() {
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
          borderRadius: 36,
        }}
      >
        {/* Outer pulse ring */}
        <div
          style={{
            position: 'absolute',
            width: 156,
            height: 156,
            borderRadius: '50%',
            border: '3px solid rgba(99, 102, 241, 0.3)',
            display: 'flex',
          }}
        />
        {/* Inner circle with gradient border */}
        <div
          style={{
            width: 124,
            height: 124,
            borderRadius: '50%',
            border: '4px solid #6366F1',
            background: 'rgba(99, 102, 241, 0.15)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <span
            style={{
              color: 'white',
              fontSize: 72,
              fontWeight: 800,
              fontFamily: 'system-ui, sans-serif',
              lineHeight: 1,
              marginTop: -2,
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
