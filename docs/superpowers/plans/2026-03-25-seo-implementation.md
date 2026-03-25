# SEO Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement complete technical SEO for centrepass.io — metadata, structured data, dynamic OG images, sitemap, robots, and analytics placeholders.

**Architecture:** Shared SEO infrastructure (`src/lib/seo.ts`) provides JSON-LD builders and constants. Root layout sets `metadataBase`, `title.template`, and OG/Twitter defaults. Each page gets `generateMetadata()` (or static `metadata` for client components), JSON-LD structured data, and dynamic OG images. Sitemap and robots are Next.js convention files.

**Tech Stack:** Next.js 15 Metadata API, `next/og` ImageResponse (Satori), Prisma, TypeScript

**Spec:** `docs/superpowers/specs/2026-03-25-seo-implementation-design.md`

---

## File Structure

### New Files

| File | Responsibility |
|------|----------------|
| `src/lib/seo.ts` | SEO constants, `JsonLd` component, JSON-LD builder functions for all schema types |
| `src/app/sitemap.ts` | Dynamic sitemap querying Prisma for all indexable URLs |
| `src/app/robots.ts` | Robots configuration — allow all, block `/api/`, `/auth/`, `/settings` |
| `src/components/GoogleAnalytics.tsx` | GA4 gtag.js script, no-op when env var empty |
| `src/app/opengraph-image.tsx` | Default OG image (1200x630) — CentrePass branding |
| `src/app/match/[matchId]/opengraph-image.tsx` | Match OG image — team badges + score |
| `src/app/team/[teamSlug]/opengraph-image.tsx` | Team OG image — team badge + name |
| `src/app/player/[playerId]/opengraph-image.tsx` | Player OG image — photo + name + stats |
| `src/assets/fonts/Lexend-Bold.ttf` | Bundled font for Satori OG image rendering |
| `src/assets/fonts/Manrope-Regular.ttf` | Bundled font for Satori OG image rendering |

### Modified Files

| File | Changes |
|------|---------|
| `src/app/layout.tsx` | `metadataBase`, `title.template`, OG/Twitter defaults, GSC meta tag, GA4 component |
| `src/app/page.tsx` | Add `WebSite` + `BreadcrumbList` JSON-LD |
| `src/app/match/[matchId]/page.tsx` | Add `generateMetadata`, `cache()` wrapper, `SportsEvent` + `BreadcrumbList` JSON-LD |
| `src/app/match/[matchId]/live/page.tsx` | Add `generateMetadata` with `robots: noindex` |
| `src/app/match/[matchId]/court/page.tsx` | Add `generateMetadata` with `robots: noindex` |
| `src/app/team/[teamSlug]/page.tsx` | Add `generateMetadata`, `cache()` wrapper, `SportsTeam` + `BreadcrumbList` JSON-LD |
| `src/app/player/[playerId]/page.tsx` | Fix title (remove `| CentrePass` suffix), add `Person` + `BreadcrumbList` JSON-LD |
| `src/app/standings/page.tsx` | Add `generateMetadata`, `BreadcrumbList` JSON-LD |
| `src/app/teams/page.tsx` | Add `generateMetadata`, `BreadcrumbList` JSON-LD |
| `src/app/auth/signin/page.tsx` | Add static `metadata` export with `robots: noindex` |
| `src/app/auth/signup/page.tsx` | Add static `metadata` export with `robots: noindex` |
| `src/app/settings/page.tsx` | Add static `metadata` export with `robots: noindex` |

---

## Phase 1: Shared Infrastructure (Sequential)

These tasks must be completed in order before Phase 2 begins.

### Task 1: Create Branch

- [ ] **Step 1: Create and switch to feature branch**

```bash
git checkout -b feature/seo-implementation
```

- [ ] **Step 2: Verify branch**

Run: `git branch --show-current`
Expected: `feature/seo-implementation`

---

### Task 2: SEO Helper Library (`src/lib/seo.ts`)

**Files:**
- Create: `src/lib/seo.ts`

- [ ] **Step 1: Create `src/lib/seo.ts`**

```typescript
import React from 'react';

// Constants
export const SITE_NAME = 'CentrePass';
export const SITE_URL = 'https://centrepass.io';
export const DEFAULT_DESCRIPTION =
  'Live scores, box scores, standings, fixtures, and player stats for Suncorp Super Netball.';

// JSON-LD component — renders a <script type="application/ld+json"> tag
// Uses dangerouslySetInnerHTML to ensure JSON is emitted as raw text
// (special characters in team/venue names won't break the markup)
export function JsonLd({ data }: { data: Record<string, unknown> }) {
  return React.createElement('script', {
    type: 'application/ld+json',
    dangerouslySetInnerHTML: {
      __html: JSON.stringify({ '@context': 'https://schema.org', ...data }),
    },
  });
}

// --- JSON-LD Builder Functions ---

export function websiteJsonLd() {
  return {
    '@type': 'WebSite',
    name: SITE_NAME,
    url: SITE_URL,
  };
}

export function breadcrumbJsonLd(
  items: { name: string; url: string }[],
) {
  return {
    '@type': 'BreadcrumbList',
    itemListElement: items.map((item, index) => ({
      '@type': 'ListItem',
      position: index + 1,
      name: item.name,
      item: item.url.startsWith('http') ? item.url : `${SITE_URL}${item.url}`,
    })),
  };
}

export function sportsEventJsonLd(match: {
  homeTeamName: string;
  awayTeamName: string;
  venue: string;
  scheduledAt: Date | string;
  homeScore: number;
  awayScore: number;
  round: number;
}) {
  return {
    '@type': 'SportsEvent',
    name: `${match.homeTeamName} vs ${match.awayTeamName} - Round ${match.round}`,
    startDate: new Date(match.scheduledAt).toISOString(),
    location: {
      '@type': 'Place',
      name: match.venue,
    },
    homeTeam: {
      '@type': 'SportsTeam',
      name: match.homeTeamName,
    },
    awayTeam: {
      '@type': 'SportsTeam',
      name: match.awayTeamName,
    },
    eventStatus: 'https://schema.org/EventScheduled',
  };
}

export function sportsTeamJsonLd(team: {
  name: string;
  slug: string;
  logoUrl: string | null;
}) {
  return {
    '@type': 'SportsTeam',
    name: team.name,
    sport: 'Netball',
    url: `${SITE_URL}/team/${team.slug}`,
    ...(team.logoUrl ? { logo: team.logoUrl } : {}),
    memberOf: {
      '@type': 'SportsOrganization',
      name: 'Suncorp Super Netball',
    },
  };
}

export function personJsonLd(player: {
  name: string;
  position: string;
  dateOfBirth: Date | string | null;
  nationality: string | null;
  teamName: string;
  teamSlug: string;
}) {
  return {
    '@type': 'Person',
    name: player.name,
    jobTitle: player.position,
    ...(player.dateOfBirth
      ? { birthDate: new Date(player.dateOfBirth).toISOString().split('T')[0] }
      : {}),
    ...(player.nationality ? { nationality: player.nationality } : {}),
    memberOf: {
      '@type': 'SportsTeam',
      name: player.teamName,
      url: `${SITE_URL}/team/${player.teamSlug}`,
    },
  };
}
```

