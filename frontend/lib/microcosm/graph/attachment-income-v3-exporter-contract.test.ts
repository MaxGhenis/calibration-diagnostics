// The reader, read against bytes it did not write.
//
// `attachment-income-v3.test.ts` checks the reader against `invented-income-v3.ts`,
// and both are written by hand on this side. That pairing cannot catch the one
// failure that actually happened: the reader and its fixture agreed with each
// other on a price series the exporter never converted with, and every test
// passed. A fixture written on the reader's own side is a restatement of the
// reader, not a check on it.
//
// These tests read the bytes the corrected exporter itself wrote, committed
// under `fixtures/income-v3-exporter-written/`. Invented data, real schema:
// nothing here describes a population, an ASEC record or a model output, and no
// genuine export exists to read.
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { join } from "node:path";
import { buildReceiptGraph, ReceiptGraphUnavailableError } from "./adapter";
import { normalizeGraphAttachment } from "./attachment";
import { inventedIncomeV3 } from "./fixtures/invented-income-v3";
import type { CandidateQualityManifest } from "../quality/types";

const DIRECTORY = join(import.meta.dir, "fixtures/income-v3-exporter-written");
const SOURCE = join(import.meta.dir, "attachment.ts");

/** The digests these files were committed under. The exporter names every file
 * it writes after its own sha256, so a file whose content no longer hashes to
 * its own name has been edited since -- which would make every test below a
 * test of an edit rather than of the exporter. */
const WRITTEN = {
  manifest: "c9ec679f93cc0f30953edf78d0915f4c7c945dfd58a0c1072c669f83030a22b7",
  graph: "44f09ca7d226913b443d1dbe7a10424d82fdd01f2dbec0050f31d646e1b404c7",
  build: "7a33f6dfb627ece3cf06aba0757b8998d8919447777accd85aa068e395cadf07",
} as const;

const bytesOf = (path: string) => readFileSync(join(DIRECTORY, path));
const read = (path: string) => JSON.parse(bytesOf(path).toString("utf8"));
const sha256 = (bytes: Buffer) => createHash("sha256").update(bytes).digest("hex");

type Written = {
  manifest: CandidateQualityManifest;
  manifestSha: string;
  graph: Record<string, any>;
  build: Record<string, any>;
};

/** One freshly parsed copy per call, so a mutation in one case cannot leak into
 * another. The manifest gains an explicit `geography: null`: the exporter omits
 * the key entirely, and the app's own manifest parser normalises an absent
 * geography to null before the reader ever sees it (`quality/artifact.ts`,
 * `if (raw.geography != null)`). Adding it here is that normalisation, not a
 * repair of the export. */
function written(): Written {
  const index = read("index.json");
  const entry = index.candidates[0];
  const manifest = { geography: null, ...read(entry.manifest.path) };
  return {
    manifest: manifest as CandidateQualityManifest,
    manifestSha: entry.manifest.sha256,
    graph: read(manifest.attachments.graph_receipts.path),
    build: read(manifest.attachments.build_manifest.path),
  };
}

const verify = (w: Written) =>
  normalizeGraphAttachment(w.graph, w.manifest, w.manifestSha, w.build);

describe("the committed bytes are the ones the exporter wrote", () => {
  test("every file is still self-addressed by its own name", () => {
    expect(sha256(bytesOf(`manifests/${WRITTEN.manifest}.json`))).toBe(WRITTEN.manifest);
    expect(sha256(bytesOf(`artifacts/${WRITTEN.graph}.json`))).toBe(WRITTEN.graph);
    expect(sha256(bytesOf(`artifacts/${WRITTEN.build}.json`))).toBe(WRITTEN.build);
  });

  test("the index this side writes only repeats the manifest's own fields", () => {
    const index = read("index.json");
    const manifest = read(`manifests/${WRITTEN.manifest}.json`);
    const entry = index.candidates[0];
    expect(index.candidates).toHaveLength(1);
    expect(entry.candidate_release_id).toBe(manifest.candidate_release_id);
    expect(entry.run_id).toBe(manifest.run_id);
    expect(entry.execution_status).toBe(manifest.execution_status);
    expect(entry.release_eligibility).toEqual(manifest.release_eligibility);
    expect(entry.manifest).toEqual({
      path: `manifests/${WRITTEN.manifest}.json`,
      sha256: WRITTEN.manifest,
    });
  });

  test("the candidate says in its own id and reason that it is invented", () => {
    const manifest = read(`manifests/${WRITTEN.manifest}.json`);
    expect(manifest.candidate_release_id).toContain("invented");
    expect(manifest.release_eligibility.status).toBe("excluded");
    expect(manifest.release_eligibility.reason.toLowerCase()).toContain("invented");
  });
});

