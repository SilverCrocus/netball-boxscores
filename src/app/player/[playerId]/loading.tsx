export default function PlayerLoading() {
  return (
    <div className="max-w-7xl mx-auto space-y-8 animate-pulse">
      {/* Hero skeleton */}
      <div className="kinetic-gradient rounded-xl min-h-[500px] p-8 md:p-12 flex flex-col justify-end">
        <div className="flex flex-col md:flex-row items-start md:items-end gap-8">
          <div className="w-32 h-32 md:w-44 md:h-44 rounded-full bg-white/10 flex-shrink-0" />
          <div className="flex-1 space-y-4">
            <div className="h-6 w-20 bg-white/10 rounded-full" />
            <div className="h-16 w-80 bg-white/10 rounded" />
            <div className="h-10 w-64 bg-white/10 rounded" />
            <div className="h-4 w-48 bg-white/10 rounded" />
          </div>
          <div className="flex gap-4">
            <div className="w-28 h-24 bg-white/5 rounded-xl" />
            <div className="w-28 h-24 bg-white/5 rounded-xl" />
            <div className="w-28 h-24 bg-white/5 rounded-xl" />
          </div>
        </div>
      </div>

      {/* Stats + Charts skeleton */}
      <div className="grid grid-cols-1 md:grid-cols-12 gap-6">
        <div className="md:col-span-8 bg-surface-container-lowest rounded-2xl p-8 space-y-6">
          <div className="h-6 w-40 bg-surface-container-high rounded" />
          <div className="grid grid-cols-3 gap-8">
            <div className="space-y-3">
              <div className="h-12 w-24 bg-surface-container-high rounded" />
              <div className="h-3 w-20 bg-surface-container-high rounded" />
              <div className="h-1 w-full bg-surface-container-high rounded-full" />
            </div>
            <div className="space-y-3">
              <div className="h-12 w-24 bg-surface-container-high rounded" />
              <div className="h-3 w-20 bg-surface-container-high rounded" />
              <div className="h-1 w-full bg-surface-container-high rounded-full" />
            </div>
            <div className="space-y-3">
              <div className="h-12 w-24 bg-surface-container-high rounded" />
              <div className="h-3 w-20 bg-surface-container-high rounded" />
              <div className="h-1 w-full bg-surface-container-high rounded-full" />
            </div>
          </div>
          <div className="h-4 w-32 bg-surface-container-high rounded mt-4" />
          <div className="grid grid-cols-4 gap-4">
            {Array.from({ length: 8 }).map((_, i) => (
              <div key={i} className="h-16 bg-surface-container-low rounded-lg" />
            ))}
          </div>
        </div>
        <div className="md:col-span-4 bg-primary-container rounded-2xl p-8 space-y-4">
          <div className="h-5 w-32 bg-white/10 rounded" />
          <div className="h-40 flex items-end gap-2">
            {Array.from({ length: 6 }).map((_, i) => (
              <div
                key={i}
                className="flex-1 bg-lime-400/10 rounded-t-sm"
                style={{ height: `${30 + Math.random() * 60}%` }}
              />
            ))}
          </div>
        </div>
      </div>

      {/* Bio skeleton */}
      <div className="bg-surface-container-lowest rounded-2xl p-8 space-y-3">
        <div className="h-6 w-24 bg-surface-container-high rounded" />
        <div className="h-4 w-full bg-surface-container-high rounded" />
        <div className="h-4 w-3/4 bg-surface-container-high rounded" />
        <div className="h-4 w-5/6 bg-surface-container-high rounded" />
      </div>

      {/* Game log skeleton */}
      <div className="bg-surface-container-lowest rounded-2xl overflow-hidden">
        <div className="px-8 py-6 border-b border-surface-container-low">
          <div className="h-6 w-48 bg-surface-container-high rounded" />
        </div>
        <div className="space-y-0">
          {Array.from({ length: 5 }).map((_, i) => (
            <div
              key={i}
              className="h-14 border-b border-surface-container-low flex items-center px-8 gap-8"
            >
              <div className="h-4 w-16 bg-surface-container-high rounded" />
              <div className="h-4 w-32 bg-surface-container-high rounded" />
              <div className="h-4 w-20 bg-surface-container-high rounded" />
              <div className="h-4 w-12 bg-surface-container-high rounded" />
              <div className="h-4 w-12 bg-surface-container-high rounded" />
              <div className="h-4 w-12 bg-surface-container-high rounded" />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