- [ ] **Step 2: Verify TypeScript compiles**

Run: `npx tsc --noEmit src/lib/seo.ts 2>&1 | head -20`
Expected: No errors (or only unrelated errors from other files)

- [ ] **Step 3: Commit**

```bash
git add src/lib/seo.ts
git commit -m "feat(seo): add SEO helper library with JSON-LD builders"
```

---

### Task 3: Update Root Layout (`src/app/layout.tsx`)

**Files:**
- Modify: `src/app/layout.tsx`
- Create: `src/components/GoogleAnalytics.tsx`

- [ ] **Step 1: Create `src/components/GoogleAnalytics.tsx`**

```typescript
import Script from 'next/script';

export function GoogleAnalytics() {
  const gaId = process.env.NEXT_PUBLIC_GA4_ID;
  if (!gaId) return null;

  return (
    <>
      <Script
        src={`https://www.googletagmanager.com/gtag/js?id=${gaId}`}
        strategy="afterInteractive"
      />
      <Script id="ga4-init" strategy="afterInteractive">
        {`
          window.dataLayer = window.dataLayer || [];
          function gtag(){dataLayer.push(arguments);}
          gtag('js', new Date());
          gtag('config', '${gaId}');
        `}
      </Script>
    </>
  );
}
```

- [ ] **Step 2: Update `src/app/layout.tsx` metadata export**

Replace the existing `metadata` export with:

```typescript
export const metadata: Metadata = {
  metadataBase: new URL('https://centrepass.io'),
  title: {
    default: 'CentrePass - Suncorp Super Netball Scores',
    template: '%s | CentrePass',
  },
  description:
    'Live scores, box scores, standings, fixtures, and player stats for Suncorp Super Netball.',
  openGraph: {
    siteName: 'CentrePass',
    type: 'website',
    locale: 'en_AU',
  },
  twitter: {
    card: 'summary_large_image',
  },
  robots: {
    index: true,
    follow: true,
  },
};
```

- [ ] **Step 3: Add GSC verification meta tag and GA4 component to layout**

Add import at top of `layout.tsx`:
```typescript
import { GoogleAnalytics } from '@/components/GoogleAnalytics';
```

Add GSC verification inside `<head>` (after the Material Symbols link):
```tsx
{process.env.NEXT_PUBLIC_GSC_VERIFICATION && (
  <meta
    name="google-site-verification"
    content={process.env.NEXT_PUBLIC_GSC_VERIFICATION}
  />
)}
```

Add `<GoogleAnalytics />` right after the opening `<body>` tag (before `<Providers>`).

- [ ] **Step 4: Verify the app still builds**

Run: `npx next build 2>&1 | tail -20`
Expected: Build succeeds

- [ ] **Step 5: Commit**

```bash
git add src/app/layout.tsx src/components/GoogleAnalytics.tsx
git commit -m "feat(seo): update root layout with metadataBase, title template, OG defaults, GA4"
```

---

### Task 4: Sitemap and Robots (`src/app/sitemap.ts`, `src/app/robots.ts`)

**Files:**
- Create: `src/app/sitemap.ts`
- Create: `src/app/robots.ts`

- [ ] **Step 1: Create `src/app/robots.ts`**

```typescript
import type { MetadataRoute } from 'next';

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: '*',
        allow: '/',
        disallow: ['/api/', '/auth/', '/settings'],
      },
    ],
    sitemap: 'https://centrepass.io/sitemap.xml',
  };
}
```

- [ ] **Step 2: Create `src/app/sitemap.ts`**

```typescript
import type { MetadataRoute } from 'next';
import { prisma } from '@/lib/db';

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const now = new Date();
  const baseUrl = 'https://centrepass.io';

  // Fetch all indexable entities
  const [teams, matches, players] = await Promise.all([
    prisma.team.findMany({ select: { slug: true } }),
    prisma.match.findMany({ select: { id: true, scheduledAt: true } }),
    prisma.player.findMany({ select: { id: true } }),
  ]);

  // Static pages
  const staticPages: MetadataRoute.Sitemap = [
    {
      url: baseUrl,
      lastModified: now,
      changeFrequency: 'daily',
      priority: 1.0,
    },
    {
      url: `${baseUrl}/standings`,
      lastModified: now,
      changeFrequency: 'daily',
      priority: 0.9,
    },
    {
      url: `${baseUrl}/teams`,
      lastModified: now,
      changeFrequency: 'weekly',
      priority: 0.8,
    },
  ];

  // Team pages
  const teamPages: MetadataRoute.Sitemap = teams.map((team) => ({
    url: `${baseUrl}/team/${team.slug}`,
    lastModified: now,
    changeFrequency: 'weekly' as const,
    priority: 0.7,
  }));

  // Match pages (box score only — /live and /court are noindexed)
  const matchPages: MetadataRoute.Sitemap = matches.map((match) => ({
    url: `${baseUrl}/match/${match.id}`,
    lastModified: match.scheduledAt,
    changeFrequency: 'weekly' as const,
    priority: 0.8,
  }));

  // Player pages
  const playerPages: MetadataRoute.Sitemap = players.map((player) => ({
    url: `${baseUrl}/player/${player.id}`,
    lastModified: now,
    changeFrequency: 'weekly' as const,
    priority: 0.6,
  }));

  return [...staticPages, ...teamPages, ...matchPages, ...playerPages];
}
```

- [ ] **Step 3: Verify build**

Run: `npx next build 2>&1 | tail -20`
Expected: Build succeeds, sitemap and robots included

- [ ] **Step 4: Commit**

```bash
git add src/app/sitemap.ts src/app/robots.ts
git commit -m "feat(seo): add dynamic sitemap and robots.txt"
```

---

### Task 5: Download and Bundle Fonts for OG Images

**Files:**
- Create: `src/assets/fonts/Lexend-Bold.ttf`
- Create: `src/assets/fonts/Manrope-Regular.ttf`

Satori (the engine behind `ImageResponse`) cannot use CSS fonts from `next/font/google`. It needs raw `.ttf` files loaded as `ArrayBuffer`.

- [ ] **Step 1: Create fonts directory and download fonts**

```bash
mkdir -p src/assets/fonts
curl -L "https://github.com/googlefonts/lexend/raw/main/fonts/ttf/Lexend-Bold.ttf" -o src/assets/fonts/Lexend-Bold.ttf
curl -L "https://github.com/nicholasgillespie/manrope/raw/main/fonts/ttf/Manrope-Regular.ttf" -o src/assets/fonts/Manrope-Regular.ttf
```

If the GitHub URLs don't work, download from Google Fonts API:

```bash
# Alternative: download via Google Fonts CSS API
curl -s "https://fonts.googleapis.com/css2?family=Lexend:wght@700&display=swap" | grep -oP 'https://[^)]+\.ttf' | head -1 | xargs curl -L -o src/assets/fonts/Lexend-Bold.ttf
curl -s "https://fonts.googleapis.com/css2?family=Manrope:wght@400&display=swap" | grep -oP 'https://[^)]+\.ttf' | head -1 | xargs curl -L -o src/assets/fonts/Manrope-Regular.ttf
```

- [ ] **Step 2: Verify fonts exist and are reasonable size**

Run: `ls -la src/assets/fonts/`
Expected: Two `.ttf` files, each 20-200 KB

- [ ] **Step 3: Commit fonts**

```bash
git add src/assets/fonts/
git commit -m "chore: bundle Lexend and Manrope TTF fonts for OG image generation"
```

---

### Task 6: Default OG Image (`src/app/opengraph-image.tsx`)

**Files:**
- Create: `src/app/opengraph-image.tsx`

- [ ] **Step 1: Create `src/app/opengraph-image.tsx`**

```tsx
import { ImageResponse } from 'next/og';
import { readFile } from 'fs/promises';
import { join } from 'path';