describe("the reader accepts what the exporter publishes", () => {
  test("the exporter's own bytes read end to end and draw the profile", () => {
    const w = written();
    const { projection, checks } = verify(w);
    const payload = buildReceiptGraph(projection, w.manifest, w.build, checks);
    expect(payload.evidence_profile).toBeDefined();
    expect(payload.evidence_profile!.id).toBe("us_asec_income_v3_five_node_15hh");
  });

  test("the drawn profile carries the exporter's values, not this side's", () => {
    const profile = verify(written()).projection.evidence_profile!;
    const graph = written().graph;
    // Scope and quality are passed through as published. The accounting is a
    // reading -- it splits the arithmetic into statements and renames the
    // column roster -- so its published members are compared one by one rather
    // than as a whole object, which would only be comparing the reading to
    // itself.
    expect(profile.scope).toEqual(graph.scope);
    expect(profile.quality).toEqual(graph.quality);
    const accounting = profile.reported_income;
    expect(accounting.basis).toEqual(graph.reported_income.basis);
    expect(accounting.not_claimed).toEqual(graph.reported_income.not_claimed);
    expect(accounting.rows).toBe(graph.reported_income.rows);
    expect(accounting.accounting_row_bytes).toBe(graph.reported_income.accounting_row_bytes);
    expect(accounting.arithmetic_order).toBe(graph.reported_income.arithmetic_order);
    expect(accounting.columns).toEqual(graph.reported_income.accounting_columns);
    // The reading folds each result column's digest together with its own
    // signed composition. Both halves are checked against what was published,
    // so a column cannot pick up another column's counts on the way through.
    expect(
      accounting.results.map((r) => ({
        column: r.column,
        negative: r.negative,
        positive: r.positive,
        zero: r.zero,
      })),
    ).toEqual(graph.reported_income.signed_value_counts);
    expect(accounting.results.map((r) => ({ column: r.column, sha256: r.sha256 }))).toEqual(
      graph.reported_income.result_column_sha256,
    );
    // Zero-origin classes are drawn per source year. The reading adds a total,
    // which must be the sum of the classes it was given and never a restated
    // person count: the exporter bounds the signed classes to the 52 accounted
    // people but publishes no bound on these.
    expect(
      accounting.zero_origin.map((year) => ({
        income_year: year.income_year,
        ...Object.fromEntries(year.classes.map((c) => [c.key, c.count])),
      })),
    ).toEqual(graph.reported_income.zero_origin_class_counts);
    for (const year of accounting.zero_origin)
      expect(year.total).toBe(year.classes.reduce((sum, c) => sum + c.count, 0));
    // The reading adds the arithmetic as separate statements; it may not add a
    // seventh, and each must come from the published string.
    expect(accounting.arithmetic_statements).toEqual(
      graph.reported_income.arithmetic_order.split(";"),
    );
  });
});

