#!/usr/bin/env node
// Does the receipt graph's inspector selection still survive a real production
// page?
//
// This is a browser regression, not a unit test, and it is written that way on
// purpose. The defect it exists for was invisible to every unit test: the view
// called `router.replace` with a correct absolute URL, and on a *prefetched
// production route* Next's segment cache answered from a stored canonical URL
// and the query never changed. A test that asserts "the component calls
// history.replaceState" would pass against the broken code and against a future
// break for the same reason — it asserts the implementation, not the effect. So
// this drives the actual production build, in a real browser, with prefetch
// left on, and asserts what a reader sees: the URL, the inspector, the history
// stack and the immutable candidate identity.
//
// Real WebKit through `playwright-core`. No Chrome, no CDP, no remote debugging
// port. Nothing here mutates the app, the candidate evidence or any server.
//
// Everything specific to a candidate lives in a fixture file, so pointing this
// at a different immutable candidate is a fixture, not an edit. See README.md.

import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_FIXTURE = path.join(
  HERE,
  "fixtures",
  "us-graph-f001-geography-20260905-v1.json",
);
const DEFAULT_BASE_URL = "http://127.0.0.1:3000/calibration/dashboard";
const DEFAULT_OUT_DIR = path.resolve(HERE, "../../test-results");
const OUTPUT_PREFIX = "calibration-graph-generic-followup";

/** Something the operator can fix: a bad flag, a missing fixture, an
 * unresolvable browser. Reported as one line, because a stack trace for a typo
 * buries the sentence that says what to do. */
class HarnessError extends Error {}

/* ----------------------------------------------------------- configuration */

function parseArguments(argv) {
  const options = {};
  const named = new Map([
    ["--base-url", "baseUrl"],
    ["--fixture", "fixture"],
    ["--out", "outDir"],
    ["--playwright-core", "playwrightCore"],
    ["--settle-ms", "settleMs"],
    ["--timeout-ms", "timeoutMs"],
  ]);
  for (let index = 0; index < argv.length; index++) {
    const argument = argv[index];
    if (argument === "--help" || argument === "-h") {
      options.help = true;
      continue;
    }
    const [flag, inline] = argument.includes("=")
      ? [argument.slice(0, argument.indexOf("=")), argument.slice(argument.indexOf("=") + 1)]
      : [argument, undefined];
    const key = named.get(flag);
    if (!key) throw new HarnessError(`Unknown argument ${argument}. Run with --help.`);
    const value = inline ?? argv[++index];
    if (value === undefined) throw new HarnessError(`${flag} needs a value.`);
    options[key] = value;
  }
  return options;
}

const USAGE = `Receipt graph production selection regression (real WebKit).

  node scripts/${path.basename(HERE)}/selection-regression.mjs [options]

  --base-url <url>          Mounted dashboard base of a running server.
                            Default ${DEFAULT_BASE_URL}
                            (env GRAPH_SELECTION_BASE_URL)
  --fixture <path>          Candidate fixture JSON. Default the checked-in
                            us-graph-f001-geography-20260905-v1.json
                            (env GRAPH_SELECTION_FIXTURE)
  --out <dir>               Where the receipt JSON is written.
                            Default frontend/test-results
                            (env GRAPH_SELECTION_OUT_DIR)
  --playwright-core <path>  A playwright-core package directory, or a directory
                            containing node_modules/playwright-core. Default
                            ordinary resolution from this script.
                            (env GRAPH_SELECTION_PLAYWRIGHT_CORE)
  --settle-ms <n>           Render settle after each URL change. Default 250.
                            (env GRAPH_SELECTION_SETTLE_MS)
  --timeout-ms <n>          Per-wait timeout. Default 15000.
                            (env GRAPH_SELECTION_TIMEOUT_MS)

The server must already be running and serving real candidate evidence; this
script starts nothing and changes nothing.`;

function integer(value, name, fallback) {
  if (value === undefined || value === "") return fallback;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 0)
    throw new HarnessError(`${name} must be a non-negative integer.`);
  return parsed;
}

