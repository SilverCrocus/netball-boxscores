interface StatCardProps {
  label: string;
  value: string;
  subtitle?: string;
  variant?: 'default' | 'dark';
  icon?: string;
}

export function StatCard({ label, value, subtitle, variant = 'default', icon }: StatCardProps) {
  const isDark = variant === 'dark';

  return (
    <div
      className={`rounded-xl p-6 relative overflow-hidden ${
        isDark
          ? 'bg-primary-container text-white'
          : 'bg-surface-container-low'
      }`}
    >
      {icon && (
        <div className="absolute -right-8 -bottom-8 opacity-10">
          <span className="material-symbols-outlined text-[96px]">{icon}</span>
        </div>
      )}
      <h4
        className={`text-[10px] font-bold font-label uppercase tracking-widest mb-4 ${
          isDark ? 'text-lime-400' : 'text-on-surface-variant'
        }`}
      >
        {label}
      </h4>
      <div className="flex items-end gap-2">
        <span
          className={`text-5xl font-black font-headline ${
            isDark ? 'text-white' : 'text-primary-container'
          }`}
        >
          {value}
        </span>
      </div>
      {subtitle && (
        <p
          className={`text-sm mt-2 font-label ${
            isDark ? 'text-on-primary-container' : 'text-on-surface-variant'
          }`}
        >
          {subtitle}
        </p>
      )}
    </div>
  );
}
