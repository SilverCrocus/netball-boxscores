# CentrePass QOL, Performance & Product Improvements — Implementation Specification

**Date:** 2026-07-12

**Status:** Implementation underway — first release package complete locally

**Product:** CentrePass (`https://www.centrepass.io`)

**Scope:** Public fixtures/results, match detail, standings, team/player profiles, live state, account discovery, personalization, accessibility, media handling, performance, and deployment architecture

**Decision:** Keep the application in Next.js/TypeScript. Do not introduce Rust in this programme unless the profiling gate in §15 is met.

**Implementation snapshot (2026-07-12):** The first local release package now includes the bounded/paginated homepage, season-scoped standings and team records, useful Live Hub, accessibility repairs, stable-data cache policy, explicit match payloads, on-demand filtered play-by-play, responsive profile/media fallbacks, account discovery, global search, followed-team homepage content, favourites, and reminders. It passes 278 automated tests and a production build. Deployment and the remaining release-hardening items in this specification—including the normalized local badge asset pack/media audit and any evidence-gated worker isolation—remain separate follow-up work.

## 1. Purpose

This specification converts the 2026-07-12 user-experience and codebase audit into an implementation-ready programme of work.

The programme has four outcomes:

1. Make the first useful screen materially faster by returning and rendering less data.
2. Make the product easier to navigate and understand on desktop and mobile.
3. Finish and expose the account, followed-team, favourite, and reminder capabilities already present in the repository.
4. Correct season scoping, accessibility semantics, media fallbacks, and runtime ownership before the product grows.

The implementation should retain CentrePass's existing design language:

- navy kinetic-gradient surfaces;
- lime live/active accents;
- Lexend display typography and Manrope body typography;
- compact, high-information sports presentation;
- existing `TeamBadge`, `PlayerAvatar`, score-card, table, and navigation patterns where they remain fit for purpose.

This is an improvement programme, not a visual rebrand.

## 2. Audit Baseline

The following measurements were captured against production from Sydney on 2026-07-12. They are a single-run diagnostic baseline, not a substitute for continuous real-user monitoring.

| Surface | Observed result |
|---|---:|
| Homepage uncached navigation | 3.60 s |
| Homepage response headers / approximate TTFB | 3.22 s |
| Homepage initial transferred data | ~189 KB |
| Homepage HTML transferred | ~72.9 KB |
| Homepage DOM nodes | 6,630 |
| Homepage images | 121 |
| Homepage links | 67 |
| Homepage height, 1440 × 900 | 9,347 px |
| Homepage height, 390 × 844 | 15,891 px |
| Match uncached navigation | 2.78 s |
| Match response headers / approximate TTFB | 2.58 s |
| Match initial transferred data | ~219 KB |
| Match JavaScript transferred | ~49 KB compressed |
| Largest built chart chunk | ~368 KB uncompressed |
| Console warnings/errors during audited flow | 0 |
| Automated verification | lint, typecheck, build, 233 tests passed |

The dominant constraints are database-backed server rendering, uncached data, eager event loading, and excessive initial DOM size. The frontend does not show evidence of a CPU-bound workload that would justify a Rust rewrite.

## 3. Product Goals

### 3.1 Primary goals

- A visitor can understand the current competition state within the first viewport.
- A visitor can find a match, team, player, round, or season without scanning the entire year.
- Stable pages reuse cached data while live data remains current.
- Match detail loads the box score first and play-by-play only on demand.
- Standings and team records always belong to the selected competition/season.
- The Live destination remains useful when no game is live.
- Sign-in and account capabilities are discoverable.
- Followed teams, favourites, and reminders have visible product behaviour.
- Major controls have correct keyboard and assistive-technology semantics.
- Missing or unusable media always has a legible fallback.

### 3.2 Success metrics

The following are release budgets, measured from the Sydney region in production after a warm service instance is available:

| Metric | Target |
|---|---:|
| Cached homepage TTFB, p50 | < 800 ms |
| Cached homepage TTFB, p95 | < 1,500 ms |
| Cached teams/standings TTFB, p50 | < 500 ms |
| Initial homepage DOM nodes | < 2,000 |
| Initial completed-match cards on homepage | ≤ 8 |
| Initial play-by-play entries transferred | 0 until tab activation |
| Play-by-play page size | ≤ 75 entries per request |
| Initial route JavaScript, excluding an activated chart | no regression from baseline |
| Relevant browser console warnings/errors | 0 |
| Automated tests | all existing tests plus new acceptance tests pass |