function resolveConfig(argv, env) {
  const options = parseArguments(argv);
  if (options.help) return { help: true };
  const baseUrl = (options.baseUrl ?? env.GRAPH_SELECTION_BASE_URL ?? DEFAULT_BASE_URL).trim();
  let base;
  try {
    base = new URL(baseUrl);
  } catch {
    throw new HarnessError(`--base-url must be an absolute URL, got ${baseUrl}`);
  }
  if (!/^https?:$/.test(base.protocol))
    throw new HarnessError("--base-url must be http(s).");
  return {
    // One trailing-slash spelling, so joining a fixture path is unambiguous.
    baseUrl: base.href.replace(/\/+$/, ""),
    fixturePath: path.resolve(
      (options.fixture ?? env.GRAPH_SELECTION_FIXTURE ?? DEFAULT_FIXTURE).trim(),
    ),
    outDir: path.resolve(
      (options.outDir ?? env.GRAPH_SELECTION_OUT_DIR ?? DEFAULT_OUT_DIR).trim(),
    ),
    playwrightCore: (options.playwrightCore ?? env.GRAPH_SELECTION_PLAYWRIGHT_CORE ?? "").trim(),
    settleMs: integer(options.settleMs ?? env.GRAPH_SELECTION_SETTLE_MS, "--settle-ms", 250),
    timeoutMs: integer(options.timeoutMs ?? env.GRAPH_SELECTION_TIMEOUT_MS, "--timeout-ms", 15_000),
  };
}

/* ---------------------------------------------------------------- fixtures */

function requireString(value, field) {
  if (typeof value !== "string" || !value.trim())
    throw new HarnessError(`Fixture field ${field} must be a non-empty string.`);
  return value;
}

function readFixture(fixturePath) {
  if (!existsSync(fixturePath))
    throw new HarnessError(`No fixture at ${fixturePath}.`);
  const raw = JSON.parse(readFileSync(fixturePath, "utf8"));
  // A control the harness clicks: how to find it, and a phrase only its own
  // result renders. `node_id` is required wherever the selection it makes is
  // read back out of the URL.
  const control = (value, field) => ({
    name: value?.name === undefined ? null : requireString(value.name, `${field}.name`),
    exactName: Boolean(value?.exact_name),
    inspectorText: requireString(value?.inspector_text, `${field}.inspector_text`),
  });
  const step = (value, field) => ({
    ...control(value, field),
    nodeId: requireString(value?.node_id, `${field}.node_id`),
  });
  const fixture = {
    id: requireString(raw.id, "id"),
    description: typeof raw.description === "string" ? raw.description : "",
    country: requireString(raw.country, "country"),
    candidate: requireString(raw.candidate, "candidate"),
    manifestSha256: requireString(raw.manifest_sha256, "manifest_sha256"),
    incumbent: requireString(raw.incumbent, "incumbent"),
    // A fragment is optional; when present it is part of the identity that has
    // to survive every selection change.
    fragment: typeof raw.fragment === "string" ? raw.fragment : "",
    entryPath: requireString(raw.entry_path, "entry_path"),
    graphPath: requireString(raw.graph_path, "graph_path"),
    listStep: step(raw.list_step, "list_step"),
    // The replay control selects an execution, not a step, so it names a mode
    // rather than a node id.
    replay: {
      ...control(raw.replay, "replay"),
      mode: requireString(raw.replay?.mode, "replay.mode"),
    },
    canvasNode: step(raw.canvas_node, "canvas_node"),
  };
  if (!/^[a-f0-9]{64}$/.test(fixture.manifestSha256))
    throw new HarnessError("Fixture manifest_sha256 must be 64 lowercase hex characters.");
  if (!fixture.listStep.name)
    throw new HarnessError("Fixture list_step.name must name the step's accessible button.");
  if (!fixture.replay.name)
    throw new HarnessError("Fixture replay.name must name the execution's accessible button.");
  if (fixture.fragment && !fixture.fragment.startsWith("#"))
    throw new HarnessError("Fixture fragment must start with #.");
  return fixture;
}

/* -------------------------------------------------------- playwright-core */

/** Resolve the already-installed playwright-core rather than adding a browser
 * automation dependency to this app's lockfile. A configured path may point at
 * the package directory itself or at any directory holding node_modules. */
function loadWebkit(configured) {
  const require = createRequire(import.meta.url);
  let manifestPath;
  try {
    if (!configured) {
      manifestPath = require.resolve("playwright-core/package.json");
    } else {
      const root = path.resolve(configured);
      const direct = path.join(root, "package.json");
      manifestPath = existsSync(direct)
        ? direct
        : require.resolve("playwright-core/package.json", { paths: [root] });
    }
  } catch (error) {
    throw new HarnessError(
      `Could not resolve playwright-core${configured ? ` from ${configured}` : ""}. ` +
        "Point --playwright-core (or GRAPH_SELECTION_PLAYWRIGHT_CORE) at an installed " +
        `copy. Underlying error: ${error.message}`,
    );
  }
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
  if (manifest.name !== "playwright-core")
    throw new HarnessError(`${manifestPath} is ${manifest.name}, not playwright-core.`);
  const packageDir = path.dirname(manifestPath);
  const { webkit } = require(path.join(packageDir, "index.js"));
  if (!webkit)
    throw new HarnessError(`${packageDir} exports no webkit launcher.`);
  return { webkit, version: manifest.version, packageDir };
}

