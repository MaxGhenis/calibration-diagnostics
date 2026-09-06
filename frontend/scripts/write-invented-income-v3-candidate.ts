// Write the invented income-v3 fixture into a candidate evidence directory, so
// the real page can be opened in a real browser before any genuine export
// exists.
//
// INVENTED. Nothing this writes describes a real population, a real run or a
// real model output. It exists to look at the surface, and it must never be
// pointed at by anything that publishes. Every id and reason it writes says so
// in words, so a screenshot of it cannot be mistaken for one of a genuine run.
//
//   bun run scripts/write-invented-income-v3-candidate.ts <directory>
//
// then start the app with MICROCOSM_QUALITY_US_DIR=<directory> and open
//   /microcosm/pipeline?country=us&candidate=<id>&manifest_sha256=<sha>
// which this script prints.

import { mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

import {
  digestOf,
  inventedIncomeV3,
} from "../lib/microcosm/graph/fixtures/invented-income-v3";

const target = process.argv[2];
if (!target) {
  console.error("Usage: bun run scripts/write-invented-income-v3-candidate.ts <directory>");
  process.exit(2);
}
const directory = resolve(target);

const fixture = inventedIncomeV3();
const graphSha = digestOf(fixture.graph);
const build = fixture.build as Record<string, unknown>;
build.graph_receipts_sha256 = graphSha;
const buildSha = digestOf(build);

const attachments = fixture.manifest.attachments;
Object.assign(attachments.graph_receipts, {
  sha256: graphSha,
  path: `artifacts/${graphSha}.json`,
});
Object.assign(attachments.build_manifest, {
  sha256: buildSha,
  path: `artifacts/${buildSha}.json`,
});
const manifestSha = digestOf(fixture.manifest);

mkdirSync(join(directory, "artifacts"), { recursive: true });
mkdirSync(join(directory, "manifests"), { recursive: true });
writeFileSync(join(directory, "artifacts", `${graphSha}.json`), JSON.stringify(fixture.graph));
writeFileSync(join(directory, "artifacts", `${buildSha}.json`), JSON.stringify(build));
writeFileSync(
  join(directory, "manifests", `${manifestSha}.json`),
  JSON.stringify(fixture.manifest),
);
writeFileSync(
  join(directory, "index.json"),
  JSON.stringify({
    schema_version: "microcosm.candidate_quality_index.v1",
    country: "us",
    updated_at: fixture.manifest.created_at,
    candidates: [
      {
        candidate_release_id: fixture.manifest.candidate_release_id,
        run_id: fixture.manifest.run_id,
        execution_status: fixture.manifest.execution_status,
        release_eligibility: fixture.manifest.release_eligibility,
        updated_at: fixture.manifest.created_at,
        manifest: { path: `manifests/${manifestSha}.json`, sha256: manifestSha },
      },
    ],
  }),
);

console.log(
  JSON.stringify(
    {
      invented: true,
      directory,
      candidate: fixture.manifest.candidate_release_id,
      manifest_sha256: manifestSha,
      path: `/microcosm/pipeline?country=us&candidate=${fixture.manifest.candidate_release_id}&manifest_sha256=${manifestSha}`,
    },
    null,
    2,
  ),
);
