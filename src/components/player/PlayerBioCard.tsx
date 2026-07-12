'use client';

import { useId, useState } from 'react';

interface PlayerBioCardProps {
  biography: string | null;
}

const TRUNCATE_LENGTH = 300;

export function PlayerBioCard({ biography }: PlayerBioCardProps) {
  const [expanded, setExpanded] = useState(false);
  const biographyId = useId();

  if (!biography) return null;

  const isLong = biography.length > TRUNCATE_LENGTH;
  const displayText = isLong && !expanded
    ? biography.slice(0, TRUNCATE_LENGTH).trimEnd() + '...'
    : biography;

  return (
    <div className="bg-surface-container-lowest rounded-2xl p-8 shadow-sm">
      <h2 className="font-headline text-2xl font-black text-primary uppercase tracking-tight mb-4">
        About
      </h2>
      <p id={biographyId} className="font-body text-on-surface-variant leading-relaxed">
        {displayText}
      </p>
      {isLong && (
        <button
          type="button"
          onClick={() => setExpanded(!expanded)}
          aria-expanded={expanded}
          aria-controls={biographyId}
          className="mt-3 font-body text-sm font-semibold text-secondary hover:text-secondary/80 transition-colors"
        >
          {expanded ? 'Read less' : 'Read more'}
        </button>
      )}
    </div>
  );
}