/* ------------------------------------------------------------------ checks */

function selectionUrl(config, fixture, extra = {}) {
  const url = new URL(`${config.baseUrl}${fixture.graphPath}`);
  url.searchParams.set("country", fixture.country);
  url.searchParams.set("candidate", fixture.candidate);
  url.searchParams.set("manifest_sha256", fixture.manifestSha256);
  url.searchParams.set("incumbent", fixture.incumbent);
  for (const [key, value] of Object.entries(extra)) url.searchParams.set(key, value);
  return `${url.toString()}${fixture.fragment}`;
}

function entryUrl(config, fixture) {
  const url = new URL(`${config.baseUrl}${fixture.entryPath}`);
  url.searchParams.set("country", fixture.country);
  url.searchParams.set("candidate", fixture.candidate);
  url.searchParams.set("manifest_sha256", fixture.manifestSha256);
  return url.toString();
}

async function run(config) {
  const fixture = readFixture(config.fixturePath);
  const { webkit, version, packageDir } = loadWebkit(config.playwrightCore);
  const graphUrl = selectionUrl(config, fixture);
  const previousUrl = entryUrl(config, fixture);

  console.log(`fixture      ${fixture.id} (${config.fixturePath})`);
  console.log(`base url     ${config.baseUrl}`);
  console.log(`browser      WebKit via playwright-core ${version}`);
  console.log(`             ${packageDir}`);
  console.log(`output       ${config.outDir}`);
  console.log("");

  const results = [];
  const errors = [];
  const failedRequests = [];
  let phase = "initial";

  const browser = await webkit.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 1100 } });
  page.setDefaultTimeout(config.timeoutMs);
  page.on("pageerror", (error) =>
    errors.push({ phase, url: page.url(), message: error.message }),
  );
  page.on("requestfailed", (request) =>
    failedRequests.push({
      phase,
      url: request.url(),
      failure: request.failure()?.errorText ?? null,
    }),
  );

  const check = (name, condition) => {
    const ok = Boolean(condition);
    results.push({ name, phase, ok });
    console.log(`${ok ? "pass" : "FAIL"} ${name}`);
    assert.ok(ok, name);
  };
  const params = () => new URL(page.url()).searchParams;
  const body = () => page.locator("body").innerText();
  // Wait for the URL the interaction should produce, then let React paint. The
  // wait never decides a check: on timeout it falls through and the assertion
  // below reports what the page actually holds.
  const settle = async (expectation) => {
    if (expectation)
      await page
        .waitForFunction(
          (want) => {
            const search = new URL(window.location.href).searchParams;
            if (want.kind === "absent") return !search.has(want.param);
            if (want.kind === "changed")
              return Boolean(search.get(want.param)) && search.get(want.param) !== want.from;
            return search.get(want.param) === want.value;
          },
          expectation,
          { timeout: config.timeoutMs },
        )
        .catch(() => {});
    await page.waitForTimeout(config.settleMs);
  };

  /** The whole immutable selection, unchanged. Every inspector interaction is
   * checked against this: a view-local selection must never rewrite, drop or
   * swap the candidate a reader is looking at. */
  const identityHolds = () => {
    const url = new URL(page.url());
    const search = url.searchParams;
    return (
      url.pathname === new URL(`${config.baseUrl}${fixture.graphPath}`).pathname &&
      search.get("country") === fixture.country &&
      search.get("candidate") === fixture.candidate &&
      search.get("manifest_sha256") === fixture.manifestSha256 &&
      search.get("incumbent") === fixture.incumbent &&
      url.hash === fixture.fragment
    );
  };

  try {
    // Land on another dashboard page first, so Back has a real destination and
    // the production router has prefetched the graph route the way it does for
    // an ordinary reader. Prefetch is deliberately left enabled: it is the
    // condition the original defect needed.
    await page.goto(previousUrl, { waitUntil: "networkidle" });
    const previous = page.url();

    phase = "open graph";
    await page.goto(graphUrl, { waitUntil: "networkidle" });
    const step = page
      .getByRole("button", { name: fixture.listStep.name, exact: fixture.listStep.exactName })
      .first();
    await step.waitFor();
    await page.waitForTimeout(Math.max(config.settleMs, 800));
    const historyLength = await page.evaluate(() => history.length);

    phase = "list selection";
    await step.click();
    await settle({ kind: "equals", param: "node", value: fixture.listStep.nodeId });
    check(
      "list click changes the actual production URL",
      params().get("node") === fixture.listStep.nodeId,
    );
    check(
      "list click changes the inspector",
      (await body()).includes(fixture.listStep.inspectorText),
    );

    phase = "replay";
    await page
      .getByRole("button", { name: fixture.replay.name, exact: fixture.replay.exactName })
      .click();
    await settle({ kind: "equals", param: "execution", value: fixture.replay.mode });
    check(
      "replay changes URL and rendered execution",
      params().get("execution") === fixture.replay.mode &&
        (await body()).includes(fixture.replay.inspectorText),
    );
    check("all candidate identity and fragment fields survive", identityHolds());

    phase = "reload graph";
    await page.reload({ waitUntil: "networkidle" });
    await step.waitFor();
    await settle();
    check(
      "reload restores node and execution",
      params().get("node") === fixture.listStep.nodeId &&
        (await body()).includes(fixture.replay.inspectorText),
    );

    phase = "keyboard";
    await step.focus();
    await page.keyboard.press("ArrowDown");
    await settle({ kind: "changed", param: "node", from: fixture.listStep.nodeId });
    const keyboardNode = params().get("node");
    check(
      "arrow key changes selection and keeps focus on a step",
      Boolean(keyboardNode) &&
        keyboardNode !== fixture.listStep.nodeId &&
        (await page.evaluate(() => document.activeElement?.tagName === "BUTTON")),
    );
    await page.keyboard.press("Escape");
    await settle({ kind: "absent", param: "node" });
    check(
      "Escape clears only node selection",
      !params().has("node") &&
        params().get("execution") === fixture.replay.mode &&
        identityHolds(),
    );

    phase = "canvas";
    await page
      .locator(`.react-flow__node[data-id="${fixture.canvasNode.nodeId}"]`)
      .click();
    await settle({ kind: "equals", param: "node", value: fixture.canvasNode.nodeId });
    check(
      "canvas click selects the receipt its node names",
      params().get("node") === fixture.canvasNode.nodeId &&
        (await body()).includes(fixture.canvasNode.inspectorText),
    );
    check(
      "inspector changes do not add browser history entries",
      (await page.evaluate(() => history.length)) === historyLength,
    );

    phase = "back";
    await page.waitForLoadState("networkidle");
    await page.goBack({ waitUntil: "networkidle" });
    check("Back reaches the previous page", page.url() === previous);

    phase = "forward";
    await page.goForward({ waitUntil: "networkidle" });
    await step.waitFor();
    await settle({ kind: "equals", param: "node", value: fixture.canvasNode.nodeId });
    check(
      "Forward restores the final inspector state",
      params().get("node") === fixture.canvasNode.nodeId &&
        params().get("execution") === fixture.replay.mode &&
        identityHolds() &&
        (await body()).includes(fixture.canvasNode.inspectorText),
    );

    phase = "errors";
    check("no browser execution errors", errors.length === 0);
  } finally {
    const failed = results.filter((result) => !result.ok).length;
    await mkdir(config.outDir, { recursive: true });
    const receiptPath = path.join(
      config.outDir,
      `${OUTPUT_PREFIX}-selection-regression-${fixture.id}.json`,
    );
    if (failed || results.length === 0)
      await page
        .screenshot({
          path: path.join(
            config.outDir,
            `${OUTPUT_PREFIX}-selection-regression-${fixture.id}.png`,
          ),
          fullPage: true,
        })
        .catch(() => {});
    await writeFile(
      receiptPath,
      `${JSON.stringify(
        {
          harness: "calibration-graph-generic-followup/selection-regression.mjs",
          browser: { engine: "webkit", playwright_core: version, package_dir: packageDir },
          base_url: config.baseUrl,
          fixture: { id: fixture.id, path: config.fixturePath },
          graph_url: graphUrl,
          checks_passed: results.filter((result) => result.ok).length,
          checks_failed: failed,
          results,
          page_errors: errors,
          failed_requests: failedRequests,
        },
        null,
        2,
      )}\n`,
      "utf8",
    );
    console.log("");
    console.log(
      `${results.filter((result) => result.ok).length} passed, ${failed} failed, ` +
        `${errors.length} page errors, ${failedRequests.length} failed requests`,
    );
    console.log(`receipt      ${receiptPath}`);
    await browser.close();
  }
}

try {
  const config = resolveConfig(process.argv.slice(2), process.env);
  if (config.help) console.log(USAGE);
  else await run(config);
} catch (error) {
  const assertion = error instanceof Error && error.name === "AssertionError";
  console.error("");
  console.error(
    assertion
      ? `Check failed: ${error.message}`
      : (error instanceof Error ? error.message : String(error)),
  );
  // An unexpected failure is not the operator's typo, so keep its stack.
  if (!assertion && !(error instanceof HarnessError) && error instanceof Error)
    console.error(error.stack);
  process.exitCode = 1;
}