export const runtime = 'nodejs';
export const alt = 'CentrePass - Suncorp Super Netball Scores';
export const size = { width: 1200, height: 630 };
export const contentType = 'image/png';

export default async function OgImage() {
  const lexendBold = await readFile(
    join(process.cwd(), 'src/assets/fonts/Lexend-Bold.ttf'),
  );
  const manropeRegular = await readFile(
    join(process.cwd(), 'src/assets/fonts/Manrope-Regular.ttf'),
  );

  return new ImageResponse(
    (
      <div
        style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          background: 'linear-gradient(135deg, #0D1117 0%, #1A1F2E 50%, #0D1117 100%)',
          fontFamily: 'Manrope',
        }}
      >
        <div
          style={{
            display: 'flex',
            fontSize: 72,
            fontWeight: 700,
            color: '#FFFFFF',
            fontFamily: 'Lexend',
            marginBottom: 16,
          }}
        >
          CentrePass
        </div>
        <div
          style={{
            display: 'flex',
            fontSize: 28,
            color: '#94A3B8',
            textAlign: 'center',
          }}
        >
          Suncorp Super Netball Scores, Stats & Fixtures
        </div>
      </div>
    ),
    {
      ...size,
      fonts: [
        { name: 'Lexend', data: lexendBold, weight: 700, style: 'normal' },
        { name: 'Manrope', data: manropeRegular, weight: 400, style: 'normal' },
      ],
    },
  );
}
```

- [ ] **Step 2: Verify build**

Run: `npx next build 2>&1 | tail -20`
Expected: Build succeeds

- [ ] **Step 3: Commit**

```bash
git add src/app/opengraph-image.tsx
git commit -m "feat(seo): add default OG image with CentrePass branding"
```

---

## Phase 2: Page-by-Page SEO (Parallel via Agent Team)

These 4 task groups are independent and can be executed in parallel by separate agents. Each agent should pull latest from the branch before starting.

---

### Task Group A: Match Pages (Agent 1)

#### Task 7: Match Box Score Page Metadata + JSON-LD

**Files:**
- Modify: `src/app/match/[matchId]/page.tsx`

**Context:** This page currently has no `generateMetadata` and no `cache()`. The Prisma query is inline in the default export. We need to wrap it in `cache()` and add `generateMetadata`.

- [ ] **Step 1: Read the current file**

Read `src/app/match/[matchId]/page.tsx` to understand the current structure.

- [ ] **Step 2: Add imports and cache wrapper**

Add at the top of the file:

```typescript
import { cache } from 'react';
import type { Metadata } from 'next';
import { JsonLd, sportsEventJsonLd, breadcrumbJsonLd, SITE_URL } from '@/lib/seo';
```

Extract the existing Prisma query into a `cache()` wrapper:

```typescript
const getMatch = cache((matchId: string) =>
  prisma.match.findUnique({
    where: { id: matchId },
    include: {
      homeTeam: { select: { name: true, abbreviation: true, logoUrl: true, slug: true } },
      awayTeam: { select: { name: true, abbreviation: true, logoUrl: true, slug: true } },
      quarters: { orderBy: { quarter: 'asc' } },
      playerStats: { include: { player: true }, orderBy: { goals: 'desc' } },
      scoreFlow: { orderBy: [{ period: 'asc' }, { periodSeconds: 'asc' }] },
    },
  })
);
```

- [ ] **Step 3: Add `generateMetadata`**

```typescript
interface MatchPageProps {
  params: Promise<{ matchId: string }>;
}

