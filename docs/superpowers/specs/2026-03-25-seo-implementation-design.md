# CentrePass SEO Implementation Design

## Overview

Complete technical SEO implementation for centrepass.io — the dedicated Suncorp Super Netball scores, stats, and fixtures website. Covers metadata, structured data, dynamic OG images, sitemap, robots.txt, and analytics placeholders.

**Domain:** centrepass.io (live, configured on Render)
**Approach:** Page-by-page with shared infrastructure built first
**Branch:** New feature branch from main

## Context

### Current State

- Only `/player/[playerId]` has `generateMetadata()` — all other pages inherit a generic root layout title
- No sitemap, robots.txt, JSON-LD, OpenGraph, or Twitter card configuration
- No `metadataBase` set (blocks absolute URL generation)
- No OG images of any kind
- Favicon exists but no apple touch icons or manifest

### Competitive Landscape

No dedicated independent SSN scores website exists. Official sites (netball.com.au) have poor web SEO, media giants treat netball as afterthought. CentrePass fills every gap: web box scores, player profiles, live scores, on-court visualization, and structured data. Expected timeline: page 1 rankings for long-tail queries within 3-6 months.

## Design

### 1. Shared SEO Infrastructure

#### 1.1 Root Layout Metadata (`src/app/layout.tsx`)

Update the existing `metadata` export:

```typescript
export const metadata: Metadata = {
  metadataBase: new URL('https://centrepass.io'),
  title: {
    default: 'CentrePass - Suncorp Super Netball Scores',
    template: '%s | CentrePass',
  },
  description: 'Live scores, box scores, standings, fixtures, and player stats for Suncorp Super Netball.',
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

#### 1.2 SEO Helper Library (`src/lib/seo.ts`)

New file with shared constants and helper functions:

- `SITE_NAME = 'CentrePass'`
- `SITE_URL = 'https://centrepass.io'`
- `DEFAULT_DESCRIPTION` — site-wide fallback
- `jsonLd(data: Record<string, unknown>)` — returns a `<script type="application/ld+json">` element with proper `@context`. **Must use `dangerouslySetInnerHTML={{ __html: JSON.stringify(data) }}`** (not children) to ensure JSON is emitted as raw text and special characters in team/venue names don't break the markup.
- Type-safe builder functions for each schema type:
  - `sportsEventJsonLd(match)` — `SportsEvent` schema
  - `sportsTeamJsonLd(team)` — `SportsTeam` schema
  - `personJsonLd(player)` — `Person` schema
  - `breadcrumbJsonLd(items: {name: string, url: string}[])` — `BreadcrumbList` schema
  - `websiteJsonLd()` — `WebSite` schema (plain, no `SearchAction` — no search page exists)

#### 1.3 Dynamic Sitemap (`src/app/sitemap.ts`)

Queries Prisma for all indexable URLs:

| Page Type | Priority | Change Frequency | `lastModified` |
|-----------|----------|-----------------|-----------------|
| Homepage | 1.0 | daily | current date |
| Standings | 0.9 | daily | current date |
| Teams list | 0.8 | weekly | current date |
| Team pages | 0.7 | weekly | current date |
| Match pages | 0.8 | weekly | match `scheduledAt` date |
| Player pages | 0.6 | weekly | current date |

Excludes auth pages, settings, API routes, and noindexed sub-routes (`/match/*/live`, `/match/*/court`).

#### 1.4 Robots Configuration (`src/app/robots.ts`)

```typescript
rules: [
  { userAgent: '*', allow: '/', disallow: ['/api/', '/auth/', '/settings'] },
],
sitemap: 'https://centrepass.io/sitemap.xml',
```

### 2. Page-by-Page Metadata & Structured Data

#### 2.1 Homepage (`/`)

**Metadata:** Uses root layout defaults (no `generateMetadata` needed).

**JSON-LD:**
- `WebSite` with `name`, `url` (no `SearchAction` — no search page exists on the site)
- `BreadcrumbList`: Home

#### 2.2 Match Page (`/match/[matchId]`)

**Metadata:**
- Completed match title: `"Vixens 65 - Fever 58 | Round 5"`
- Upcoming match title: `"Vixens vs Fever | Round 5"`
- Description: Full score line + venue + date

**Data fetching:** Use `react.cache()` to wrap the Prisma query, deduplicating between `generateMetadata` and the page component (same pattern as the existing player page).

**JSON-LD:**
- `SportsEvent` with `homeTeam`, `awayTeam`, `startDate`, `location` (venue)
- `eventStatus` mapping from Prisma `MatchStatus` enum:
  - `SCHEDULED` → `https://schema.org/EventScheduled`
  - `LIVE` → `https://schema.org/EventScheduled` (Schema.org has no "live" status; keep as scheduled)
  - `COMPLETED` → `https://schema.org/EventScheduled` (Schema.org has no "completed" status; the event happened as scheduled)
