# Home Page UI Fixes — Implementation Plan

> **For agentic workers:** This plan is designed for **team-of-agents execution**. The team lead creates tasks, assigns them to agents based on the dependency graph below, and reviews between phases. Each task uses checkbox (`- [ ]`) syntax for tracking.

**Goal:** Seven targeted UI fixes to the home page — rename featured label, combined date/time format, richer side fixtures, remove "Final" badge, grouped results by round, and consistent card heights.

**Architecture:** Three files changed: `format.ts` (new function), `ScoreCard.tsx` (new prop + flex layout), `page.tsx` (all rendering changes). Changes are decomposed into 6 tasks across 3 phases for parallel execution.

**Tech Stack:** Next.js 15 (App Router), TypeScript, Tailwind CSS 4, Vitest

**Spec:** `docs/superpowers/specs/2026-04-03-home-page-fixes-design.md`

---

## File Map

| File | Action | Responsibility |
|------|--------|---------------|
| `src/lib/format.ts` | Modify | Add `formatMatchDateTime()` |
| `src/lib/format.test.ts` | Modify | Tests for `formatMatchDateTime()` |
| `src/components/ui/ScoreCard.tsx` | Modify | `showFinalBadge` prop + flex-stretch layout |
| `src/components/ui/__tests__/ScoreCard.test.tsx` | Modify | Tests for new prop + layout |
| `src/app/page.tsx` | Modify | All home page rendering changes |
| `src/app/__tests__/page.test.tsx` | Modify | Tests for grouped results, renamed label, etc. |

## Dependency Graph & Team Assignment

```
Phase 1 (parallel):
  Task 1: format.ts ──────────┐
  Task 2: ScoreCard flex ─────┤── no dependencies between them
                               │
Phase 2 (parallel, after Task 1):
  Task 3: ScoreCard prop ─────┤── depends on Task 1 (imports formatMatchDateTime)
  Task 4: page.tsx fixtures ──┤── depends on Task 1 (imports formatMatchDateTime)
                               │
Phase 3 (after Tasks 1-4):
  Task 5: page.tsx results ───┤── depends on Tasks 1, 2, 3
                               │
Phase 4 (after all):
  Task 6: Full verification ──┘
```

**Suggested team:**
- **Agent A:** Tasks 1, then 3 (format.ts, then ScoreCard prop)
- **Agent B:** Tasks 2, then 4 (ScoreCard flex, then page.tsx fixtures)
- **Agent C:** Task 5 (page.tsx results — starts after phase 2)
- **Team lead:** Task 6 (verification)

---

## Task 1: Add `formatMatchDateTime` to format.ts

**Files:**
- Modify: `src/lib/format.ts:1-56`
- Modify: `src/lib/format.test.ts:1-32`

**Dependencies:** None

- [ ] **Step 1: Write the failing test**

Add to `src/lib/format.test.ts`:

```typescript
import { describe, it, expect, vi, afterEach } from 'vitest';
import { computeAge, formatMatchDateTime } from './format';

// ... existing computeAge tests ...

describe('formatMatchDateTime', () => {
  it('formats date and time on one line', () => {
    // April 5 2026 at 05:00 UTC = 3:00 PM AEST
    const result = formatMatchDateTime(new Date('2026-04-05T05:00:00Z'));
    expect(result).toContain('Sat');
    expect(result).toContain('5');
    expect(result).toContain('Apr');
    expect(result).toContain('3:00');
    expect(result).toContain('pm');
  });

  it('does not pad single-digit hours', () => {
    const result = formatMatchDateTime(new Date('2026-04-05T05:00:00Z'));
    expect(result).not.toContain('03:00');
  });

  it('accepts string dates', () => {
    const result = formatMatchDateTime('2026-04-05T05:00:00Z');
    expect(result).toContain('Apr');
    expect(result).toContain('3:00');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/format.test.ts`
Expected: FAIL — `formatMatchDateTime` is not exported from `./format`

- [ ] **Step 3: Write the implementation**

Add to `src/lib/format.ts` after the `formatShortDate` function (after line 27):