export async function generateMetadata({ params }: MatchPageProps): Promise<Metadata> {
  const { matchId } = await params;
  const match = await getMatch(matchId);

  if (!match) return { title: 'Match Not Found' };

  const isCompleted = match.status === 'COMPLETED';
  const title = isCompleted
    ? `${match.homeTeam.name} ${match.homeScore} - ${match.awayTeam.name} ${match.awayScore} | Round ${match.round}`
    : `${match.homeTeam.name} vs ${match.awayTeam.name} | Round ${match.round}`;

  const description = isCompleted
    ? `${match.homeTeam.name} ${match.homeScore} - ${match.awayTeam.name} ${match.awayScore}. Round ${match.round} at ${match.venue}.`
    : `${match.homeTeam.name} vs ${match.awayTeam.name}. Round ${match.round} at ${match.venue}.`;

  return { title, description };
}
```

- [ ] **Step 4: Add JSON-LD to the page component**

Update the page's default export to use `getMatch` (replacing the inline query) and add JSON-LD after the existing JSX return:

Add inside the returned JSX (at the top, before the main content):

```tsx
<JsonLd data={sportsEventJsonLd({
  homeTeamName: match.homeTeam.name,
  awayTeamName: match.awayTeam.name,
  venue: match.venue,
  scheduledAt: match.scheduledAt,
  homeScore: match.homeScore,
  awayScore: match.awayScore,
  round: match.round,
})} />
<JsonLd data={breadcrumbJsonLd([
  { name: 'Home', url: '/' },
  { name: 'Scores', url: '/' },
  { name: `${match.homeTeam.abbreviation} vs ${match.awayTeam.abbreviation}`, url: `/match/${match.id}` },
])} />
```

- [ ] **Step 5: Verify build**

Run: `npx next build 2>&1 | tail -20`
Expected: Build succeeds

- [ ] **Step 6: Commit**

```bash
git add src/app/match/\[matchId\]/page.tsx
git commit -m "feat(seo): add metadata and SportsEvent JSON-LD to match page"
```

---

#### Task 8: Match Live + Court Page Metadata (noindex)

**Files:**
- Modify: `src/app/match/[matchId]/live/page.tsx`
- Modify: `src/app/match/[matchId]/court/page.tsx`

Both pages need `generateMetadata` that returns `robots: { index: false }` and a descriptive title. Both are server components that fetch match data — use the same `getMatch` pattern or a simpler query since we only need team names and round.

- [ ] **Step 1: Read both files**

Read `src/app/match/[matchId]/live/page.tsx` and `src/app/match/[matchId]/court/page.tsx`.

- [ ] **Step 2: Add `generateMetadata` to live page**

Add imports and metadata function to `live/page.tsx`:

```typescript
import type { Metadata } from 'next';
// Use the existing match fetch from the page (it already queries the match)

export async function generateMetadata({ params }: { params: Promise<{ matchId: string }> }): Promise<Metadata> {
  const { matchId } = await params;
  const match = await prisma.match.findUnique({
    where: { id: matchId },
    select: {
      round: true,
      homeTeam: { select: { name: true } },
      awayTeam: { select: { name: true } },
    },
  });

  if (!match) return { title: 'Match Not Found' };

  return {
    title: `LIVE: ${match.homeTeam.name} vs ${match.awayTeam.name} | Round ${match.round}`,
    robots: { index: false },
  };
}
```

- [ ] **Step 3: Add `generateMetadata` to court page**

Add imports and metadata function to `court/page.tsx`:

```typescript
import type { Metadata } from 'next';

export async function generateMetadata({ params }: { params: Promise<{ matchId: string }> }): Promise<Metadata> {
  const { matchId } = await params;
  const match = await prisma.match.findUnique({
    where: { id: matchId },
    select: {
      homeTeam: { select: { name: true } },
      awayTeam: { select: { name: true } },
    },
  });

  if (!match) return { title: 'Match Not Found' };

  return {
    title: `Court View: ${match.homeTeam.name} vs ${match.awayTeam.name}`,
    robots: { index: false },
  };
}
```

- [ ] **Step 4: Verify build**

Run: `npx next build 2>&1 | tail -20`
Expected: Build succeeds

- [ ] **Step 5: Commit**

```bash
git add src/app/match/\[matchId\]/live/page.tsx src/app/match/\[matchId\]/court/page.tsx
git commit -m "feat(seo): add noindex metadata to match live and court pages"
```

---

#### Task 9: Match OG Image

**Files:**
- Create: `src/app/match/[matchId]/opengraph-image.tsx`

- [ ] **Step 1: Create `src/app/match/[matchId]/opengraph-image.tsx`**

```tsx
import { ImageResponse } from 'next/og';
import { readFile } from 'fs/promises';
import { join } from 'path';
import { prisma } from '@/lib/db';

export const runtime = 'nodejs';
export const alt = 'Match Score';
export const size = { width: 1200, height: 630 };
export const contentType = 'image/png';