If infrastructure latency prevents a budget from being met after query and caching work, record the server timing breakdown and raise an explicit hosting/database-region decision rather than weakening the budget silently.

## 4. Non-Goals

- Rebranding CentrePass.
- Rewriting the web application, API routes, or ingestion pipeline in Rust.
- Changing Champion Data as the canonical live source.
- Replacing PostgreSQL/Prisma.
- Rebuilding Socket.io before the worker-separation gate is reached.
- Introducing another component library.
- Adding paid subscription, betting, ticketing, or social-community features.
- Claiming full WCAG conformance without assistive-technology and zoom testing.

## 5. Delivery Strategy

Work is divided into four release phases. Each phase must remain independently deployable.

| Phase | Theme | Expected outcome |
|---|---|---|
| 1 | Correctness and quick QOL | Less homepage content, correct seasons, useful Live state, accessible controls |
| 2 | Performance and responsive polish | Cached stable data, on-demand events/charts, improved mobile/desktop layouts |
| 3 | Product completion | Discoverable account, followed teams, favourites, reminders, search and filters |
| 4 | Runtime isolation, conditional | Separate worker only if instrumentation proves meaningful contention or scale risk |

Do not begin Phase 4 solely because it appears architecturally cleaner. Complete the instrumentation gate first.

## 6. Phase 1 — Homepage Information Architecture

### 6.1 Required behaviour

The homepage continues to show, in this order:

1. live matches;
2. upcoming fixtures, maximum four;
3. the most recent completed stage/round;
4. additional recent results up to a hard initial maximum of eight match cards;
5. a control for retrieving earlier rounds/results.

The initial server query must not return the complete season's completed matches.

### 6.2 Competition-state header

Replace the permanently generic `TODAY'S PULSE` message with a state-aware header:

| State | Eyebrow | Heading | Supporting content |
|---|---|---|---|
| One or more live matches | Game Day Hub | LIVE NOW | Current match count and direct live CTA |
| Upcoming match within seven days | Next Round | UPCOMING | Local date/time and countdown |
| In season, no imminent fixture | Season {year} | LATEST RESULTS | Latest completed round |
| Grand Final complete, no future fixture | Season {year} Complete | CHAMPIONS CROWNED | Champion, final score, season recap CTA |
| No published fixtures | Season {year} | FIXTURES COMING SOON | Existing no-fixtures explanation |

Use competition and match data; do not infer season state only from the current calendar date.

### 6.3 Earlier-results interaction

- Add a `View previous rounds` control after the initial results.
- The control retrieves the next group, not the entire remaining season.
- Use a cursor based on `(scheduledAt, id)`.
- Each request returns no more than eight matches.
- Preserve grouping labels such as `Round 13`, `Semi Finals`, and `Grand Final`.
- Provide an explicit loading label and failure/retry state.
- Newly loaded content is announced through a polite live region.
- The URL may remain unchanged for progressive loading; season/filter state must use URL search parameters.

### 6.4 Filters

Add compact filters above results:

- Season
- Team
- Stage/round
- Upcoming / Results

Requirements:

- Filters use URL search parameters so results are shareable and back/forward navigation works.
- The default season is the latest competition row, never a hardcoded year.
- `Clear filters` appears only when a non-default filter is active.
- Mobile uses a full-width filter sheet or stacked controls; desktop uses an inline toolbar.
- An empty combination shows a clear no-results message and reset action.

### 6.5 Suggested implementation

- Extract latest-competition lookup into `src/lib/competitions.ts`.
- Extract homepage query and grouping into `src/lib/home-feed.ts`.
- Add `src/app/api/matches/route.ts` or a route-handler equivalent for cursor pagination.
- Keep the first eight completed matches server-rendered for SEO and first paint.
- Add a small client component only for filtering/pagination interaction.

### 6.6 Acceptance criteria

- Initial homepage completed-match query contains `take: 8` or an equivalent hard bound.
- Initial homepage contains no more than eight completed score cards.
- Initial homepage DOM contains fewer than 2,000 nodes using the production dataset.
- Mobile initial page height is materially below the 15,891 px baseline.
- Every filter can be applied, cleared, deep-linked, and restored with browser navigation.
- Postseason mode identifies the Grand Final winner correctly.
- Database-unavailable and no-fixtures states still work.

## 7. Phase 1 — Season and Standings Correctness