// Everything below compares the hand-written fixture against the exporter's
// bytes. Where they disagree the exporter is right by definition, so each of
// these is a standing check that the hand-written fixture has not drifted.
describe("the hand-written fixture agrees with the exporter's schema", () => {
  const exported = written();
  const invented = inventedIncomeV3();
  const inventedGraphOf = invented.graph as Record<string, any>;
  const inventedBuildOf = invented.build as Record<string, any>;
  const keys = (value: object) => Object.keys(value).sort();

  test("both publish the same profile id", () => {
    expect(inventedGraphOf.profile).toBe(exported.graph.profile);
    expect(inventedBuildOf.profile).toBe(exported.build.profile);
  });

  test("both graphs publish the same field set", () => {
    expect(keys(inventedGraphOf)).toEqual(keys(exported.graph));
  });

  test("both build summaries publish the same field set", () => {
    expect(keys(inventedBuildOf)).toEqual(keys(exported.build));
    for (const mode of ["direct", "cold", "warm"])
      expect(keys(inventedBuildOf.checks[mode])).toEqual(keys(exported.build.checks[mode]));
  });

  test("both scopes publish the same field set and the same corrected sentence", () => {
    expect(keys(inventedGraphOf.scope)).toEqual(keys(exported.graph.scope));
    // The prose the exporter was corrected to write. A fifteen-household draw
    // is a sample; what it is not is large enough to establish anything.
    expect(exported.graph.scope.note).toBe(
      "Fifteen sampled households from three source cohorts. This small engineering sample does not establish population accuracy.",
    );
    expect(inventedGraphOf.scope.note).toContain(
      "This small engineering sample does not establish population accuracy.",
    );
    expect(inventedGraphOf.scope.note).not.toContain("not a sample of any population");
  });

  test("both publish the same nine-item quality roster, without prior_wages", () => {
    expect(keys(inventedGraphOf.quality)).toEqual(keys(exported.graph.quality));
    expect(exported.graph.quality.missing).toHaveLength(9);
    expect(exported.graph.quality.missing).not.toContain("prior_wages");
    expect(inventedGraphOf.quality.missing).toEqual(exported.graph.quality.missing);
    expect(inventedGraphOf.quality.status).toBe(exported.graph.quality.status);
    expect(inventedGraphOf.quality.basis).toBe(exported.graph.quality.basis);
    expect(inventedGraphOf.quality.score).toBe(null);
    expect(exported.graph.quality.score).toBe(null);
  });

  test("prior_wages is withheld rather than unmeasured, in both", () => {
    expect(exported.graph.reported_income.not_claimed).toContain("prior_wages");
    expect(inventedGraphOf.reported_income.not_claimed).toEqual(
      exported.graph.reported_income.not_claimed,
    );
  });

  test("both publish the same three price fields, and no fourth", () => {
    const basis = exported.graph.reported_income.basis;
    expect(keys(basis)).toEqual(keys(inventedGraphOf.reported_income.basis));
    // The removed field, by name: `price_target` is gone from the contract, not
    // renamed alongside a survivor.
    expect(Object.hasOwn(basis, "price_target")).toBe(false);
    expect(basis.price_basis).toBe("census_ccpiu_annual_2024");
    expect(basis.price_target_year).toBe("2024");
    expect(basis.price_basis_resource_sha256).toBe(
      "88cec207a3c73e5de93d677acf16e8db9ddae9761c644c06da92cacf0feb3f63",
    );
    for (const field of ["price_basis", "price_target_year", "price_basis_resource_sha256"] as const)
      expect(inventedGraphOf.reported_income.basis[field]).toBe(basis[field]);
    expect(JSON.stringify(exported.graph)).not.toMatch(/cpi_u_rs/i);
  });

  test("both publish the producer's real twenty-eight column names, in order", () => {
    const exportedColumns = exported.graph.reported_income.accounting_columns;
    const inventedColumns = inventedGraphOf.reported_income.accounting_columns;
    expect(exportedColumns).toHaveLength(28);
    // The name that made this necessary. It is a schema label, and the reader's
    // publisher-text check refuses it as a value.
    expect(exportedColumns[0].name).toBe("person_id");
    expect(inventedColumns.map((c: any) => c.name)).toEqual(
      exportedColumns.map((c: any) => c.name),
    );
    expect(inventedColumns.map((c: any) => c.dtype)).toEqual(
      exportedColumns.map((c: any) => c.dtype),
    );
    // Names and widths are shared schema; digests are not, and must not be.
    expect(inventedColumns.map((c: any) => c.sha256)).not.toEqual(
      exportedColumns.map((c: any) => c.sha256),
    );
    for (const column of exportedColumns) expect(keys(column)).toEqual(["dtype", "name", "sha256"]);
  });

  test("both publish the same accounting arithmetic and totals", () => {
    const e = exported.graph.reported_income;
    const i = inventedGraphOf.reported_income;
    expect(keys(i)).toEqual(keys(e));
    expect(i.arithmetic_order).toBe(e.arithmetic_order);
    expect(i.accounting_row_bytes).toBe(e.accounting_row_bytes);
    expect(e.accounting_row_bytes).toBe(91);
    expect(i.accounting_column_count).toBe(e.accounting_column_count);
    expect(i.rows).toBe(e.rows);
    // The exporter's contract accounts exactly this many people, and the
    // zero-origin classes are a per-person-per-year classification of them.
    expect(e.rows).toBe(52);
    expect(i.result_column_sha256.map((r: any) => r.column)).toEqual(
      e.result_column_sha256.map((r: any) => r.column),
    );
    expect(keys(i.signed_value_counts[0])).toEqual(keys(e.signed_value_counts[0]));
    expect(keys(i.zero_origin_class_counts[0])).toEqual(keys(e.zero_origin_class_counts[0]));
  });

  test("both record the same node roster and the same permitted producers", () => {
    const roster = (source: Record<string, any>) =>
      source.executions[0].nodes.map((n: any) => n.id);
    expect(roster(inventedGraphOf)).toEqual(roster(exported.graph));
    const producers = (source: Record<string, any>) =>
      Object.fromEntries(
        source.executions[0].nodes.map((n: any) => [
          n.id,
          [...new Set(n.typed_inputs.map((a: any) => a.producer))].sort(),
        ]),
      );
    expect(producers(inventedGraphOf)).toEqual(producers(exported.graph));
    // The rule the exporter added, stated as an observation about its own bytes.
    expect(producers(exported.graph)["asec_prepared.reported_income"]).not.toContain(
      "asec_prepared.engine_current_money",
    );
  });
});

