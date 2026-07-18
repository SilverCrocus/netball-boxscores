'use client';

import Image from 'next/image';
import { useState } from 'react';
import { countryFlagForTeam } from '@/lib/country-flags';

interface TeamBadgeProps {
  team: {
    name: string;
    abbreviation: string;
    logoUrl?: string | null;
  };
  size: number;
  variant?: 'home' | 'away';
  className?: string;
}

export function TeamBadge({ team, size, variant = 'home', className = '' }: TeamBadgeProps) {
  const [failedUrl, setFailedUrl] = useState<string | null>(null);
  const fallbackBg = variant === 'home' ? 'bg-primary-container' : 'bg-surface-container-high';
  const fallbackText = variant === 'home' ? 'text-white' : 'text-primary';
  const usableLogoUrl = team.logoUrl && team.logoUrl !== failedUrl ? team.logoUrl : null;
  const countryFlag = countryFlagForTeam(team);

  if (usableLogoUrl) {
    return (
      <Image
        src={usableLogoUrl}
        alt={`${team.name} badge`}
        width={size}
        height={size}
        className={`object-contain ${className}`}
        onError={() => setFailedUrl(usableLogoUrl)}
      />
    );
  }

  if (countryFlag) {
    return (
      <Image
        src={countryFlag}
        alt={`${team.name} flag`}
        width={size}
        height={size}
        unoptimized
        className={`rounded-lg border border-outline-variant/40 bg-white object-contain shadow-sm ${className}`}
        style={{
          width: size,
          height: size,
          borderRadius: Math.max(4, Math.round(size * 0.16)),
        }}
      />
    );
  }

  // Letter fallback
  return (
    <div
      role="img"
      aria-label={`${team.name} badge`}
      className={`flex items-center justify-center overflow-hidden rounded-lg font-black italic font-headline ${fallbackBg} ${fallbackText} ${className}`}
      style={{
        width: size,
        height: size,
        fontSize: Math.max(8, Math.round(size * 0.34)),
        lineHeight: 1,
      }}
    >
      {team.abbreviation.slice(0, 3)}
    </div>
  );
}