```typescript
export function formatMatchDateTime(date: string | Date): string {
  const d = new Date(date);
  const datePart = formatMatchDate(d);
  const timePart = d.toLocaleTimeString(LOCALE, {
    hour: 'numeric',
    minute: '2-digit',
    timeZone: TIMEZONE,
  });
  return `${datePart}, ${timePart}`;
}
```

This composes `formatMatchDate` (→ `"Sat 5 Apr"`) with a time part using `hour: 'numeric'` (drops leading zero → `"3:00 pm"`). Result: `"Sat 5 Apr, 3:00 pm"`.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/lib/format.test.ts`
Expected: All tests PASS

- [ ] **Step 5: Commit**

```bash
git add src/lib/format.ts src/lib/format.test.ts
git commit -m "feat: add formatMatchDateTime combining date and time on one line"
```

---

## Task 2: ScoreCard flex-stretch layout

**Files:**
- Modify: `src/components/ui/ScoreCard.tsx:30-95`
- Modify: `src/components/ui/__tests__/ScoreCard.test.tsx:1-56`

**Dependencies:** None

- [ ] **Step 1: Write the failing test**

Add to `src/components/ui/__tests__/ScoreCard.test.tsx`:

```typescript
it('renders with flex column layout for consistent card heights', () => {
  const { container } = render(<ScoreCard match={liveMatch} />);
  const link = container.querySelector('a');
  expect(link?.className).toContain('flex');
  expect(link?.className).toContain('flex-col');
  expect(link?.className).toContain('h-full');
});

