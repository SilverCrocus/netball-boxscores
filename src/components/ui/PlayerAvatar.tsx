'use client';

import { useState } from 'react';
import Image from 'next/image';

interface PlayerAvatarProps {
  name: string;
  photoUrl?: string | null;
  size?: number;
  className?: string;
  decorative?: boolean;
}

export function PlayerAvatar({ name, photoUrl, size = 32, className = '', decorative = false }: PlayerAvatarProps) {
  const [imgError, setImgError] = useState(false);

  const initials = name.split(' ').map((n) => n[0]).join('');

  if (!photoUrl || imgError) {
    return (
      <div
        role={decorative ? undefined : 'img'}
        aria-label={decorative ? undefined : name}
        aria-hidden={decorative || undefined}
        className={`flex shrink-0 items-center justify-center rounded-full bg-primary-container text-white ring-1 ring-white/30 ${className}`}
        style={{ width: size, height: size }}
      >
        <span
          aria-hidden="true"
          className="font-bold text-white"
          style={{ fontSize: size * 0.32 }}
        >
          {initials}
        </span>
      </div>
    );
  }

  return (
    <Image
      src={photoUrl}
      alt={decorative ? '' : name}
      width={size}
      height={size}
      className={`rounded-full object-cover shrink-0 ${className}`}
      style={{ width: size, height: size }}
      onError={() => setImgError(true)}
    />
  );
}
