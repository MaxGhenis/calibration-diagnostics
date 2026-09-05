import type { MicrocosmCountry } from "../countries";

export const QUALITY_SCHEMA = "microcosm.candidate_quality.v1";
export const QUALITY_INDEX_SCHEMA = "microcosm.candidate_quality_index.v1";
export const EVIDENCE_FAMILIES = [
  "calibration_diagnostics",
  "support",
  "distributions",
  "cross_dataset",
  "validation_reach",
  "reform_validation",
  "build_manifest",
  "release_manifest",
  "demographics",
] as const;
export type EvidenceFamily = (typeof EVIDENCE_FAMILIES)[number];
export type ExecutionStatus =
  | "pending"
  | "running"
  | "completed"
  | "failed"
  | "cancelled";
export type EligibilityStatus =
  | "not_evaluated"
  | "eligible"
  | "ineligible"
  | "excluded";
export interface ReleaseEligibility {
  status: EligibilityStatus;
  reason: string;
}
export interface EvidenceIdentity {
  candidate_release_id?: string;
  population_sha256?: string;
  model_package?: string;
  model_version?: string;
  model_commit?: string;
  target_surface_sha256?: string;
  run_id?: string;
  snapshot_id?: string;
  source_id?: string;
}
export interface EvidenceAttachment {
  status: "available" | "pending" | "missing" | "failed";
  scope?: "population" | "model" | "run";
  reason?: string;
  path?: string;
  sha256?: string;
  identity?: EvidenceIdentity;
}
export interface CandidateQualityManifest {
  schema_version: typeof QUALITY_SCHEMA;
  country: MicrocosmCountry;
  candidate_release_id: string;
  run_id: string;
  created_at: string;
  execution_status: ExecutionStatus;
  release_eligibility: ReleaseEligibility;
  population: { sha256: string; period: string; entity: string } | null;
  provenance: Record<string, string>;
  geography: { levels: string[]; vintage?: string } | null;
  attachments: Record<string, EvidenceAttachment>;
}
export interface CandidateQualityEntry {
  candidate_release_id: string;
  run_id: string;
  execution_status: ExecutionStatus;
  release_eligibility: ReleaseEligibility;
  updated_at: string;
  manifest: { path: string; sha256: string };
}
export interface CandidateQualityIndex {
  schema_version: typeof QUALITY_INDEX_SCHEMA;
  country: MicrocosmCountry;
  updated_at: string;
  candidates: CandidateQualityEntry[];
}
export interface QualityIndexResponse {
  available: boolean;
  index?: CandidateQualityIndex;
  freshness: "current" | "stale" | "unknown";
  detail?: string;
}
