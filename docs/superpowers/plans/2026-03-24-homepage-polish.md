# Homepage Polish Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace letter placeholders with real team logos, add game dates to all match cards, and sort results most-recent-first on the home page.

**Architecture:** Create a shared `TeamBadge` component for the logo-with-fallback pattern (used in 5 places). Update `ScoreCard.tsx` and `page.tsx` to use it and display dates. Reverse completed match ordering.

**Tech Stack:** Next.js 15 (App Router), `next/image`, TypeScript, Tailwind CSS 4

**Spec:** `docs/superpowers/specs/2026-03-24-homepage-polish-design.md`

---

## File Structure

| File | Action | Responsibility |
|------|--------|---------------|
| `src/components/ui/TeamBadge.tsx` | Create | Shared team logo component with letter fallback |
| `src/components/ui/ScoreCard.tsx` | Modify | Use TeamBadge, add date to footer |
| `src/app/page.tsx` | Modify | Use TeamBadge in hero + side fixtures, add dates, reverse completed sort |

---

### Task 1: Create TeamBadge component

**Files:**
- Create: `src/components/ui/TeamBadge.tsx`

**Dependencies:** None — this task must complete before Tasks 2 and 3.

- [ ] **Step 1: Create TeamBadge component**

This component renders a team's logo badge with a letter fallback. It accepts a `team` object (with `name`, `abbreviation`, `logoUrl`), a `size` (pixel dimension), and a `variant` (`'home' | 'away'`) to control fallback background color.

```tsx
// src/components/ui/TeamBadge.tsx
import Image from 'next/image';

interface TeamBadgeProps {
  team: {
    name: string;
    abbreviation: string;
    logoUrl?: string | null;
  };
  size: number;
  variant?: 'home' | 'away';
  className?: string;
}

export function TeamBadge({ team, size, variant = 'home', className = '' }: TeamBadgeProps) {
  const fallbackBg = variant === 'home' ? 'bg-primary-container' : 'bg-surface-container-high';
  const fallbackText = variant === 'home' ? 'text-white' : 'text-primary';

  if (team.logoUrl) {
    return (
      <Image
        src={team.logoUrl}
        alt={`${team.name} badge`}
        width={size}
        height={size}
        className={`object-contain ${className}`}
      />
    );
  }

  // Letter fallback
  const textSize = size >= 64 ? 'text-3xl' : size >= 40 ? 'text-lg' : 'text-sm';
  return (
    <div
      className={`flex items-center justify-center rounded-lg font-black italic font-headline ${fallbackBg} ${fallbackText} ${textSize} ${className}`}
      style={{ width: size, height: size }}
    >
      {team.abbreviation.charAt(0)}
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add src/components/ui/TeamBadge.tsx
git commit -m "feat: add TeamBadge component with logo and letter fallback"
```

---

### Task 2: Update ScoreCard with logos and dates

**Files:**
- Modify: `src/components/ui/ScoreCard.tsx`

**Dependencies:** Task 1 (TeamBadge component must exist)

**Can run in parallel with:** Task 3

- [ ] **Step 1: Replace letter placeholders with TeamBadge**

In `ScoreCard.tsx`, replace the two letter-placeholder `<div>` elements (home team at lines 62-64, away team at lines 77-79) with `<TeamBadge>`.

Replace lines 62-64 (home team placeholder):
```tsx
// BEFORE:
<div className="w-12 h-12 bg-primary-container rounded-lg flex items-center justify-center text-white font-black italic text-lg font-headline mb-2">
  {match.homeTeam.abbreviation.charAt(0)}
</div>

// AFTER:
<TeamBadge team={match.homeTeam} size={48} variant="home" className="mb-2" />
```

Replace lines 77-79 (away team placeholder):
```tsx
// BEFORE:
<div className="w-12 h-12 bg-surface-container-high rounded-lg flex items-center justify-center text-primary font-black italic text-lg font-headline mb-2">
  {match.awayTeam.abbreviation.charAt(0)}
</div>

// AFTER:
<TeamBadge team={match.awayTeam} size={48} variant="away" className="mb-2" />
```

Add the import at the top:
```tsx
import { TeamBadge } from './TeamBadge';
```

- [ ] **Step 2: Add date to ScoreCard footer**

In the footer section (lines 87-97), prepend the formatted date before "Round X · Venue".

Replace the footer `<span>` content (line 89-91):
```tsx
// BEFORE:
<span className="text-[10px] font-medium text-on-surface-variant uppercase font-label">
  {match.round && `Round ${match.round}`} {match.venue && `\u2022 ${match.venue}`}
</span>

// AFTER:
<span className="text-[10px] font-medium text-on-surface-variant uppercase font-label">
  {match.scheduledAt && new Date(match.scheduledAt).toLocaleDateString('en-AU', { weekday: 'short', day: 'numeric', month: 'short' })}
  {match.round && ` \u2022 Round ${match.round}`}
  {match.venue && ` \u2022 ${match.venue}`}
</span>
```

- [ ] **Step 3: Verify build compiles**

Run: `npx next build 2>&1 | head -30`
Expected: Build completes without errors.

- [ ] **Step 4: Commit**

```bash
git add src/components/ui/ScoreCard.tsx
git commit -m "feat: use team logos and add dates in ScoreCard"
```

---

### Task 3: Update home page with logos, dates, and sort order