### 7.1 Current risk

The standings page currently requests every `Standing` row without a competition filter and displays a hardcoded `Season 2026`. The team page requests `standings: { take: 1 }` without an explicit competition or order.

### 7.2 Required behaviour

- Standings are always filtered by the selected competition ID.
- The default competition is the latest season.
- The season label comes from the selected competition row.
- Team profile record/rank uses the same selected/default competition.
- Player profile season selection remains compatible with the shared competition helper.
- Unknown season parameters fall back to the latest season and canonicalize the URL.
- A season with no standings displays a named empty state.

### 7.3 Mobile presentation

Below the `md` breakpoint, replace the wide standings table with ladder cards containing:

- rank;
- badge and team name;
- games played;
- W–L–D record;
- goal percentage;
- points.

The desktop table remains. Both views use the same semantic data and link each team once.

### 7.4 Acceptance criteria

- No standings query executes without a competition constraint.
- Header year and returned rows always match.
- Team rank matches the selected/default standings page.
- Mobile users can read every essential value without horizontal scrolling.
- Desktop column tooltips and table headers remain available.
- Tests cover multiple competitions with duplicate team participation.

## 8. Phase 1 — Useful Live Empty State

### 8.1 Required behaviour

The `/live` route remains a valid destination at all times.

- If a live match exists, redirect to the first live match as today.
- If several matches are live, render a live-match chooser rather than selecting silently.
- If no match is live, render a Live Hub containing:
  - `No match is live right now`;
  - the next scheduled match and local countdown, when available;
  - the latest completed match;
  - followed-team context when signed in;
  - a reminder/sign-in CTA;
  - a link back to all fixtures.

Navigation requirements:

- Live remains readable and clickable when inactive.
- Inactive state uses normal navigation contrast; availability is communicated in the page, not by making the item look broken.
- When a match is imminent, show `Starts in Xm` without claiming the match is live.

### 8.2 Acceptance criteria

- `/live` never redirects to `/` solely because no match is live.
- No-live, one-live, and multiple-live states have tests.
- Navigation contrast remains legible in all states.
- Countdown is based on the Sydney-local display helper and handles expired schedules safely.

## 9. Phase 1 — Accessibility and Interaction Semantics

### 9.1 Authentication forms

For sign-in and sign-up:

- connect every `<label>` with `htmlFor` and a unique input `id`;
- add stable `name` attributes;
- add `autocomplete="email"`, `current-password`, and `new-password` as appropriate;
- expose validation/authentication errors with `role="alert"`;
- set the Google action to `type="button"`;
- preserve a visible focus indicator;
- disable repeat submission while loading;
- add a password visibility control with an accessible label;
- add a password-recovery entry only when its complete email/reset flow is implemented.

### 9.2 Match tabs

Implement the WAI-ARIA tab pattern:

- containing element `role="tablist"` with an accessible label;
- each tab `role="tab"`, `aria-selected`, `aria-controls`, and stable ID;
- each panel `role="tabpanel"`, `aria-labelledby`, and stable ID;
- Left/Right Arrow switches tabs;
- Home/End selects first/last;
- focus management does not scroll the page unexpectedly.

### 9.3 Expanders, icons, and duplicated links

- Biography `Read more` exposes `aria-expanded` and `aria-controls`.
- Decorative Material Symbols use `aria-hidden="true"`.
- Team roster rows have one clear player link, not a name link plus an unnamed chevron link.
- Icon-only controls have explicit accessible names.
- Loading and newly inserted results use non-disruptive live regions.
- Respect `prefers-reduced-motion` for pulse, scaling, and reveal effects.

### 9.4 Acceptance criteria

- All form controls have non-empty accessible names in DOM inspection.
- Tab selection is available through semantics, not colour alone.
- Keyboard operation passes for navigation, filters, tabs, pagination, carousels, and forms.
- No duplicate unnamed links remain in team roster rows.
- Existing unit/component tests are extended for attributes and keyboard behaviour.

## 10. Phase 2 — Server Rendering and Cache Policy

### 10.1 Cache matrix

| Data | Policy | Maximum staleness |
|---|---|---:|
| Teams and stable team metadata | server cache | 1 hour |
| Competition list | server cache | 1 hour |
| Completed-match history | server cache | 15 minutes |
| Completed match detail | server cache | 15 minutes |
| Standings | server cache | 60 seconds |
| Upcoming fixtures | server cache | 60 seconds |
| Live state/scores | no-store / socket-driven | live |
| User-specific follows/favourites/reminders | private, no shared cache | current user |

