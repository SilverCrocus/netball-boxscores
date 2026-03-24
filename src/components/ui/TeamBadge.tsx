// src/components/ui/TeamBadge.tsx
import Image from 'next/image';

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
  const fallbackBg = variant === 'home' ? 'bg-primary-container' : 'bg-surface-container-high';
  const fallbackText = variant === 'home' ? 'text-white' : 'text-primary';

  if (team.logoUrl) {
    return (
      <Image
        src={team.logoUrl}
        alt={`${team.name} badge`}
        width={size}
        height={size}
        className={`object-contain ${className}`}
      />
    );
  }

  // Letter fallback
  const textSize = size >= 64 ? 'text-3xl' : size >= 40 ? 'text-lg' : 'text-sm';
  return (
    <div
      className={`flex items-center justify-center rounded-lg font-black italic font-headline ${fallbackBg} ${fallbackText} ${textSize} ${className}`}
      style={{ width: size, height: size }}
    >
      {team.abbreviation.charAt(0)}
    </div>
  );
}
