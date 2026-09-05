# Mobile layout fix — progress

Branch: `candidate-quality-mobile-20260905`
Base (reviewed candidate-evidence commit): `6e58a415529f9d06b08da4a3be62158ad6cd77c6`

## Task

Fix the confirmed mobile layout bug at 390×844 (WebKit): `app-shell.tsx`
always reserves a `w-56` sidebar, squeezing `<main>` to ~166px and clipping
the population/incumbent `<select>` elements in `quality-strip.tsx`.
`document.scrollWidth` falsely stays 390 because `<main>` has
`overflow-auto`, which hides the real overflow inside its own scroll box.

Scope: `frontend/components/layout/{app-shell,nav-sidebar,quality-strip}.tsx`,
plus a small extracted reducer for the drawer state. No other worktree
edits, no push, no deploy, no data generation.

## State

- [x] Inspected `AGENTS.md`, `CLAUDE.md`, current code at the reviewed commit.
- [x] Reproduced the bug with an isolated WebKit session (`playwright-cli
      -s=mobilefix390`) against the running baseline server at
      `http://127.0.0.1:4392/calibration/dashboard/microcosm/quality`.
      Measured before the fix: `aside` width 224px, `main` width 166px,
      Population `<select>` right edge at x=639 in a 390px viewport (the
      `<select>` has no explicit `width`, so its native shrink-to-fit sizing
      ignores the squeezed container). Header (`site-nav`) was NOT
      overflowing (`scrollWidth` 390, GH icon at x=356–374) — no site-header
      change was needed for the confirmed bug.
- [x] Extracted `components/layout/nav-drawer.ts` — pure
      `navDrawerReducer(open, event)` state machine (`toggle` / `close` /
      `navigate` / `escape`) so the mobile drawer's open/close logic is
      unit-testable without a DOM. Added `nav-drawer.test.ts`.
- [x] `nav-sidebar.tsx`: added optional `onNavigate` callback, fired from
      both the country tab buttons and nav `<Link>`s, so a click inside the
      drawer collapses it immediately (not just on route-change effect).
- [x] `app-shell.tsx`: below `lg` the `<aside>` becomes an absolutely
      positioned off-canvas drawer (`-translate-x-full` ↔ `translate-x-0`)
      inside a `relative .app-viewport`, toggled by a `Menu`/`Close menu`
      button rendered at the top of `<main>` (`lg:hidden`). At `lg:` and up
      all the added classes collapse back to the original static `w-56`
      sidebar (`lg:static lg:translate-x-0 lg:w-56 lg:bg-card/50
      lg:shadow-none lg:transition-none`) — desktop markup/behavior
      unchanged. Backdrop reuses the existing `var(--scrim)` +
      `backdrop-blur-[2px]` pattern already used for the cluster-detail
      popup in `model-coverage-view.tsx` (a `<button aria-label="Close
      navigation">`, not a bare `<div>`, so it's keyboard-dismissible too).
      Escape key closes the drawer and returns focus to the toggle button;
      a route-change effect closes it as a safety net (covers cases outside
      `onNavigate`, e.g. back/forward). `<main>` gained `min-w-0` so its
      flex sizing can never again be forced wide by a child's intrinsic
      width (the root cause of the bug).
- [x] `quality-strip.tsx`: both `<select>`s gained `w-full` (so they fill
      their box instead of shrink-to-fit sizing to the widest option, which
      is what let long candidate IDs / manifest sha256 labels force
      overflow) plus `basis-full sm:basis-64 flex-1` on the wrapping
      `<label>` so they stack full-width below `sm` and sit side-by-side at
      `sm:` and up, same as before, capped by the existing `max-w-[440px]`
      / `max-w-[350px]`.
- [x] `bun install --frozen-lockfile` (worktree had no `node_modules`).
- [x] `bun run lint` (tsc --noEmit): clean.
- [x] `bun test`: 362 pass / 0 fail (including the 3 new `nav-drawer.test.ts`
      cases), no changes to any other test.
- [x] `bun run build` (`next build`): clean, same route list as before.
- [x] Re-verified visually in an isolated WebKit session (`-s=mobilefixnew`)
      against `bun run dev` in *this* worktree (port 3000; the 4392 baseline
      server serves a different worktree's build and was left untouched and
      running throughout — its cwd is `_worktrees/calibration-candidate-quality-20260905`,
      not this one, and it doesn't hot-reload since it's `next start`, not
      `next dev`).
      - 390×844: `main` is full 390px wide, both `<select>`s fit inside the
        viewport (right edges at 366px), `document.documentElement.scrollWidth`
        stays 390 (now honestly, not by masking).
      - Menu button toggles `aria-expanded` true/false and slides the drawer
        in (`nav-drawer` at x=0, 256px wide, scrim button present).
      - Escape closes the drawer and returns focus to the Menu button.
      - Clicking a nav `<Link>` (Calibration fit) and clicking a country tab
        (UK) both navigate and immediately close the drawer.
      - 820×1180 (tablet portrait): drawer/Menu pattern still applies (below
        `lg`), selects sit side by side via `sm:basis-64`.
      - 1280×900 (desktop): `aside` is back to static 224px (`w-56`), `main`
        is 1056px, Menu button's wrapper is `display:none` — pixel-identical
        to the pre-change desktop layout.
      - Unrelated: switching to UK logged 502s from
        `/api/microcosm/releases?country=uk` etc. — this sandbox has no
        upstream data backend configured; unrelated to the layout fix
        (confirmed by seeing the same 502s independent of drawer state).
- [x] Cleaned up scratch (`.playwright-cli/`, `.next/`, temp screenshots,
      the verification dev server) and reverted the incidentally-regenerated
      `next-env.d.ts` (unrelated `next dev` artifact, not part of this fix).
- [x] Wrote the implementation receipt (see chat "Implementation receipt" —
      exact diff SHA recorded at commit time below).
- [x] Committed.

Final commit: see `git log -1` in this worktree — one commit containing the
three modified layout files, the new `nav-drawer.ts`/`nav-drawer.test.ts`,
and this PROGRESS.md.