export default async function MatchOgImage({
  params,
}: {
  params: Promise<{ matchId: string }>;
}) {
  const { matchId } = await params;
  const match = await prisma.match.findUnique({
    where: { id: matchId },
    select: {
      round: true,
      venue: true,
      status: true,
      homeScore: true,
      awayScore: true,
      homeTeam: { select: { name: true, abbreviation: true, logoUrl: true } },
      awayTeam: { select: { name: true, abbreviation: true, logoUrl: true } },
    },
  });

  const lexendBold = await readFile(
    join(process.cwd(), 'src/assets/fonts/Lexend-Bold.ttf'),
  );
  const manropeRegular = await readFile(
    join(process.cwd(), 'src/assets/fonts/Manrope-Regular.ttf'),
  );

  const isCompleted = match?.status === 'COMPLETED';
  const homeName = match?.homeTeam.abbreviation ?? 'HOME';
  const awayName = match?.awayTeam.abbreviation ?? 'AWAY';

  return new ImageResponse(
    (
      <div
        style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          background: 'linear-gradient(135deg, #0D1117 0%, #1A1F2E 50%, #0D1117 100%)',
          fontFamily: 'Manrope',
          gap: 24,
        }}
      >
        {/* Round label */}
        <div style={{ display: 'flex', fontSize: 24, color: '#94A3B8' }}>
          Round {match?.round ?? '?'}
        </div>

        {/* Score row */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 48 }}>
          {/* Home team */}
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 12 }}>
            {match?.homeTeam.logoUrl ? (
              <img
                src={match.homeTeam.logoUrl}
                width={80}
                height={80}
                style={{ objectFit: 'contain' }}
              />
            ) : (
              <div style={{ display: 'flex', width: 80, height: 80, background: '#374151', borderRadius: 40, alignItems: 'center', justifyContent: 'center', fontSize: 32, color: '#fff', fontFamily: 'Lexend' }}>
                {homeName[0]}
              </div>
            )}
            <div style={{ display: 'flex', fontSize: 24, color: '#E2E8F0', fontFamily: 'Lexend' }}>
              {homeName}
            </div>
          </div>

          {/* Score or VS */}
          <div style={{ display: 'flex', fontSize: 64, color: '#FFFFFF', fontFamily: 'Lexend', fontWeight: 700 }}>
            {isCompleted ? `${match?.homeScore} - ${match?.awayScore}` : 'vs'}
          </div>

          {/* Away team */}
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 12 }}>
            {match?.awayTeam.logoUrl ? (
              <img
                src={match.awayTeam.logoUrl}
                width={80}
                height={80}
                style={{ objectFit: 'contain' }}
              />
            ) : (
              <div style={{ display: 'flex', width: 80, height: 80, background: '#374151', borderRadius: 40, alignItems: 'center', justifyContent: 'center', fontSize: 32, color: '#fff', fontFamily: 'Lexend' }}>
                {awayName[0]}
              </div>
            )}
            <div style={{ display: 'flex', fontSize: 24, color: '#E2E8F0', fontFamily: 'Lexend' }}>
              {awayName}
            </div>
          </div>
        </div>

        {/* Venue */}
        <div style={{ display: 'flex', fontSize: 20, color: '#64748B' }}>
          {match?.venue ?? ''}
        </div>

        {/* Branding */}
        <div style={{ display: 'flex', position: 'absolute', bottom: 24, right: 32, fontSize: 18, color: '#475569', fontFamily: 'Lexend' }}>
          CentrePass
        </div>
      </div>
    ),
    {
      ...size,
      fonts: [
        { name: 'Lexend', data: lexendBold, weight: 700, style: 'normal' },
        { name: 'Manrope', data: manropeRegular, weight: 400, style: 'normal' },
      ],
    },
  );
}
```

- [ ] **Step 2: Verify build**

Run: `npx next build 2>&1 | tail -20`
Expected: Build succeeds

- [ ] **Step 3: Commit**

```bash
git add src/app/match/\[matchId\]/opengraph-image.tsx
git commit -m "feat(seo): add dynamic OG image for match pages"
```

---

### Task Group B: Team Pages (Agent 2)

#### Task 10: Team Profile Page Metadata + JSON-LD

**Files:**
- Modify: `src/app/team/[teamSlug]/page.tsx`

**Context:** This page currently has no `generateMetadata` and no `cache()`. It fetches team data with a rich Prisma query including players, standings, and recent matches.

- [ ] **Step 1: Read the current file**

Read `src/app/team/[teamSlug]/page.tsx`.

- [ ] **Step 2: Add imports and `cache()` wrapper**

Add imports:
```typescript
import { cache } from 'react';
import type { Metadata } from 'next';
import { JsonLd, sportsTeamJsonLd, breadcrumbJsonLd } from '@/lib/seo';
```

Extract the existing Prisma query into a `cache()` wrapper (keep the same query shape):
```typescript
const getTeam = cache((teamSlug: string) =>
  prisma.team.findUnique({
    where: { slug: teamSlug },
    include: { /* existing includes */ },
  })
);
```

- [ ] **Step 3: Add `generateMetadata`**

```typescript
interface TeamPageProps {
  params: Promise<{ teamSlug: string }>;
}