/** Which check refused, not merely that one did.
 *
 * `refuse()` throws one message for every refusal, so "it threw" says nothing
 * about where. This walks the thrown stack for the frames inside
 * `attachment.ts`, innermost first, dropping only `refuse` and `assert` --
 * the two every refusal passes through, which therefore carry no information.
 * What is left is the chain of checks the value actually travelled through, and
 * each is read back out of the source so a case pins the raising line's text as
 * well as its name. Text survives the file being edited above it; a line number
 * would not. */
const GENERIC = new Set(["refuse", "assert"]);
const SOURCE_LINES = readFileSync(SOURCE, "utf8").split("\n");

function reachedBy(mutate: (w: Written) => void): { check: string; line: string }[] {
  const w = written();
  mutate(w);
  let error: unknown;
  try {
    verify(w);
  } catch (thrown) {
    error = thrown;
  }
  expect(error).toBeInstanceOf(ReceiptGraphUnavailableError);
  const chain = ((error as Error).stack ?? "")
    .split("\n")
    .map((raw) => /^\s*at (\S+) .*attachment\.ts:(\d+):\d+/.exec(raw))
    .filter((match): match is RegExpExecArray => match !== null)
    .map((match) => ({ check: match[1], line: SOURCE_LINES[Number(match[2]) - 1].trim() }))
    .filter((frame) => !GENERIC.has(frame.check));
  expect(chain.length).toBeGreaterThan(0);
  return chain;
}