Use a shared query wrapper built with a Next.js-supported server-cache primitive. For this repository, prefer `unstable_cache` with explicit keys and TTLs unless a tested Next.js 16 cache API is adopted for the entire codebase.

Do not cache user-specific data in shared route output.

### 10.2 Page composition

- Remove `force-dynamic` from teams and standings after cache-safe query wrappers exist.
- Keep live state dynamic.
- Compose homepage stable history separately from live/upcoming state.
- Add Suspense boundaries only where the fallback has stable dimensions and improves first paint.
- Do not place SEO-critical headings behind client-only loading.

### 10.3 Instrumentation

Add timing for:

- competition lookup;
- live query;
- upcoming query;
- completed-history query;
- match base query;
- score-flow query;
- match-event query;
- player profile query;
- total server render.

Expose aggregate values through `Server-Timing` in non-sensitive production responses or structured logs. Do not include SQL, IDs that reveal private data, or connection strings.

### 10.4 Acceptance criteria

- Cache behaviour has deterministic unit/integration coverage.
- User-specific data never leaks between sessions.
- Cached routes meet the budgets in §3.2 or contain a documented timing breakdown.
- Worker writes become visible within the declared staleness window.
- No stale page labels a completed match as live.

## 11. Phase 2 — Match Detail and Play-by-Play Loading

### 11.1 Initial match payload

The initial box-score request includes only:

- match identity/status/score;
- teams and display metadata;
- quarters;
- player box-score rows using explicit `select` fields;
- the minimal score-flow fields required for Match Momentum;
- summary values required for key stats and the top performer.

It must not include `matchEvents` or player fields not rendered by the box-score screen.

### 11.2 On-demand Play by Play

Add a read-only endpoint such as:

`GET /api/matches/{matchId}/events?limit=75&cursor=...&quarter=4&type=turnover`

Response shape:

```ts
interface MatchTimelineResponse {
  entries: PlayByPlayEntry[];
  nextCursor: string | null;
  totalKnown?: number;
}
```

Requirements:

- no event request before Play by Play is opened;
- maximum 75 entries per response;
- newest-first default;
- quarter filter;
- event-type filter;
- team filter;
- `Load older events` pagination;
- preserve current score badges, player links, team colour, and quarter separators;
- stale or invalid cursors return a typed 400 response;
- unknown match returns 404;
- database failure returns a retryable error state.

For live matches, new socket events are inserted at the top without discarding the user's filters. Announce new events only when the user is viewing the Play by Play panel.

### 11.3 Chart loading

- Dynamically import Recharts-backed chart components.
- Match hero and key score remain available without the chart chunk.
- Reserve chart height to prevent layout shift.
- Add a textual/table fallback for screen readers and no-JavaScript output.

### 11.4 Mobile stats tables

- Keep horizontal scrolling where the full stat matrix is necessary.
- Make the Player column sticky.
- Add an edge fade and `Swipe for more stats` hint until the user scrolls.
- Provide a compact `Key stats` mobile mode before the full table.
- Preserve table semantics.

### 11.5 Acceptance criteria

- Network evidence proves zero match-event transfer before tab activation.
- Initial match query uses explicit `select` fields.
- Play-by-play filtering and cursor pagination work for completed and live matches.
- The active tab has correct ARIA semantics.
- Chart loading does not move surrounding content.
- Mobile tables expose the hidden-column affordance and remain keyboard scrollable.

## 12. Phase 2 — Responsive Profiles and Media Resilience

### 12.1 Team profile

- Remove manual line breaks after every team-name word.
- Use a fluid heading size with normal phrase wrapping.
- Target a maximum of three lines at 320 px and two lines at desktop widths.
- Preserve the badge, ranking, and four headline statistics.
- Recent Form uses scroll snapping and visible previous/next controls on pointer devices.
- Show a partial next card or edge fade so horizontal content is discoverable.
- Add `View all results`.

### 12.2 Player profile

- A missing/unusable portrait always shows high-contrast initials.
- Percentage-change labels state the comparison baseline, for example `vs season-best pace` or `vs previous season`.
- `Impact`, `NetPoints`, `Gains`, `CPR`, `FD`, and super-shot notation have accessible definitions.
- Biography provenance is recorded and inconsistent nationality/biography claims are flagged during enrichment.