export async function generateMetadata({ params }: TeamPageProps): Promise<Metadata> {
  const { teamSlug } = await params;
  const team = await getTeam(teamSlug);

  if (!team) return { title: 'Team Not Found' };

  return {
    title: `${team.name} - Roster & Stats`,
    description: `${team.name} roster, season stats, and recent results in the ${new Date().getFullYear()} Suncorp Super Netball season.`,
  };
}
```

- [ ] **Step 4: Add JSON-LD to page component**

Update the default export to use `getTeam` and add JSON-LD inside the returned JSX:

```tsx
<JsonLd data={sportsTeamJsonLd({
  name: team.name,
  slug: team.slug,
  logoUrl: team.logoUrl,
})} />
<JsonLd data={breadcrumbJsonLd([
  { name: 'Home', url: '/' },
  { name: 'Teams', url: '/teams' },
  { name: team.name, url: `/team/${team.slug}` },
])} />
```

- [ ] **Step 5: Verify build**

Run: `npx next build 2>&1 | tail -20`
Expected: Build succeeds

- [ ] **Step 6: Commit**

```bash
git add src/app/team/\[teamSlug\]/page.tsx
git commit -m "feat(seo): add metadata and SportsTeam JSON-LD to team page"
```

---

#### Task 11: Teams List Page Metadata

**Files:**
- Modify: `src/app/teams/page.tsx`

- [ ] **Step 1: Read the current file**

Read `src/app/teams/page.tsx`.

- [ ] **Step 2: Add metadata and JSON-LD**

Add imports:
```typescript
import type { Metadata } from 'next';
import { JsonLd, breadcrumbJsonLd } from '@/lib/seo';
```

Add static metadata export:
```typescript
export const metadata: Metadata = {
  title: 'All Teams - Suncorp Super Netball',
  description:
    'Browse all 8 Suncorp Super Netball teams — rosters, stats, and season performance.',
};
```

Add `BreadcrumbList` JSON-LD inside the returned JSX:
```tsx
<JsonLd data={breadcrumbJsonLd([
  { name: 'Home', url: '/' },
  { name: 'Teams', url: '/teams' },
])} />
```

- [ ] **Step 3: Verify build**

Run: `npx next build 2>&1 | tail -20`
Expected: Build succeeds

- [ ] **Step 4: Commit**

```bash
git add src/app/teams/page.tsx
git commit -m "feat(seo): add metadata and breadcrumb JSON-LD to teams list page"
```

---

#### Task 12: Team OG Image

**Files:**
- Create: `src/app/team/[teamSlug]/opengraph-image.tsx`

- [ ] **Step 1: Create `src/app/team/[teamSlug]/opengraph-image.tsx`**

```tsx
import { ImageResponse } from 'next/og';
import { readFile } from 'fs/promises';
import { join } from 'path';
import { prisma } from '@/lib/db';

export const runtime = 'nodejs';
export const alt = 'Team Profile';
export const size = { width: 1200, height: 630 };
export const contentType = 'image/png';

export default async function TeamOgImage({
  params,
}: {
  params: Promise<{ teamSlug: string }>;
}) {
  const { teamSlug } = await params;
  const team = await prisma.team.findUnique({
    where: { slug: teamSlug },
    select: { name: true, abbreviation: true, logoUrl: true },
  });

  const lexendBold = await readFile(
    join(process.cwd(), 'src/assets/fonts/Lexend-Bold.ttf'),
  );
  const manropeRegular = await readFile(
    join(process.cwd(), 'src/assets/fonts/Manrope-Regular.ttf'),
  );

  return new ImageResponse(
    (
      <div
        style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          background: 'linear-gradient(135deg, #0D1117 0%, #1A1F2E 50%, #0D1117 100%)',
          fontFamily: 'Manrope',
          gap: 24,
        }}
      >
        {team?.logoUrl ? (
          <img
            src={team.logoUrl}
            width={120}
            height={120}
            style={{ objectFit: 'contain' }}
          />
        ) : (
          <div style={{ display: 'flex', width: 120, height: 120, background: '#374151', borderRadius: 60, alignItems: 'center', justifyContent: 'center', fontSize: 48, color: '#fff', fontFamily: 'Lexend' }}>
            {team?.abbreviation?.[0] ?? '?'}
          </div>
        )}
        <div style={{ display: 'flex', fontSize: 48, fontWeight: 700, color: '#FFFFFF', fontFamily: 'Lexend' }}>
          {team?.name ?? 'Team'}
        </div>
        <div style={{ display: 'flex', fontSize: 24, color: '#94A3B8' }}>
          Suncorp Super Netball
        </div>
        <div style={{ display: 'flex', position: 'absolute', bottom: 24, right: 32, fontSize: 18, color: '#475569', fontFamily: 'Lexend' }}>
          CentrePass
        </div>
      </div>
    ),
    {
      ...size,
      fonts: [
        { name: 'Lexend', data: lexendBold, weight: 700, style: 'normal' },
        { name: 'Manrope', data: manropeRegular, weight: 400, style: 'normal' },
      ],
    },
  );
}
```

- [ ] **Step 2: Verify build**

Run: `npx next build 2>&1 | tail -20`
Expected: Build succeeds

- [ ] **Step 3: Commit**

```bash
git add src/app/team/\[teamSlug\]/opengraph-image.tsx
git commit -m "feat(seo): add dynamic OG image for team pages"
```

---

### Task Group C: Player + Standings (Agent 3)

#### Task 13: Player Page SEO Update

**Files:**
- Modify: `src/app/player/[playerId]/page.tsx`

**Context:** This page already has `generateMetadata` and `cache()`. We need to: (1) fix the title to not double-suffix `| CentrePass`, (2) add `Person` JSON-LD, (3) add `BreadcrumbList` JSON-LD.

- [ ] **Step 1: Read the current file**

Read `src/app/player/[playerId]/page.tsx`.

- [ ] **Step 2: Fix the title in `generateMetadata`**

Change line 44 from:
```typescript
title: `${player.name} | ${player.team.name} | CentrePass`,
```
To:
```typescript
title: `${player.name} - ${player.team.name}`,
```

The root layout's `title.template: '%s | CentrePass'` will automatically append `| CentrePass`.

Also fix the not-found title (line 41):
```typescript
if (!player) return { title: 'Player Not Found' };
```
(Remove `| CentrePass` — template handles it.)

- [ ] **Step 3: Add JSON-LD imports and components**

Add imports:
```typescript
import { JsonLd, personJsonLd, breadcrumbJsonLd } from '@/lib/seo';
```

Add inside the returned JSX (at the top of the `<div>`, before `<PlayerHero>`):

```tsx
<JsonLd data={personJsonLd({
  name: player.name,
  position: player.position,
  dateOfBirth: player.dateOfBirth,
  nationality: player.nationality,
  teamName: player.team.name,
  teamSlug: player.team.slug,
})} />
<JsonLd data={breadcrumbJsonLd([
  { name: 'Home', url: '/' },
  { name: 'Teams', url: '/teams' },
  { name: player.team.name, url: `/team/${player.team.slug}` },
  { name: player.name, url: `/player/${player.id}` },
])} />
```

**Note:** The `getPlayer` query already includes `team: true`, which gives us `team.slug` and `team.name`.

- [ ] **Step 4: Verify build**

Run: `npx next build 2>&1 | tail -20`
Expected: Build succeeds

- [ ] **Step 5: Commit**

```bash
git add src/app/player/\[playerId\]/page.tsx
git commit -m "feat(seo): fix player title template, add Person and breadcrumb JSON-LD"
```

---

#### Task 14: Player OG Image

**Files:**
- Create: `src/app/player/[playerId]/opengraph-image.tsx`

- [ ] **Step 1: Create `src/app/player/[playerId]/opengraph-image.tsx`**

```tsx
import { ImageResponse } from 'next/og';
import { readFile } from 'fs/promises';
import { join } from 'path';
import { prisma } from '@/lib/db';

