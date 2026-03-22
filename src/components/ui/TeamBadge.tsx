import Image from 'next/image';

interface TeamBadgeProps {
  name: string;
  abbreviation: string;
  logoUrl?: string | null;
  size?: 'sm' | 'md' | 'lg';
}

const sizeClasses = {
  sm: { badge: 'w-8 h-8', text: 'text-xs', name: 'text-xs' },
  md: { badge: 'w-12 h-12', text: 'text-lg', name: 'text-sm' },
  lg: { badge: 'w-16 h-16', text: 'text-xl', name: 'text-base' },
};

export function TeamBadge({ name, abbreviation, logoUrl, size = 'md' }: TeamBadgeProps) {
  const s = sizeClasses[size];

  return (
    <div className="flex items-center gap-3">
      <div className={`${s.badge} rounded-lg bg-primary-container flex items-center justify-center overflow-hidden`}>
        {logoUrl ? (
          <Image src={logoUrl} alt={name} width={48} height={48} className="w-full h-full object-contain" />
        ) : (
          <span className={`${s.text} font-black italic text-white font-headline`}>
            {abbreviation.charAt(0)}
          </span>
        )}
      </div>
      <span className={`${s.name} font-bold font-headline text-primary uppercase`}>{name}</span>
    </div>
  );
}