### 12.3 Team badges

The eight league badges are stable product assets and should not depend exclusively on a third-party URL at render time.

Preferred approach:

1. store normalized transparent PNG/WebP assets under `public/teams/{slug}`;
2. use a slug-to-asset mapping as the first source;
3. retain the upstream URL as a data provenance/fallback field;
4. render an abbreviation tile when neither asset is usable.

Normalize badge canvas size and visible-content bounds so marks do not look tiny or disappear on white cards.

### 12.4 Media audit utility

Add a read-only script that reports:

- missing URL/file;
- failed response;
- unexpected dimensions;
- excessive transparent padding;
- image with negligible visible pixel coverage;
- duplicate source URL;
- player/team records affected.

The script must not overwrite assets without an explicit write flag.

### 12.5 Acceptance criteria

- All eight teams have legible normalized badges on light and dark backgrounds.
- Player missing-image case displays initials on light and dark backgrounds.
- Team names remain readable at 320, 390, 768, 1024, and 1440 px.
- Recent Form content is discoverable by touch, mouse, and keyboard.
- Media audit script exits non-zero only for configured blocking failures.

## 13. Phase 3 — Account Discovery and Personalization

### 13.1 Navigation

- Desktop sidebar gains an Account section anchored near the bottom.
- Signed-out state shows `Sign in`.
- Signed-in state shows avatar/initial, `Settings`, and `Sign out`.
- Mobile gains a `More` destination or sheet containing account actions; do not silently overcrowd the existing four destinations.
- Settings is reachable without entering its URL manually.

### 13.2 Followed teams

Complete the promise currently displayed in Settings:

- Signed-in homepage displays `My Teams` after live/upcoming content and before general results.
- It contains the next fixture and latest result for each followed team.
- General public content remains available when no teams are followed.
- Following/unfollowing uses optimistic UI with rollback and error feedback.
- The setting button exposes pressed state with `aria-pressed`.

Keep personalized content in a private client/server slot so the public homepage cache remains shared.

### 13.3 Favourites and reminders

- Match cards/detail gain a favourite action.
- Scheduled matches gain a reminder action.
- Signed-out activation opens sign-in with a callback to the originating match.
- Settings contains lists of favourite matches and active reminders.
- Reminder copy is honest: in-app reminder until browser push is actually implemented.
- Duplicate POSTs are idempotent.
- Removal requires no destructive confirmation because it is easily reversible.

### 13.4 Search

Add a global search entry with grouped results:

- players;
- teams;
- matches.

Requirements:

- debounced input;
- no request before two characters;
- maximum five results per group;
- keyboard selection;
- highlighted matching text;
- clear empty/error states;
- server queries use explicit columns and limits;
- recent search history remains local and contains no sensitive data.

### 13.5 Acceptance criteria

- A first-time visitor can find sign-in from desktop and mobile.
- Callback returns the user to the action that prompted sign-in.
- Followed teams change homepage output for that user only.
- Favourite/reminder state survives reload and appears in Settings.
- Search routes to the correct player/team/match.
- Account state has no layout flash that blocks primary content.

## 14. Phase 3 — Additional Product Features

These features follow the core account and performance work.

### 14.1 Stat glossary

- Add a reusable glossary source in `src/lib/stat-glossary.ts`.
- Use the same definitions in tables, cards, tooltips, and accessible descriptions.
- Include goal/super-shot notation, NetPoints, Gains, Feeds, FD, CPR, G%, Impact, and possession metrics.

### 14.2 Share and calendar actions

- Copy/share match, team, and player canonical URLs.
- Scheduled match provides an `.ics` calendar download with Sydney timezone handling.
- Share feedback confirms completion without blocking navigation.

### 14.3 Historical comparison

- Season selectors on standings, teams, and players use the shared competition source.
- Player view can compare selected season with the previous available season.
- Team profile can show final ladder position and record by season.

### 14.4 PWA/push notifications

This remains a later opt-in project. Do not label in-app reminders as push notifications before service-worker permission, delivery, and opt-out flows exist.

## 15. Phase 4 — Worker Isolation and Rust Decision Gate

### 15.1 Current architecture risk

`startWorker()` runs inside the same Node process as Next.js and Socket.io. This can create contention and can start multiple polling loops if the web service is scaled horizontally.

### 15.2 Instrumentation gate

Separate the worker only if one or more of the following is observed over representative live rounds:

