'use client';

import { useState } from 'react';
import Image from 'next/image';

interface PlayerAvatarProps {
  name: string;
  photoUrl?: string | null;
  size?: number;
  className?: string;
}

export function PlayerAvatar({ name, photoUrl, size = 32, className = '' }: PlayerAvatarProps) {
  const [imgError, setImgError] = useState(false);

  const initials = name.split(' ').map((n) => n[0]).join('');

  if (!photoUrl || imgError) {
    return (
      <div
        className={`rounded-full bg-primary-container/20 flex items-center justify-center shrink-0 ${className}`}
        style={{ width: size, height: size }}
      >
        <span
          className="font-bold text-primary-container"
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
      alt={name}
      width={size}
      height={size}
      className={`rounded-full object-cover shrink-0 ${className}`}
      style={{ width: size, height: size }}
      onError={() => setImgError(true)}
    />
  );
}
