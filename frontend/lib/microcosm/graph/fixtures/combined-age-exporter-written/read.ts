import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { CandidateQualityManifest } from "../../../quality/types";
/** Sealed exporter bytes over invented aggregates. No discovery index. */
export function writtenCombinedAge(size: 20 | 200 = 20) {
  const root = join(import.meta.dir, String(size));
  const read = (path: string) => JSON.parse(readFileSync(join(root,path),"utf8"));
  const reference=read("export-reference.json");
  const manifest={geography:null,...read(`candidate/${reference.path}`)} as CandidateQualityManifest;
  return {manifest,manifestSha:reference.sha256 as string,reference,root,
    graph:read(`candidate/${manifest.attachments.graph_receipts.path}`),
    build:read(`candidate/${manifest.attachments.build_manifest.path}`)};
}
