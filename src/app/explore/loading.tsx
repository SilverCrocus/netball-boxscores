export default function ExploreLoading() {
  return (
    <div className="mx-auto max-w-7xl space-y-6" role="status" aria-label="Loading Ask CentrePass">
      <div className="h-72 animate-pulse rounded-[2rem] bg-primary-container" />
      <div className="h-40 animate-pulse rounded-3xl bg-surface-container-high" />
      <span className="sr-only">Loading Ask CentrePass…</span>
    </div>
  );
}
