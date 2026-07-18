import Link from 'next/link';

export default function EditionNotFound() {
  return (
    <div className="mx-auto flex min-h-[60vh] max-w-xl flex-col items-center justify-center text-center">
      <p className="font-label text-xs font-bold uppercase tracking-[0.18em] text-secondary">
        Competition not found
      </p>
      <h1 className="mt-3 font-headline text-3xl font-bold text-on-surface">
        That edition is not available
      </h1>
      <p className="mt-3 text-on-surface-variant">
        Check the competition and edition in the address, or return to the latest CentrePass coverage.
      </p>
      <Link
        href="/"
        className="mt-6 inline-flex min-h-11 items-center rounded-xl bg-primary px-5 font-headline text-sm font-bold text-on-primary"
      >
        Back to CentrePass
      </Link>
    </div>
  );
}