export const runtime = 'nodejs';
export const alt = 'Player Profile';
export const size = { width: 1200, height: 630 };
export const contentType = 'image/png';

export default async function PlayerOgImage({
  params,
}: {
  params: Promise<{ playerId: string }>;
}) {
  const { playerId } = await params;
  const player = await prisma.player.findUnique({
    where: { id: playerId },
    select: {
      name: true,
      position: true,
      photoUrl: true,
      team: { select: { name: true, abbreviation: true, logoUrl: true } },
    },
  });

  const lexendBold = await readFile(
    join(process.cwd(), 'src/assets/fonts/Lexend-Bold.ttf'),
  );
  const manropeRegular = await readFile(
    join(process.cwd(), 'src/assets/fonts/Manrope-Regular.ttf'),
  );

  return new ImageResponse(
    (
      <div
        style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          alignItems: 'center',
          background: 'linear-gradient(135deg, #0D1117 0%, #1A1F2E 50%, #0D1117 100%)',
          fontFamily: 'Manrope',
          padding: 48,
          gap: 48,
        }}
      >
        {/* Player photo */}
        <div style={{ display: 'flex', flexShrink: 0 }}>
          {player?.photoUrl ? (
            <img
              src={player.photoUrl}
              width={200}
              height={200}
              style={{ objectFit: 'cover', borderRadius: 100 }}
            />
          ) : (
            <div style={{ display: 'flex', width: 200, height: 200, background: '#374151', borderRadius: 100, alignItems: 'center', justifyContent: 'center', fontSize: 64, color: '#fff', fontFamily: 'Lexend' }}>
              {player?.name?.[0] ?? '?'}
            </div>
          )}
        </div>

        {/* Player info */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <div style={{ display: 'flex', fontSize: 56, fontWeight: 700, color: '#FFFFFF', fontFamily: 'Lexend', lineHeight: 1.1 }}>
            {player?.name ?? 'Player'}
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
            <div style={{ display: 'flex', padding: '6px 16px', background: '#1E293B', borderRadius: 8, fontSize: 22, color: '#94A3B8', fontFamily: 'Lexend' }}>
              {player?.position ?? ''}
            </div>
            <div style={{ display: 'flex', fontSize: 24, color: '#94A3B8' }}>
              {player?.team.name ?? ''}
            </div>
          </div>
        </div>

        {/* Branding */}
        <div style={{ display: 'flex', position: 'absolute', bottom: 24, right: 32, fontSize: 18, color: '#475569', fontFamily: 'Lexend' }}>
          CentrePass
        </div>
      </div>
    ),
    {
      ...size,
      fonts: [
        { name: 'Lexend', data: lexendBold, weight: 700, style: 'normal' },
        { name: 'Manrope', data: manropeRegular, weight: 400, style: 'normal' },
      ],
    },
  );
}
```

- [ ] **Step 2: Verify build**

Run: `npx next build 2>&1 | tail -20`
Expected: Build succeeds

- [ ] **Step 3: Commit**

```bash
git add src/app/player/\[playerId\]/opengraph-image.tsx
git commit -m "feat(seo): add dynamic OG image for player pages"
```

---

#### Task 15: Standings Page Metadata

**Files:**
- Modify: `src/app/standings/page.tsx`

- [ ] **Step 1: Read the current file**

Read `src/app/standings/page.tsx`.

- [ ] **Step 2: Add metadata and JSON-LD**

Add imports:
```typescript
import type { Metadata } from 'next';
import { JsonLd, breadcrumbJsonLd } from '@/lib/seo';
```

Add `generateMetadata` (dynamic to use current year):
```typescript
export async function generateMetadata(): Promise<Metadata> {
  const year = new Date().getFullYear();
  return {
    title: `${year} SSN Standings`,
    description: `Current Suncorp Super Netball standings and ladder for the ${year} season.`,
  };
}
```

Add `BreadcrumbList` JSON-LD inside the returned JSX:
```tsx
<JsonLd data={breadcrumbJsonLd([
  { name: 'Home', url: '/' },
  { name: 'Standings', url: '/standings' },
])} />
```

**Note:** If the page currently exports a static `dynamic` or `metadata` config, keep the `dynamic` export but remove any existing `metadata` export (replace with `generateMetadata`).

- [ ] **Step 3: Verify build**

Run: `npx next build 2>&1 | tail -20`
Expected: Build succeeds

- [ ] **Step 4: Commit**

```bash
git add src/app/standings/page.tsx
git commit -m "feat(seo): add metadata and breadcrumb JSON-LD to standings page"
```

---

### Task Group D: Homepage + Utility Pages (Agent 4)

#### Task 16: Homepage JSON-LD

**Files:**
- Modify: `src/app/page.tsx`

- [ ] **Step 1: Read the current file**

Read `src/app/page.tsx`.

- [ ] **Step 2: Add JSON-LD imports and components**

Add imports:
```typescript
import { JsonLd, websiteJsonLd, breadcrumbJsonLd } from '@/lib/seo';
```

Add inside the returned JSX (at the top, before existing content):
```tsx
<JsonLd data={websiteJsonLd()} />
<JsonLd data={breadcrumbJsonLd([
  { name: 'Home', url: '/' },
])} />
```

No `generateMetadata` needed — the root layout defaults are correct for the homepage.

- [ ] **Step 3: Verify build**

Run: `npx next build 2>&1 | tail -20`
Expected: Build succeeds

- [ ] **Step 4: Commit**

```bash
git add src/app/page.tsx
git commit -m "feat(seo): add WebSite and breadcrumb JSON-LD to homepage"
```

---

#### Task 17: Auth Pages + Settings noindex

**Files:**
- Modify: `src/app/auth/signin/page.tsx`
- Modify: `src/app/auth/signup/page.tsx`
- Modify: `src/app/settings/page.tsx`

**Context:** All three are client components (`'use client'`). Client components cannot use `generateMetadata` — they must use a static `metadata` export. However, Next.js metadata exports must be in server components. The correct approach for client component pages is to add the metadata in a separate `layout.tsx` file in the same route, or move the `metadata` to a parent layout. The simplest approach: create a tiny `layout.tsx` wrapper in each directory, or add a static metadata export (which Next.js allows at the route segment level regardless of client/server status — the metadata export is evaluated server-side even if the page is a client component).

**Actually:** In Next.js App Router, `metadata` and `generateMetadata` exports are ONLY valid in `layout.tsx` and `page.tsx` **Server Components**. For client component pages, the typical pattern is to either:
1. Create a `layout.tsx` in that route with the metadata, or
2. Refactor the page to be a server component that renders a client component

The simplest approach: add a `metadata` export to each file. Even though the component itself is a client component, Next.js extracts the metadata export at build time separately. **This actually works** — tested pattern in Next.js 15.

- [ ] **Step 1: Read all three files**

Read `src/app/auth/signin/page.tsx`, `src/app/auth/signup/page.tsx`, and `src/app/settings/page.tsx`.

- [ ] **Step 2: Add noindex metadata to signin page**

Add import at top (after `'use client'`):
```typescript
import type { Metadata } from 'next';
```

**Wait — client components can't export Metadata.** Instead, create wrapper layouts. Add a `src/app/auth/layout.tsx` for shared noindex:

```typescript
import type { Metadata } from 'next';