it('renders score section with flex-grow for vertical centering', () => {
  const { container } = render(<ScoreCard match={liveMatch} />);
  // The score display wrapper should have flex-1
  const scoreSection = container.querySelector('[data-testid="score-display"]');
  expect(scoreSection?.className).toContain('flex-1');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/components/ui/__tests__/ScoreCard.test.tsx`
Expected: FAIL — `className` does not contain `flex-col` and `h-full`; `data-testid` element not found

- [ ] **Step 3: Implement flex-stretch layout**

Modify `src/components/ui/ScoreCard.tsx`:

Change the outer `<Link>` className (line 33) from:

```typescript
className={`block bg-surface-container-lowest rounded-xl p-6 shadow-sm relative overflow-hidden group transition-all hover:shadow-md ${
  isLive ? 'border-l-4 border-secondary' : 'border-l-4 border-transparent'
}`}
```

to:

```typescript
className={`flex flex-col h-full bg-surface-container-lowest rounded-xl p-6 shadow-sm relative overflow-hidden group transition-all hover:shadow-md ${
  isLive ? 'border-l-4 border-secondary' : 'border-l-4 border-transparent'
}`}
```

Wrap the score display section (lines 58-78) in a flex-grow container. Change:

```tsx
{/* Score display */}
<div className="flex items-center justify-between gap-4">
```

to:

```tsx
{/* Score display */}
<div data-testid="score-display" className="flex-1 flex flex-col justify-center">
<div className="flex items-center justify-between gap-4">
```

And add a closing `</div>` after the score display's closing `</div>` (after line 78):

```tsx
        </div>
      </div>  {/* close flex-1 wrapper */}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/components/ui/__tests__/ScoreCard.test.tsx`
Expected: All tests PASS

- [ ] **Step 5: Commit**

```bash
git add src/components/ui/ScoreCard.tsx src/components/ui/__tests__/ScoreCard.test.tsx
git commit -m "feat: flex-stretch ScoreCard layout for consistent card heights"
```

---

## Task 3: ScoreCard `showFinalBadge` prop

**Files:**
- Modify: `src/components/ui/ScoreCard.tsx:4-55`
- Modify: `src/components/ui/__tests__/ScoreCard.test.tsx`

**Dependencies:** Task 1 (imports `formatMatchDateTime` from `format.ts`)

- [ ] **Step 1: Write the failing tests**

Add to `src/components/ui/__tests__/ScoreCard.test.tsx`:

First, add a `completedMatch` fixture near the top (after `scheduledMatch`):

```typescript
const completedMatch = {
  ...liveMatch,
  id: '3',
  status: 'COMPLETED' as const,
  homeScore: 64,
  awayScore: 58,
  currentQuarter: null,
  currentTime: null,
  scheduledAt: '2026-04-05T05:00:00Z',
};
```

Then add these tests:

```typescript
it('shows Final badge for completed matches by default', () => {
  render(<ScoreCard match={completedMatch} />);
  expect(screen.getByText('Final')).toBeInTheDocument();
});

it('hides Final badge when showFinalBadge is false', () => {
  render(<ScoreCard match={completedMatch} showFinalBadge={false} />);
  expect(screen.queryByText('Final')).not.toBeInTheDocument();
});

it('shows date/time when showFinalBadge is false for completed matches', () => {
  render(<ScoreCard match={completedMatch} showFinalBadge={false} />);
  // formatMatchDateTime produces "Sat 5 Apr, 3:00 pm" for 2026-04-05T05:00:00Z
  expect(screen.getByText(/Sat/)).toBeInTheDocument();
  expect(screen.getByText(/3:00/)).toBeInTheDocument();
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/components/ui/__tests__/ScoreCard.test.tsx`
Expected: FAIL — `showFinalBadge` prop not recognized; first test may pass (Final is already shown)

- [ ] **Step 3: Implement the prop**

In `src/components/ui/ScoreCard.tsx`:

Add `formatMatchDateTime` to the import (line 4):

```typescript
import { formatMatchDate, formatMatchTime, formatGameClock, formatMatchDateTime } from '@/lib/format';
```

Add the prop to `ScoreCardProps` interface (line 21-23):

```typescript
interface ScoreCardProps {
  match: ScoreCardMatch;
  showFinalBadge?: boolean;
}
```

Update the component signature (line 25):

```typescript
export function ScoreCard({ match, showFinalBadge = true }: ScoreCardProps) {
```

Replace the completed status badge block (lines 44-48):

```tsx
{isCompleted && (
  <span className="bg-surface-container-high text-on-surface-variant px-3 py-1 rounded-full text-[10px] font-bold font-label tracking-widest uppercase">
    Final
  </span>
)}
```

with:

```tsx
{isCompleted && showFinalBadge && (
  <span className="bg-surface-container-high text-on-surface-variant px-3 py-1 rounded-full text-[10px] font-bold font-label tracking-widest uppercase">
    Final
  </span>
)}
{isCompleted && !showFinalBadge && match.scheduledAt && (
  <span className="text-[10px] font-bold text-on-surface-variant uppercase font-label">
    {formatMatchDateTime(match.scheduledAt)}
  </span>
)}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/components/ui/__tests__/ScoreCard.test.tsx`
Expected: All tests PASS

- [ ] **Step 5: Commit**

```bash
git add src/components/ui/ScoreCard.tsx src/components/ui/__tests__/ScoreCard.test.tsx
git commit -m "feat: ScoreCard showFinalBadge prop to replace Final with date/time"
```

---

## Task 4: Home page — featured card and side fixtures

**Files:**
- Modify: `src/app/page.tsx:1-161`
- Modify: `src/app/__tests__/page.test.tsx`

**Dependencies:** Task 1 (imports `formatMatchDateTime`)

- [ ] **Step 1: Write the failing tests**

Add to `src/app/__tests__/page.test.tsx`:

```typescript
it('renders "Next Match" label instead of "Match of the Day"', async () => {
  const page = await HomePage();
  render(page);
  expect(screen.getByText('Next Match')).toBeInTheDocument();
  expect(screen.queryByText('Match of the Day')).not.toBeInTheDocument();
});

it('renders full team names in side fixtures', async () => {
  const page = await HomePage();
  render(page);
  // The mock has 'Wolves' and 'Harbor' as the scheduled match team names
  // Side fixtures should show full names, not abbreviations
  expect(screen.queryByText(/WOL v HAR/)).not.toBeInTheDocument();
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/app/__tests__/page.test.tsx`
Expected: FAIL — "Next Match" not found, "Match of the Day" is found

- [ ] **Step 3: Update the import**

In `src/app/page.tsx`, change the format import (line 4):

```typescript
import { formatMatchDateTime } from '@/lib/format';
```

Remove the old `formatMatchDate` and `formatMatchTime` imports — the home page will only use `formatMatchDateTime` after these changes.

- [ ] **Step 4: Rename featured label**

In `src/app/page.tsx`, change the featured match label (line 90):

```tsx
<span className="text-lime-400 font-black font-label text-xs uppercase tracking-widest">
  Next Match
</span>
```

- [ ] **Step 5: Combine date/time in featured card**

Replace the date/time block (lines 96-108) with:

```tsx
<div className="text-right">
  <span className="block text-lg font-bold font-headline">
    {formatMatchDateTime(featured.scheduledAt)}
  </span>
  {featured.venue && (
    <span className="text-[10px] uppercase font-label text-slate-400 block mt-1">
      {featured.venue}
    </span>
  )}
</div>
```

- [ ] **Step 6: Update side fixtures — full names, larger badges, venue**

Replace the side fixtures section (lines 133-158) with:

```tsx
<div className="flex flex-col gap-4">
  {upcomingMatches.slice(featured ? 1 : 0, 4).map((match) => (
    <Link
      key={match.id}
      href={`/match/${match.id}`}
      className="bg-surface-container rounded-xl p-4 flex items-center justify-between group hover:bg-surface-container-high transition-all"
    >
      <div className="flex items-center gap-3">
        <TeamBadge team={match.homeTeam} size={44} variant="home" />
        <div>
          <div className="text-sm font-bold font-headline text-primary">
            {match.homeTeam.name} v {match.awayTeam.name}
          </div>
          <div className="text-[10px] font-bold text-on-surface-variant uppercase font-label">
            {formatMatchDateTime(match.scheduledAt)}
          </div>
          <div className="text-[10px] text-on-surface-variant font-label">
            {match.venue}
          </div>
        </div>
        <TeamBadge team={match.awayTeam} size={44} variant="away" />
      </div>
      <span className="material-symbols-outlined text-outline-variant group-hover:text-primary transition-colors">
        calendar_today
      </span>
    </Link>
  ))}
</div>
```

Key changes: badges 32→44, abbreviations→full names (team names first, then date/time, then venue), `formatMatchDateTime`.

- [ ] **Step 7: Run tests to verify they pass**

Run: `npx vitest run src/app/__tests__/page.test.tsx`
Expected: All tests PASS

- [ ] **Step 8: Commit**

```bash
git add src/app/page.tsx src/app/__tests__/page.test.tsx
git commit -m "feat: rename featured label, combined date/time, richer side fixtures"
```

---

## Task 5: Home page — grouped results by round

**Files:**
- Modify: `src/app/page.tsx:37-173`
- Modify: `src/app/__tests__/page.test.tsx`

**Dependencies:** Tasks 1, 2, 3 (uses `formatMatchDateTime`, flex ScoreCard, `showFinalBadge` prop)

- [ ] **Step 1: Update the mock to include completed matches**

In `src/app/__tests__/page.test.tsx`, add completed matches to the mock's `findMany` return array (after the existing scheduled match):

```typescript
{
  id: '3',
  status: 'COMPLETED',
  homeScore: 64,
  awayScore: 58,
  currentQuarter: null,
  currentTime: null,
  round: 5,
  venue: 'RAC Arena',
  scheduledAt: new Date('2026-04-05T05:00:00Z'),
  homeTeam: { name: 'Vixens', abbreviation: 'VIX', logoUrl: null },
  awayTeam: { name: 'Fever', abbreviation: 'FEV', logoUrl: null },
},
{
  id: '4',
  status: 'COMPLETED',
  homeScore: 71,
  awayScore: 65,
  currentQuarter: null,
  currentTime: null,
  round: 4,
  venue: 'USC Stadium',
  scheduledAt: new Date('2026-03-29T03:00:00Z'),
  homeTeam: { name: 'Swifts', abbreviation: 'SWI', logoUrl: null },
  awayTeam: { name: 'Lightning', abbreviation: 'LIG', logoUrl: null },
},
```

- [ ] **Step 2: Write the failing tests**

Add to `src/app/__tests__/page.test.tsx`:

```typescript
it('renders RESULTS section with round headings', async () => {
  const page = await HomePage();
  render(page);
  expect(screen.getByText('RESULTS')).toBeInTheDocument();
  expect(screen.getByText('Round 5')).toBeInTheDocument();
  expect(screen.getByText('Round 4')).toBeInTheDocument();
});

it('renders results grouped by round in descending order', async () => {
  const page = await HomePage();
  render(page);
  const round5 = screen.getByText('Round 5');
  const round4 = screen.getByText('Round 4');
  // Round 5 should appear before Round 4 in the DOM
  expect(round5.compareDocumentPosition(round4) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
});

it('does not show Final badge in results', async () => {
  const page = await HomePage();
  render(page);
  expect(screen.queryByText('Final')).not.toBeInTheDocument();
});
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `npx vitest run src/app/__tests__/page.test.tsx`
Expected: FAIL — "Round 5" heading not found (results are flat grid), "Final" is still shown

- [ ] **Step 4: Implement grouped results**

In `src/app/page.tsx`, replace the `completedMatches` line (line 39):

```typescript
const completedMatches = matches.filter((m) => m.status === 'COMPLETED').reverse();
```

with:

```typescript
// Sort completed matches by round desc, then scheduledAt asc within each round
const sortedCompleted = matches
  .filter((m) => m.status === 'COMPLETED')
  .sort((a, b) => {
    if (a.round !== b.round) return b.round - a.round;
    return new Date(a.scheduledAt).getTime() - new Date(b.scheduledAt).getTime();
  });

// Group by round
const resultsByRound = new Map<number, typeof sortedCompleted>();
for (const match of sortedCompleted) {
  const group = resultsByRound.get(match.round) ?? [];
  group.push(match);
  resultsByRound.set(match.round, group);
}
```

Replace the results section (lines 163-173) with:

```tsx
{/* Results grouped by round */}
{resultsByRound.size > 0 && (
  <section className="mb-16">
    <h2 className="text-xl font-bold font-headline text-primary mb-6">RESULTS</h2>
    {Array.from(resultsByRound.entries()).map(([round, roundMatches]) => (
      <div key={round} className="mb-8">
        <h3 className="text-sm font-semibold text-on-surface-variant mb-3 pb-2 border-b border-outline-variant">
          Round {round}
        </h3>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {roundMatches.map((match) => (
            <ScoreCard
              key={match.id}
              match={{ ...match, round: undefined }}
              showFinalBadge={false}
            />
          ))}
        </div>
      </div>
    ))}
  </section>
)}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx vitest run src/app/__tests__/page.test.tsx`
Expected: All tests PASS

- [ ] **Step 6: Commit**

```bash
git add src/app/page.tsx src/app/__tests__/page.test.tsx
git commit -m "feat: group results by round with descending round headings"
```

---

## Task 6: Full verification

**Files:** All modified files
**Dependencies:** Tasks 1-5

- [ ] **Step 1: Run full test suite**

Run: `npx vitest run`
Expected: All tests PASS, no regressions

- [ ] **Step 2: TypeScript check**

Run: `npx tsc --noEmit`
Expected: No type errors

- [ ] **Step 3: Visual verification**

Run: `npm run dev`

Check the home page at `http://localhost:3000`:
- Featured card says "Next Match" (not "Match of the Day")
- Featured card shows combined date/time on one line (e.g., "Sat 5 Apr, 3:00 pm"), venue on separate line
- Side fixtures show full team names, 44px badges, venue line
- Results grouped by round with "Round N" headings, latest round first
- No "Final" badge on result cards — shows date/time instead
- Result cards in same row have aligned footers regardless of team name length
- Within each round, matches ordered by game time ascending

- [ ] **Step 4: Final commit if any adjustments needed**

```bash
git add -A
git commit -m "fix: adjustments from visual review"
```
