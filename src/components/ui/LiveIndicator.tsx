interface LiveIndicatorProps {
  className?: string;
}

export function LiveIndicator({ className = '' }: LiveIndicatorProps) {
  return (
    <div className={`inline-flex items-center gap-1.5 ${className}`}>
      <span className="relative flex h-2 w-2">
        <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-secondary opacity-75" />
        <span className="relative inline-flex rounded-full h-2 w-2 bg-secondary" />
      </span>
      <span className="font-label text-[10px] font-bold uppercase tracking-tighter text-secondary">
        LIVE
      </span>
    </div>
  );
}