export const metadata: Metadata = {
  robots: { index: false, follow: false },
};

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return children;
}
```

Add `src/app/auth/signin/layout.tsx` for the signin title:

```typescript
import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Sign In',
};

export default function SignInLayout({ children }: { children: React.ReactNode }) {
  return children;
}
```

Add `src/app/auth/signup/layout.tsx` for the signup title:

```typescript
import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Sign Up',
};

export default function SignUpLayout({ children }: { children: React.ReactNode }) {
  return children;
}
```

The parent `auth/layout.tsx` applies `noindex` to both, and the child layouts add per-page titles.

- [ ] **Step 3: Add noindex metadata to settings page**

Create `src/app/settings/layout.tsx`:

```typescript
import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Settings',
  robots: { index: false, follow: false },
};

export default function SettingsLayout({ children }: { children: React.ReactNode }) {
  return children;
}
```

**Note:** If `src/app/settings/layout.tsx` already exists (the settings page is already behind auth middleware), read it first and add the metadata to the existing layout.

- [ ] **Step 4: Verify build**

Run: `npx next build 2>&1 | tail -20`
Expected: Build succeeds

- [ ] **Step 5: Commit**

```bash
git add src/app/auth/layout.tsx src/app/auth/signin/layout.tsx src/app/auth/signup/layout.tsx src/app/settings/layout.tsx
git commit -m "feat(seo): add noindex metadata to auth and settings pages"
```

---

## Phase 3: Verification (Sequential)

### Task 18: Build Verification and Final Commit

- [ ] **Step 1: Run full build**

```bash
npx next build 2>&1
```

Expected: Build succeeds with no TypeScript errors. The build output should show all routes compiled.

- [ ] **Step 2: Start dev server and verify key routes**

```bash
npx next dev &
sleep 5
```

Test these URLs manually or with curl:
- `http://localhost:3000/sitemap.xml` — should return XML with all URLs
- `http://localhost:3000/robots.txt` — should show allow/disallow rules

```bash
curl -s http://localhost:3000/robots.txt
curl -s http://localhost:3000/sitemap.xml | head -50
```

- [ ] **Step 3: Stop dev server**

```bash
kill %1 2>/dev/null || true
```

- [ ] **Step 4: Verify all changes are committed**

```bash
git status
git log --oneline -15
```

Expected: Clean working directory, all SEO commits visible.

- [ ] **Step 5: Push branch**

```bash
git push -u origin feature/seo-implementation
```

---

## Agent Team Assignment Summary

| Agent | Tasks | Files Touched |
|-------|-------|---------------|
| Leader | Tasks 1-6 (Phase 1), Task 18 (Phase 3) | Shared infra, fonts, default OG image |
| Agent 1 | Tasks 7, 8, 9 | `match/[matchId]/page.tsx`, `live/page.tsx`, `court/page.tsx`, `match OG image` |
| Agent 2 | Tasks 10, 11, 12 | `team/[teamSlug]/page.tsx`, `teams/page.tsx`, `team OG image` |
| Agent 3 | Tasks 13, 14, 15 | `player/[playerId]/page.tsx`, `player OG image`, `standings/page.tsx` |
| Agent 4 | Tasks 16, 17 | `page.tsx` (homepage), `auth/layout.tsx`, `settings/layout.tsx` |

No file conflicts between agents — each agent touches a different set of files.
