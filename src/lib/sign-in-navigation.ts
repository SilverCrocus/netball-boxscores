const CALLBACK_ORIGIN = 'https://centrepass.invalid';

function internalPath(value: string | null | undefined, origin: string): string | null {
  if (!value || !value.startsWith('/') || value.startsWith('//') || value.includes('\\')) {
    return null;
  }

  try {
    const destination = new URL(value, origin);
    if (destination.origin !== origin) return null;
    return `${destination.pathname}${destination.search}${destination.hash}`;
  } catch {
    return null;
  }
}

/** Keep auth callbacks on this application and fall back home for malformed input. */
export function safeSignInCallbackUrl(value: string | null | undefined): string {
  return internalPath(value, CALLBACK_ORIGIN) ?? '/';
}

interface FullDocumentLocation {
  origin: string;
  assign(destination: string): void;
}

/**
 * A sign-in completion always replaces the current document. This prevents a
 * previously loaded analytics runtime from observing a history transition
 * from the auth flow into a private route.
 */
export function navigateAfterSignIn(
  value: string,
  location: FullDocumentLocation = window.location,
): void {
  let destination: URL;
  try {
    destination = new URL(value, location.origin);
  } catch {
    location.assign('/');
    return;
  }

  if (destination.origin !== location.origin) {
    location.assign('/');
    return;
  }

  location.assign(`${destination.pathname}${destination.search}${destination.hash}`);
}