- `BreadcrumbList`: Home > Scores > [Match]

#### 2.3 Match Live Page (`/match/[matchId]/live`)

**Metadata:**
- Title: `"LIVE: Vixens vs Fever | Round 5"`
- `robots: { index: false }` — live pages are ephemeral, don't index

#### 2.4 Match Court Page (`/match/[matchId]/court`)

**Metadata:**
- Title: `"Court View: Vixens vs Fever"`
- `robots: { index: false }` — visualization pages don't need indexing

#### 2.5 Team Page (`/team/[teamSlug]`)

**Metadata:**
- Title: `"Melbourne Vixens - Roster & Stats"`
- Description: team name + competition + season

**JSON-LD:**
- `SportsTeam` with `name`, `sport: "Netball"`, `memberOf: { "@type": "SportsOrganization", "name": "Suncorp Super Netball" }`
- `BreadcrumbList`: Home > Teams > [Team]

**Data fetching:** Use `react.cache()` to wrap the Prisma query, deduplicating between `generateMetadata` and the page component.

#### 2.6 Player Page (`/player/[playerId]`)

**Metadata:** Already has `generateMetadata()` — update to use title template and add OG fields. **Important:** The existing player page title is `"${player.name} | ${player.team.name} | CentrePass"` with a hardcoded `| CentrePass` suffix. This must change to `"${player.name} - ${player.team.name}"` so the root layout's `title.template` (`%s | CentrePass`) doesn't double-suffix it.

**JSON-LD:**
- `Person` with `name`, `birthDate`, `nationality`, `memberOf` (team), `jobTitle` (position)
- `BreadcrumbList`: Home > Teams > [Team] > [Player]. The team breadcrumb item URL must use `team.slug` (e.g., `/team/${player.team.slug}`) — not team name or ID.

#### 2.7 Standings Page (`/standings`)

**Metadata:**
- Title: `"${currentYear} SSN Standings"` — derive year from `new Date().getFullYear()` to avoid hardcoding
- Description: `"Current Suncorp Super Netball standings and ladder for the ${currentYear} season."`

**JSON-LD:**
- `BreadcrumbList`: Home > Standings

#### 2.8 Teams List Page (`/teams`)

**Metadata:**
- Title: `"All Teams - Suncorp Super Netball"`
- Description: "Browse all 8 Suncorp Super Netball teams — rosters, stats, and season performance."

**JSON-LD:**
- `BreadcrumbList`: Home > Teams

#### 2.9 Auth Pages (`/auth/signin`, `/auth/signup`)

**Metadata:**
- `robots: { index: false, follow: false }` — keep out of Google entirely
- Basic title: `"Sign In"` / `"Sign Up"`

#### 2.10 Settings Page (`/settings`)

**Metadata:**
- `robots: { index: false, follow: false }`
- Title: `"Settings"`

### 3. Dynamic OG Images

Using Next.js `ImageResponse` API (built on Satori). Each generates a 1200x630 PNG.

#### 3.1 Default Fallback (`src/app/opengraph-image.tsx`)

- Dark gradient background (kinetic-gradient style: `#0D1117` to `#1A1F2E`)
- CentrePass logo/wordmark centered
- Tagline: "Suncorp Super Netball Scores, Stats & Fixtures"
- Used for homepage, standings, teams list

#### 3.2 Match OG Image (`src/app/match/[matchId]/opengraph-image.tsx`)

- Dark gradient background
- Home team badge (left) — Away team badge (right)
- Score in large bold text between badges (if completed)
- "vs" text between badges (if upcoming) + match time
- Round number, venue name below
- CentrePass branding bottom-right

#### 3.3 Team OG Image (`src/app/team/[teamSlug]/opengraph-image.tsx`)

- Dark gradient background
- Team badge large and centered
- Team name below badge
- "Suncorp Super Netball" subtitle
- CentrePass branding bottom-right

#### 3.4 Player OG Image (`src/app/player/[playerId]/opengraph-image.tsx`)

- Dark gradient background
- Player photo (left side, from TheSportsDB URL)
- Player name (large) + position badge (right side)
- Team name + team badge small
- 2-3 key stat highlights
- CentrePass branding bottom-right

**Technical constraints for Satori:**
- Flexbox only (no CSS grid)
- Limited font support — load Lexend and Manrope as `ArrayBuffer`. **Font loading approach:** Use `fetch()` inside the OG image route handler to download `.ttf` files from Google Fonts CDN, or bundle `.ttf` files in `src/assets/fonts/`. Cannot use `next/font/google` (CSS-based, not compatible with Satori). Bundling `.ttf` files is more reliable (no runtime network dependency).
- External images (team logos, player photos) fetched via URL
- No `border-radius` on images in some versions — use overflow hidden on container
- All text must use explicit `style` props, not Tailwind classes

