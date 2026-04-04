'use client';

import { useState, useEffect } from 'react';

interface CountdownProps {
  scheduledAt: string;
}

export function Countdown({ scheduledAt }: CountdownProps) {
  const [minutes, setMinutes] = useState<number | null>(null);

  useEffect(() => {
    function calc() {
      const diff = new Date(scheduledAt).getTime() - Date.now();
      if (diff <= 0) {
        setMinutes(null);
        return;
      }
      const mins = Math.ceil(diff / 60000);
      setMinutes(mins <= 60 ? mins : null);
    }

    calc();
    const timer = setInterval(calc, 15000);
    return () => clearInterval(timer);
  }, [scheduledAt]);

  if (minutes === null) return null;

  return (
    <span className="inline-flex items-center gap-1.5 bg-lime-400/20 text-lime-400 px-3 py-1 rounded-full text-xs font-bold font-label uppercase tracking-wide">
      <span className="material-symbols-outlined text-sm">timer</span>
      {minutes}m
    </span>
  );
}