- worker processing overlaps and materially increases web-request p95;
- web CPU remains above 70% for sustained periods during polling;
- a poll regularly exceeds its scheduling interval;
- horizontal web scaling is required;
- duplicate poll ownership cannot be controlled safely in-process;
- worker failures cause user-facing restarts or missed live updates.

### 15.3 TypeScript separation design

If the gate is met:

1. Create a dedicated Render background worker service using the existing TypeScript worker modules.
2. Remove `startWorker()` from the web server.
3. Acquire a PostgreSQL advisory lock before polling so only one worker owns the feed.
4. Publish committed match deltas through a cross-process channel.
5. Prefer PostgreSQL `LISTEN/NOTIFY` for the first implementation to avoid adding Redis solely for this purpose.
6. The web service subscribes and forwards deltas through Socket.io.
7. If notifications are missed, clients recover from canonical database state on reconnect.
8. Keep worker-health/readiness separate from web readiness.

The cross-process broadcast channel must be implemented before the in-process worker is removed; otherwise live Socket.io updates will silently stop.

### 15.4 Rust decision

Do not introduce Rust for the web application or current ingestion worker.

Rust may be evaluated only if profiling proves a CPU-bound component after database, caching, batching, and process-isolation work. Candidate future use cases are:

- multi-league/high-frequency feed normalization;
- large simulation workloads;
- compute-heavy historical analytics;
- a reusable parser with a stable FFI or service boundary.

The evaluation requires:

- a captured CPU profile;
- a representative benchmark fixture;
- a TypeScript baseline;
- a Rust prototype isolated behind a service or library boundary;
- at least a 3× throughput improvement or a clearly material cost/latency benefit;
- an operational ownership plan.

Without those receipts, the decision remains **TypeScript**.

## 16. Data and API Contracts

### 16.1 Shared competition selection

```ts
interface CompetitionOption {
  id: string;
  season: number;
  name: string;
  seasonStart: Date | null;
  seasonEnd: Date | null;
}

interface SelectedCompetition {
  competition: CompetitionOption;
  wasFallback: boolean;
}
```

### 16.2 Paginated match feed

```ts
interface MatchFeedQuery {
  season?: number;
  team?: string;
  stage?: string;
  status?: 'SCHEDULED' | 'COMPLETED';
  cursor?: string;
  limit?: number; // server clamps to 8
}

interface MatchFeedResponse {
  groups: Array<{
    label: string;
    matches: MatchCardData[];
  }>;
  nextCursor: string | null;
}
```

### 16.3 Error format

New public API routes use:

```ts
interface ApiErrorResponse {
  error: {
    code: string;
    message: string;
    retryable: boolean;
  };
}
```

Do not expose raw Prisma, database, authentication-provider, or upstream feed errors.

## 17. Expected File Changes

### 17.1 Existing files likely to change

| File | Responsibility |
|---|---|
| `src/app/page.tsx` | state-aware home header, bounded initial results |
| `src/app/standings/page.tsx` | competition scoping, dynamic label, mobile cards |
| `src/app/live/page.tsx` | no-live/multiple-live hub |
| `src/app/match/[matchId]/page.tsx` | reduced initial select/payload |
| `src/app/match/[matchId]/MatchTabs.tsx` | semantic keyboard-operable tabs |
| `src/components/match/MatchPlayByPlay.tsx` | filters, pagination, loading/error states |
| `src/app/team/[teamSlug]/page.tsx` | season scoping, heading wrapping, carousel controls |
| `src/app/player/[playerId]/page.tsx` | shared competition selection and definitions |
| `src/components/player/PlayerBioCard.tsx` | expander semantics/provenance |
| `src/components/ui/PlayerAvatar.tsx` | reliable fallback |
| `src/components/ui/TeamBadge.tsx` | canonical local asset/fallback |
| `src/components/layout/Sidebar.tsx` | readable Live state and account entry |
| `src/components/layout/BottomNav.tsx` | More/account entry and active semantics |
| `src/app/auth/signin/page.tsx` | labels/autocomplete/errors/password visibility |
| `src/app/auth/signup/page.tsx` | matching form semantics |
| `src/app/settings/page.tsx` | followed teams, favourites, reminders |
| `src/lib/live-state.ts` | next/latest/multiple-live data as required |
| `src/lib/worker.ts` and `server.ts` | only in gated Phase 4 |
| `render.yaml` | only in gated Phase 4 |