**Files:**
- Modify: `src/app/page.tsx`

**Dependencies:** Task 1 (TeamBadge component must exist)

**Can run in parallel with:** Task 2

- [ ] **Step 1: Add `round` to the matches type annotation**

The type annotation on lines 8-18 of `page.tsx` is missing the `round` field. Add it so TypeScript doesn't complain when `match.round` is accessed:

```tsx
// Add after the `venue: string;` line:
round: number;
```

- [ ] **Step 2: Reverse completed matches sort order**

After line 34, the `completedMatches` array is in ascending order (oldest first). Reverse it:

```tsx
// BEFORE:
const completedMatches = matches.filter((m) => m.status === 'COMPLETED');

// AFTER:
const completedMatches = matches.filter((m) => m.status === 'COMPLETED').reverse();
```

- [ ] **Step 3: Replace featured match hero letter placeholders with TeamBadge**

Add the import at the top of `page.tsx`:
```tsx
import { TeamBadge } from '@/components/ui/TeamBadge';
```

Replace lines 102-107 (home team in hero):
```tsx
// BEFORE:
<div className="w-20 h-20 bg-white/10 rounded-full flex items-center justify-center backdrop-blur-md mb-3">
  <span className="text-3xl font-black italic font-headline">
    {featured.homeTeam.abbreviation.charAt(0)}
  </span>
</div>

// AFTER:
<div className="w-20 h-20 rounded-full flex items-center justify-center backdrop-blur-md mb-3 overflow-hidden">
  <TeamBadge team={featured.homeTeam} size={64} variant="home" />
</div>
```

Replace lines 113-117 (away team in hero):
```tsx
// BEFORE:
<div className="w-20 h-20 bg-white/10 rounded-full flex items-center justify-center backdrop-blur-md mb-3">
  <span className="text-3xl font-black italic font-headline">
    {featured.awayTeam.abbreviation.charAt(0)}
  </span>
</div>

// AFTER:
<div className="w-20 h-20 rounded-full flex items-center justify-center backdrop-blur-md mb-3 overflow-hidden">
  <TeamBadge team={featured.awayTeam} size={64} variant="away" />
</div>
```

- [ ] **Step 4: Replace the time/venue block in featured match hero with time + date + venue**

Replace the entire `<div className="text-right">` block (lines 87-99 in `page.tsx`) which currently contains the time and venue:

```tsx
// BEFORE:
<div className="text-right">
  <span className="block text-2xl font-bold font-headline">
    {new Date(featured.scheduledAt).toLocaleTimeString('en-AU', {
      hour: '2-digit',
      minute: '2-digit',
    })}
  </span>
  {featured.venue && (
    <span className="text-[10px] uppercase font-label text-slate-400">
      {featured.venue}
    </span>
  )}
</div>

// AFTER:
<div className="text-right">
  <span className="block text-2xl font-bold font-headline">
    {new Date(featured.scheduledAt).toLocaleTimeString('en-AU', {
      hour: '2-digit',
      minute: '2-digit',
    })}
  </span>
  <span className="text-[10px] uppercase font-label text-slate-300 block">
    {new Date(featured.scheduledAt).toLocaleDateString('en-AU', { weekday: 'short', day: 'numeric', month: 'short' })}
  </span>
  {featured.venue && (
    <span className="text-[10px] uppercase font-label text-slate-400">
      {featured.venue}
    </span>
  )}
</div>
```

- [ ] **Step 5: Update side fixture cards with both team logos and dates**

Replace the side fixture card content (lines 134-152). The current card only shows the home team letter. Update to show both team badges and add the date:

```tsx
<Link
  key={match.id}
  href={`/match/${match.id}`}
  className="bg-surface-container rounded-xl p-4 flex items-center justify-between group hover:bg-surface-container-high transition-all"
>
  <div className="flex items-center gap-3">
    <TeamBadge team={match.homeTeam} size={32} variant="home" />
    <div>
      <div className="text-[10px] font-bold text-on-surface-variant uppercase font-label">
        {new Date(match.scheduledAt).toLocaleDateString('en-AU', { weekday: 'short', day: 'numeric', month: 'short' })}
        {' \u2022 '}
        {new Date(match.scheduledAt).toLocaleTimeString('en-AU', {
          hour: '2-digit',
          minute: '2-digit',
        })}
      </div>
      <div className="text-sm font-bold font-headline text-primary">
        {match.homeTeam.abbreviation} v {match.awayTeam.abbreviation}
      </div>
    </div>
    <TeamBadge team={match.awayTeam} size={32} variant="away" />
  </div>
  <span className="material-symbols-outlined text-outline-variant group-hover:text-primary transition-colors">
    calendar_today
  </span>
</Link>
```

- [ ] **Step 6: Verify build compiles**

Run: `npx next build 2>&1 | head -30`
Expected: Build completes without errors.

- [ ] **Step 7: Commit**

```bash
git add src/app/page.tsx
git commit -m "feat: add team logos, dates, and recent-first results on homepage"
```

---

## Parallelism

```
Task 1 (TeamBadge) ──┬──> Task 2 (ScoreCard) ──┐
                      └──> Task 3 (page.tsx)  ───┤
                                                  └──> Final verification
```

Tasks 2 and 3 are independent and can be assigned to separate agents once Task 1 is committed.