### 4. Analytics & Verification

#### 4.1 Google Search Console Verification

- Read `NEXT_PUBLIC_GSC_VERIFICATION` env var
- Render `<meta name="google-site-verification" content={value}>` in root layout when set
- No-op when env var is empty (dev environment)

#### 4.2 Google Analytics 4

New component: `src/components/GoogleAnalytics.tsx`

- Read `NEXT_PUBLIC_GA4_ID` env var
- Render GA4 gtag.js script tags using `next/script` with `strategy="afterInteractive"`
- No-op when env var is empty
- Add to root layout after `<body>` opening

#### 4.3 Post-Deployment Checklist (Documentation Only)

Include a markdown checklist in the PR description:

1. Register centrepass.io on Google Search Console
2. Choose domain verification (DNS TXT record)
3. Set `NEXT_PUBLIC_GSC_VERIFICATION` env var on Render
4. Submit `https://centrepass.io/sitemap.xml` in GSC
5. Create GA4 property at analytics.google.com
6. Set `NEXT_PUBLIC_GA4_ID` env var on Render
7. Register on Bing Webmaster Tools (import from GSC)
8. Sign up for Ahrefs Webmaster Tools free tier
9. Run Google Rich Results Test on key pages
10. Run PageSpeed Insights on key pages

### 5. Implementation Strategy

**Phase 1 — Shared Infrastructure (sequential):**
Build `src/lib/seo.ts`, update root layout, create `sitemap.ts`, create `robots.ts`, create `GoogleAnalytics.tsx`.

**Phase 2 — Page-by-Page (parallel via agent team):**
- Agent 1: Match pages (box score + live + court) — metadata, JSON-LD, OG image
- Agent 2: Team page + Teams list — metadata, JSON-LD, OG images
- Agent 3: Player page updates + Standings — metadata, JSON-LD, OG images
- Agent 4: Homepage JSON-LD + Auth pages noindex + Settings noindex + Analytics component in layout

**Phase 3 — Verification (sequential):**
- Test sitemap renders at `/sitemap.xml`
- Test robots renders at `/robots.txt`
- Validate JSON-LD with Google Rich Results Test
- Test OG images render correctly
- Run build to catch any TypeScript errors

## Files Changed

### New Files
- `src/lib/seo.ts` — SEO helper library
- `src/app/sitemap.ts` — dynamic sitemap
- `src/app/robots.ts` — robots configuration
- `src/components/GoogleAnalytics.tsx` — GA4 script component
- `src/app/opengraph-image.tsx` — default OG image
- `src/app/match/[matchId]/opengraph-image.tsx` — match OG image
- `src/app/team/[teamSlug]/opengraph-image.tsx` — team OG image
- `src/app/player/[playerId]/opengraph-image.tsx` — player OG image
- `src/assets/fonts/Lexend-Bold.ttf` — bundled font for Satori OG image rendering
- `src/assets/fonts/Manrope-Regular.ttf` — bundled font for Satori OG image rendering
- `src/app/auth/layout.tsx` — noindex metadata for auth pages (client components can't export metadata)
- `src/app/auth/signin/layout.tsx` — "Sign In" title for signin page
- `src/app/auth/signup/layout.tsx` — "Sign Up" title for signup page
- `src/app/settings/layout.tsx` — noindex metadata + "Settings" title

### Modified Files
- `src/app/layout.tsx` — metadataBase, title template, OG defaults, GSC meta tag, GA4 component
- `src/app/page.tsx` — homepage JSON-LD (WebSite + BreadcrumbList)
- `src/app/match/[matchId]/page.tsx` — generateMetadata + SportsEvent JSON-LD
- `src/app/match/[matchId]/live/page.tsx` — generateMetadata (noindex)
- `src/app/match/[matchId]/court/page.tsx` — generateMetadata (noindex)
- `src/app/team/[teamSlug]/page.tsx` — generateMetadata + SportsTeam JSON-LD
- `src/app/player/[playerId]/page.tsx` — update metadata to use template, add Person JSON-LD
- `src/app/standings/page.tsx` — generateMetadata + BreadcrumbList JSON-LD
- `src/app/teams/page.tsx` — generateMetadata + BreadcrumbList JSON-LD

## Out of Scope

- Google Ads or paid advertising (no revenue model)
- Link building campaigns
- PWA manifest / apple touch icons (separate enhancement)
- Content marketing / blog pages
- Google News registration
- Performance optimization (Core Web Vitals) — separate task
- Actual GSC/GA4 account registration (manual post-deployment step)