### 17.2 Expected new files

- `src/lib/competitions.ts`
- `src/lib/home-feed.ts`
- `src/lib/stat-glossary.ts`
- `src/app/api/matches/route.ts`
- `src/app/api/matches/[matchId]/events/route.ts`
- `src/components/home/HomeFeedControls.tsx`
- `src/components/home/PersonalizedTeamRail.tsx`
- `src/components/standings/MobileStandings.tsx`
- `src/components/layout/AccountMenu.tsx`
- `src/components/search/GlobalSearch.tsx`
- `scripts/audit-media-assets.ts`
- `public/teams/*`

Exact boundaries may change during implementation, but the data ownership and acceptance criteria in this specification must remain intact.

## 18. Testing Strategy

### 18.1 Unit/component tests

- competition selection and invalid-season fallback;
- postseason/home-header state derivation;
- match-feed cursor encoding/decoding;
- grouping regular rounds and finals;
- tab keyboard interaction and ARIA state;
- biography expander semantics;
- account/follow button pressed state;
- media fallback state;
- Live Hub state selection;
- stat glossary coverage for displayed abbreviations.

### 18.2 API/integration tests

- match pagination limit clamp;
- invalid cursor response;
- play-by-play filters and pagination;
- user data authentication and isolation;
- favourite/reminder idempotency;
- season-scoped standings with multiple competitions;
- cache staleness boundaries;
- database-unavailable responses.

### 18.3 Browser tests

Required viewports:

- 1440 × 900;
- 1024 × 768;
- 390 × 844;
- 320 × 568.

Required flows:

1. Home → filter team → load earlier results → open match.
2. Match → open Play by Play → filter quarter/type → load older events.
3. Standings → change season → open team.
4. Live with no game → next fixture/reminder.
5. Signed out favourite → sign in callback → favourite saved.
6. Settings → follow/unfollow team → personalized home rail updates.
7. Keyboard-only navigation through all primary controls.

For each flow verify page identity, meaningful content, no framework overlay, no relevant console error, expected state transition, and screenshot evidence.

### 18.4 Performance verification

- Capture production-sized DOM count.
- Capture main-document TTFB and transfer size.
- Confirm event endpoint is absent before tab activation.
- Confirm chart chunk is absent until chart approaches/enters the selected loading boundary.
- Record Server-Timing query breakdown.
- Compare with the baseline in §2.

## 19. Rollout and Observability

### 19.1 Deployment sequence

1. Ship instrumentation and season-scoping tests.
2. Ship bounded homepage and Live Hub.
3. Ship cache wrappers.
4. Ship on-demand events and chart loading.
5. Ship responsive/media/accessibility polish.
6. Ship account discovery and personalization.
7. Observe at least one live round before considering Phase 4.

### 19.2 Feature flags

Use environment flags only for changes that need independent rollback:

- `FEATURE_HOME_FEED_V2`
- `FEATURE_MATCH_EVENTS_V2`
- `FEATURE_PERSONALIZED_HOME`

Do not leave completed flags permanently. Remove the old path and flag after the rollback window.

### 19.3 Monitoring

Track:

- route latency by surface;
- query timing by named operation;
- cache hit/miss where available;
- API error rate;
- worker poll duration/status;
- socket connection/reconnect count;
- media fallback count;
- sign-in callback failures;
- favourite/reminder mutation failures.

## 20. Definition of Done

The programme is complete when:

- all Phase 1–3 acceptance criteria pass;
- production homepage no longer renders the full season initially;
- standings/team records are season-correct;
- `/live` has a useful no-live state;
- play-by-play is fetched only when requested and is paginated;
- major accessibility risks named in this spec are corrected;
- desktop/mobile profile layouts are visually verified;
- all team/player media failures have legible fallbacks;
- account and personalization capabilities are discoverable and functional;
- performance results are recorded against the baseline;
- `npm run check` and `npm run build` pass;
- Graphify is refreshed with `graphify update .` after implementation changes;
- the Rust decision remains documented and evidence-gated;
- any deferred Phase 4 work has an explicit decision record rather than an implied commitment.

## 21. Implementation Principle

Optimise the work the system performs before changing the language it performs it in:

1. query less;
2. render less;
3. cache stable data;
4. defer optional data and code;
5. instrument the remaining latency;
6. isolate runtime ownership only when the measurements justify it;
7. consider Rust only when a proven CPU-bound boundary remains.
