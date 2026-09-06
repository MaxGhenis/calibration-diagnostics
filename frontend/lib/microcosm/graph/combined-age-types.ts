/** Aggregate-only public evidence. No record arrays or source paths belong here. */
export interface AgeCell {
  cell: string; measure: string; label: string;
  minimum_age: number; maximum_age: number | null;
  published_value: number; published_se: number; compiled_target: number;
  initial_estimate: number; final_estimate: number;
  initial_deviation: number; final_deviation: number;
  initial_relative_deviation: number; final_relative_deviation: number;
  supported_households: number; unweighted_people_in_band: number;
  maximum_band_count_in_a_household: number;
  support_status: "supported" | "zero_support"; within_tolerance: null;
}
export interface AgeWeights {
  records: number; positive_records: number; zero_records: number;
  total: number; minimum: number; maximum: number; maximum_weight_share: number;
  effective_sample_size: number; effective_sample_size_fraction: number;
  top_1pct_count: number; top_1pct_weight_share: number; top_1pct_convention: string;
}
export interface AgeTrajectorySummary {
  epochs_recorded: number; first: number; last: number; minimum: number;
  argmin_epoch: number; monotone_nonincreasing_steps: number; total_steps: number;
  monotone_nonincreasing: boolean; last10_relative_change: number | null;
}
export interface CombinedAgeProfile {
  id: "us_combined_asec_acs_national_age_v1";
  genuine: boolean;
  period_reason: string;
  scope: {
    households: number; persons: number;
    entity_rows: { entity: string; rows: number }[];
    source_arms: { id: "asec" | "acs"; label: string; households: number; persons: number; source_vintages: string[] }[];
  };
  composition: { checkpoint_sha256: string; run_receipt_sha256: string; acceptance_sha256: string; computation_content_key: string };
  quality: { status: "incomplete"; basis: "age_only_development_calibration"; score: null; missing: string[]; note: string };
  age_calibration: {
    target_year: 2024; consumes_standard_errors: false; tolerance: null; tolerance_status: "unavailable";
    cells: AgeCell[];
    error_summary: Record<"all_cells" | "supported_cells", { denominator: number; excluded_cells: number; maximum_absolute_relative_deviation: number | null }>;
    weights: Record<"initial_importance" | "calibrated", AgeWeights>;
    caps: Record<"executor" | "solver", { anchor: string; max_weight_ratio: number; realized: number }>;
    solver: { method: string; epochs: number; learning_rate: number; seed: number; mass: string; initial_loss: number; final_loss: number; convergence_status: "unavailable"; diagnostic_warnings: string[] };
    trajectory: { kind: "complete_recorded" | "recorded_summary"; summary: AgeTrajectorySummary; values: number[] | null };
    column_provenance: { columns: string[]; source_role: string; source_sha256: string }[];
  };
  executions: { mode: string; cache_origin: string; source_composition_receipt_sha256: string }[];
  identities: { key: string; sha256: string }[];
}
