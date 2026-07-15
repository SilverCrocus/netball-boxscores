export default function EditionLoading() {
  return (
    <div className="mx-auto max-w-7xl animate-pulse" aria-label="Loading competition edition">
      <div className="mb-6 h-32 rounded-2xl bg-surface-container" />
      <div className="grid gap-4 md:grid-cols-2">
        <div className="h-48 rounded-2xl bg-surface-container" />
        <div className="h-48 rounded-2xl bg-surface-container" />
      </div>
    </div>
  );
}