describe("each mutation reaches the check it is aimed at", () => {
  // The control. Without it, a harness that refused everything -- or that had
  // stopped reading the profile at all -- would pass every case below.
  test("the unmutated export is accepted", () => {
    expect(() => verify(written())).not.toThrow();
  });

  // Each case names the innermost checks the value must travel through, in
  // order, and the text of the line that actually raised. Both halves matter: a
  // chain alone would accept a refusal from the right block for the wrong
  // reason, and a line alone would not say which block it belonged to.
  const cases: [string, string[], RegExp, (w: Written) => void][] = [
    [
      "a false claim: quality declared complete",
      ["oneOf", "shape", "incomeQuality"],
      /assert\(values\.includes\(value\)\)/,
      (w) => { w.graph.quality.status = "complete"; },
    ],
    [
      "a false claim: a quality score where the contract publishes none",
      ["oneOf", "shape", "incomeQuality"],
      /assert\(values\.includes\(value\)\)/,
      (w) => { w.graph.quality.score = 0.94; },
    ],
    [
      "a false claim: prior_wages put back among the unmeasured",
      ["exactRoster", "shape", "incomeQuality"],
      /assert\(Array\.isArray\(value\) && value\.length === expected\.length\)/,
      (w) => { w.graph.quality.missing.push("prior_wages"); },
    ],
    [
      "a false claim: prior_wages swapped in for a real gap",
      ["exactRoster", "shape", "incomeQuality"],
      /equal\(entry, expected\[index\]\)/,
      (w) => { w.graph.quality.missing[0] = "prior_wages"; },
    ],
    [
      "a bad price: the wrong series this profile once published",
      ["priceBasisSeries", "shape", "basis"],
      /INCOME_V3\.basis\.price_basis\b/,
      (w) => { w.graph.reported_income.basis.price_basis = "cpi_u_rs_2024_price_target_year"; },
    ],
    [
      "a bad price: a different target year",
      ["priceTargetYear", "shape", "basis"],
      /INCOME_V3\.basis\.price_target_year/,
      (w) => { w.graph.reported_income.basis.price_target_year = "2023"; },
    ],
    [
      "a bad hash: a contract digest the accounting node never recorded",
      ["priceBasisResourceDigest", "shape", "basis"],
      /INCOME_V3\.basis\.price_basis_resource_sha256/,
      (w) => { w.graph.reported_income.basis.price_basis_resource_sha256 = "a".repeat(64); },
    ],
    [
      "a bad hash: a price basis digest that is not a digest",
      ["digest", "priceBasisResourceDigest", "shape", "basis"],
      /HEX\.test\(value\)/,
      (w) => { w.graph.reported_income.basis.price_basis_resource_sha256 = "census_ccpiu_annual_2024"; },
    ],
    [
      "unsafe prose: a per-person identifier in the publisher's note",
      ["text", "shape", "incomeScope"],
      /TEXT_MARKERS/,
      (w) => { w.graph.scope.note = "Fifteen households. Row person_id 41 drove the residual."; },
    ],
    [
      "unsafe prose: a local path in the publisher's note",
      ["text", "shape", "incomeScope"],
      /x00-/,
      (w) => { w.graph.scope.note = "See /Users/someone/run.h5 for the detail."; },
    ],
    [
      "a wrong column: a name that is not on the producer's roster",
      ["columnName", "shape", "accounting_columns"],
      /ACCOUNTING_COLUMN_ROSTER\.some/,
      (w) => { w.graph.reported_income.accounting_columns[0].name = "invented_person_key"; },
    ],
    [
      "a wrong column: the roster reordered",
      ["accounting_columns", "shape", "incomeReported"],
      /equal\(c\.name, ACCOUNTING_COLUMN_ROSTER\[index\]\.name\)/,
      (w) => {
        const columns = w.graph.reported_income.accounting_columns;
        [columns[0], columns[1]] = [columns[1], columns[0]];
      },
    ],
    [
      "a wrong column: a dtype narrowed under an unchanged name",
      ["accounting_columns", "shape", "incomeReported"],
      /equal\(c\.dtype, ACCOUNTING_COLUMN_ROSTER\[index\]\.dtype\)/,
      (w) => { w.graph.reported_income.accounting_columns[0].dtype = "u1"; },
    ],
    [
      "a refuted engine edge: the accounting node consuming the engine",
      ["permittedInputProducer", "normalizeGraphAttachment"],
      /permitted\.includes\(producer\)/,
      (w) => {
        for (const execution of w.graph.executions) {
          const accounting = execution.nodes.find(
            (n: any) => n.id === "asec_prepared.reported_income",
          );
          const engine = execution.nodes.find(
            (n: any) => n.id === "asec_prepared.engine_current_money",
          );
          accounting.typed_inputs = [
            {
              ...engine.typed_outputs[0],
              producer: "asec_prepared.engine_current_money",
              producer_key: engine.node_key,
            },
          ];
        }
      },
    ],
    [
      "a refuted engine edge: the selection node consuming the carried frame",
      ["permittedInputProducer", "normalizeGraphAttachment"],
      /permitted\.includes\(producer\)/,
      (w) => {
        for (const execution of w.graph.executions) {
          const selection = execution.nodes.find(
            (n: any) => n.id === "asec_prepared.select_households",
          );
          const carried = execution.nodes.find(
            (n: any) => n.id === "asec_prepared.cps_carried_current",
          );
          selection.typed_inputs = [
            {
              ...carried.typed_outputs[0],
              producer: "asec_prepared.cps_carried_current",
              producer_key: carried.node_key,
            },
          ];
        }
      },
    ],
  ];

  for (const [name, chain, line, mutate] of cases)
    test(name, () => {
      const reached = reachedBy(mutate);
      expect(reached.slice(0, chain.length).map((frame) => frame.check)).toEqual(chain);
      expect(reached[0].line).toMatch(line);
    });
});

describe("the column roster does not weaken the publisher-text check", () => {
  test("person_id is still refused as publisher prose", () => {
    expect(reachedBy((w) => { w.graph.scope.note = "person_id"; })[0].check).toBe("text");
  });

  test("a real column name is still refused where a value belongs", () => {
    // `period_basis` takes an identifier through the same marker check. A
    // schema label is safe as a column name and unsafe here, and the roster is
    // scoped narrowly enough to keep that true.
    expect(reachedBy((w) => { w.graph.period_basis = "person_id"; })[0].check).toBe("text");
  });

  test("a column name off the roster is refused even though it is a safe identifier", () => {
    // `income_year_v2` passes every generic check: it is a valid identifier and
    // carries no marker. It is refused only because it is not one of the
    // producer's twenty-eight, which is the whole point of a closed roster.
    const reached = reachedBy((w) => {
      w.graph.reported_income.accounting_columns[1].name = "income_year_v2";
    });
    expect(reached[0].check).toBe("columnName");
    expect(reached[0].line).toMatch(/ACCOUNTING_COLUMN_ROSTER\.some/);
  });
});
