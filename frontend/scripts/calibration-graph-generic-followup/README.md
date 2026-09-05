# Receipt graph production selection regression

A browser regression for the receipt graph's inspector selection, run against a
real production build in real WebKit.

## Why it is not a unit test

The defect this exists for was invisible to every unit test in the repo. The
view called `router.replace` with a correct absolute URL that preserved the
mount path and the whole immutable candidate identity. On a **prefetched
production route**, Next's segment cache answered the navigation from a stored
canonical URL and the query never changed: clicking a step did nothing. Reverting
`receipt-graph-view.tsx` to `router.replace` today still passes `bun test`.

A test that asserts "the component calls `history.replaceState`" would pass
against the broken code, and would pass again the next time the same class of
break happens, because it asserts the implementation rather than the effect. So
this drives the actual production build, in a real browser, with prefetch left
**on** — that is the condition the defect needed — and asserts what a reader
sees: the URL, the inspector, the history stack, and the immutable candidate
identity.

Real WebKit through `playwright-core`. No Chrome, no CDP, no remote debugging
port. The harness starts nothing, changes nothing and writes only its own
receipt.

## What it checks

Twelve checks, in one browser page, in this order:

1. list click changes the actual production URL
2. list click changes the inspector
3. replay changes URL and rendered execution
4. all candidate identity and fragment fields survive
5. reload restores node and execution
6. arrow key changes selection and keeps focus on a step
7. Escape clears only node selection
8. canvas click selects the receipt its node names
9. inspector changes do not add browser history entries
10. Back reaches the previous page
11. Forward restores the final inspector state
12. no browser execution errors

Page errors and failed requests are recorded on every check, whether or not they
are asserted on, and land in the receipt JSON.

## Setup

`playwright-core` is deliberately **not** a dependency of this app. It is not in
`package.json` and it is not resolvable from this repo; adding it would put a
browser automation stack and its lockfile entries into an app that never needs
one at runtime. Point the harness at an installed copy instead:

```sh
GRAPH_SELECTION_PLAYWRIGHT_CORE=/path/to/somewhere/node_modules/playwright-core
```

The value may be the `playwright-core` package directory itself, or any
directory that contains `node_modules/playwright-core`. The harness prints the
resolved version and directory and records both in its receipt, so a run always
says which browser build produced it rather than naming one in prose. Use the
copy whose version matches the WebKit revision already in
`~/Library/Caches/ms-playwright` — `playwright-core` ships no browser of its
own, and a different version resolves a different revision.

If you need one:

```sh
mkdir -p /tmp/graph-selection-browser && cd /tmp/graph-selection-browser
printf '{"name":"graph-selection-browser","private":true,"devDependencies":{"playwright-core":"1.58.0"}}' > package.json
bun install
```

## Running it

The harness needs a server that is already up and already serving genuine
candidate evidence. `next start` serves the production build, so build first:

```sh
cd frontend
bun run build
MICROCOSM_QUALITY_US_DIR=/absolute/path/to/candidate-quality \
  bun run start --hostname 127.0.0.1 --port 4487
```

Pick a port nothing else is on — other agents' servers on this machine are
long-lived, and `next start` will fail rather than share one. Then, from
`frontend/`:

```sh
GRAPH_SELECTION_PLAYWRIGHT_CORE=/path/to/node_modules/playwright-core \
  bun run verify:graph-selection -- --base-url http://127.0.0.1:4487/calibration/dashboard
```

Every option has a flag and an environment variable:

| Flag | Variable | Default |
| --- | --- | --- |
| `--base-url` | `GRAPH_SELECTION_BASE_URL` | `http://127.0.0.1:3000/calibration/dashboard` |
| `--fixture` | `GRAPH_SELECTION_FIXTURE` | `fixtures/us-graph-f001-geography-20260905-v1.json` |
| `--out` | `GRAPH_SELECTION_OUT_DIR` | `frontend/test-results` |
| `--playwright-core` | `GRAPH_SELECTION_PLAYWRIGHT_CORE` | ordinary module resolution |
| `--settle-ms` | `GRAPH_SELECTION_SETTLE_MS` | `250` |
| `--timeout-ms` | `GRAPH_SELECTION_TIMEOUT_MS` | `15000` |

`--base-url` carries the mount path, so a deployment with a different
`NEXT_PUBLIC_BASE_PATH`, or none, needs no edit here: the identity check derives
the expected pathname from the same value.

The receipt is written to
`<out>/calibration-graph-generic-followup-selection-regression-<fixture id>.json`
whether the run passes or fails, and a full-page screenshot is written beside it
when a check fails. The default output directory is git-ignored. Both are
operator diagnostics on a local machine: the receipt records the resolved
`playwright-core` path and every request URL the page issued, so do not paste it
somewhere it would be published.

The process exits non-zero on the first failed check.

## Fixtures

Everything specific to a candidate is a fixture, so pointing this at a different
immutable candidate is a file, not an edit:

```json
{
  "id": "…", "country": "us", "candidate": "…", "manifest_sha256": "…",
  "incumbent": "unchanged", "fragment": "#support",
  "entry_path": "/microcosm/quality", "graph_path": "/microcosm/pipeline",
  "list_step":   { "name": "…", "node_id": "…", "inspector_text": "…" },
  "replay":      { "name": "…", "exact_name": true, "mode": "…",
                   "inspector_text": "…" },
  "canvas_node": { "node_id": "…", "inspector_text": "…" }
}
```

`name` is an accessible button name — matched case-insensitively as a substring
unless `exact_name` is true. `inspector_text` is a phrase the inspector renders
only for that selection; choosing one that any selection renders turns its check
into a no-op. `node_id` is the run's own node id, which is also the canvas
element's `data-id`; the replay block selects an execution rather than a step,
so it names a `mode` instead. Fixtures describe a candidate the server is already
configured to serve; the harness cannot register one.

## Not covered here

- One candidate per run. Comparing two candidates is a separate concern.
- The candidate selector at `quality-context.tsx` still navigates through the
  router. Whether it meets the same prefetched-route cache behaviour was never
  assessed, here or anywhere else.
- Nothing about the correctness of the receipts themselves. That is
  `lib/microcosm/graph/adapter.test.ts` and `app/api/microcosm/graph/route.test.ts`.
- This is not wired into `make test` or GitHub CI. Both run without a server or
  a browser, and neither should start one.
