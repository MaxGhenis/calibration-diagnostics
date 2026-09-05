/** Privacy-safe aggregates only. Producers compute these from canonical Frame
 * reducers; the dashboard validates identities and displays the supplied values. */
export interface AggregateGeography {
  level: string;
  id: string;
  label: string;
  vintage?: string;
}
export interface PopulationAggregateIdentity {
  candidate_release_id: string;
  population_sha256: string;
  period: string;
}
export interface PopulationSupport extends PopulationAggregateIdentity {
  schema_version: "microcosm.population_support.v1";
  entity: string;
  weight_entity: string;
  weight_basis: string;
  rows: Array<{
    geography: AggregateGeography;
    record_count: number;
    positive_weight_count: number;
    weight_sum: number;
    effective_sample_size: number | null;
    max_weight_share: number | null;
  }>;
}
export interface PopulationDistributions extends PopulationAggregateIdentity {
  schema_version: "microcosm.population_distributions.v1";
  series: Array<{
    variable: string;
    label: string;
    entity: string;
    unit: string;
    weight_basis: string;
    bin_definition_id: string;
    geography: AggregateGeography;
    // Bins are [lower, upper), except the final upper bound is included.
    // Null lower/upper denotes negative/positive infinity. Share uses total
    // weight, including missing values, so missingness is never hidden.
    bins: Array<{
      label: string;
      lower: number | null;
      upper: number | null;
      weight: number;
      share: number | null;
    }>;
    missing_weight: number;
    total_weight: number;
  }>;
}

export function geographyKey(geography: AggregateGeography): string {
  return JSON.stringify([
    geography.level,
    geography.id,
    geography.vintage ?? null,
  ]);
}

export function distributionDefinition(
  series: PopulationDistributions["series"][number],
  period: string,
): string {
  return JSON.stringify([
    period,
    series.variable,
    series.entity,
    series.unit,
    series.weight_basis,
    series.bin_definition_id,
    geographyKey(series.geography),
    series.bins.map(({ lower, upper }) => [lower, upper]),
  ]);
}

export function supportDefinition(support: PopulationSupport): string {
  return JSON.stringify([
    support.period,
    support.entity,
    support.weight_entity,
    support.weight_basis,
  ]);
}

function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("Aggregate must be an object.");
  return value as Record<string, unknown>;
}
function string(value: unknown): string {
  if (typeof value !== "string" || !value.trim())
    throw new Error("Aggregate identity and labels must be nonempty strings.");
  return value;
}
function number(value: unknown, integer = false): number {
  if (
    typeof value !== "number" ||
    !Number.isFinite(value) ||
    value < 0 ||
    (integer && !Number.isSafeInteger(value))
  )
    throw new Error("Aggregate weights/counts must be finite and nonnegative.");
  return value;
}
function rows(value: unknown): unknown[] {
  if (!Array.isArray(value))
    throw new Error("Aggregate rows must be an array.");
  return value;
}
function geo(value: unknown): AggregateGeography {
  const raw = record(value);
  return {
    level: string(raw.level),
    id: string(raw.id),
    label: string(raw.label),
    ...(raw.vintage === undefined ? {} : { vintage: string(raw.vintage) }),
  };
}
function common(raw: Record<string, unknown>): PopulationAggregateIdentity {
  const sha = string(raw.population_sha256);
  if (!/^[a-f0-9]{64}$/.test(sha))
    throw new Error("Aggregate population digest is invalid.");
  return {
    candidate_release_id: string(raw.candidate_release_id),
    population_sha256: sha,
    period: string(raw.period),
  };
}
function near(a: number, b: number): boolean {
  return (
    Number.isFinite(a) &&
    Number.isFinite(b) &&
    Math.abs(a - b) <=
      1e-8 * Math.max(Number.MIN_VALUE, Math.abs(a), Math.abs(b))
  );
}

export function validateSupport(value: unknown): PopulationSupport {
  const raw = record(value);
  if (raw.schema_version !== "microcosm.population_support.v1")
    throw new Error("Unsupported population support schema.");
  const seen = new Set<string>();
  return {
    schema_version: "microcosm.population_support.v1",
    ...common(raw),
    entity: string(raw.entity),
    weight_entity: string(raw.weight_entity),
    weight_basis: string(raw.weight_basis),
    rows: rows(raw.rows).map((value) => {
      const row = record(value);
      const geography = geo(row.geography);
      const key = geographyKey(geography);
      if (seen.has(key)) throw new Error("Duplicate support geography.");
      seen.add(key);
      const record_count = number(row.record_count, true);
      const positive_weight_count = number(row.positive_weight_count, true);
      const weight_sum = number(row.weight_sum);
      if (
        positive_weight_count > record_count ||
        weight_sum > 0 !== positive_weight_count > 0
      )
        throw new Error("Support counts and weight mass disagree.");
      const effective_sample_size =
        row.effective_sample_size === null
          ? null
          : number(row.effective_sample_size);
      const max_weight_share =
        row.max_weight_share === null ? null : number(row.max_weight_share);
      if (
        weight_sum === 0
          ? effective_sample_size !== null || max_weight_share !== null
          : effective_sample_size === null ||
            effective_sample_size < 1 - 1e-8 ||
            effective_sample_size > positive_weight_count + 1e-8 ||
            max_weight_share === null ||
            max_weight_share <= 0 ||
            max_weight_share > 1
      )
        throw new Error(
          "Invalid support concentration or effective sample size.",
        );
      if (effective_sample_size !== null && max_weight_share !== null) {
        // For normalized positive weights, q=sum(p_i^2)=1/ESS. Fixing the
        // largest share bounds q between evenly spread remaining mass and
        // concentrating as much remaining mass as that largest share allows.
        const p = max_weight_share;
        const q = 1 / effective_sample_size;
        const minimum =
          positive_weight_count === 1
            ? 1
            : p * p + (1 - p) ** 2 / (positive_weight_count - 1);
        const filled = Math.min(positive_weight_count, Math.floor(1 / p));
        const maximum = filled * p * p + (1 - filled * p) ** 2;
        if (
          (p < 1 / positive_weight_count &&
            !near(p, 1 / positive_weight_count)) ||
          (q < minimum && !near(q, minimum)) ||
          (q > maximum && !near(q, maximum))
        ) {
          throw new Error(
            "Effective sample size and largest weight share are inconsistent.",
          );
        }
      }
      return {
        geography,
        record_count,
        positive_weight_count,
        weight_sum,
        effective_sample_size,
        max_weight_share,
      };
    }),
  };
}

export function validateDistributions(value: unknown): PopulationDistributions {
  const raw = record(value);
  if (raw.schema_version !== "microcosm.population_distributions.v1")
    throw new Error("Unsupported population distribution schema.");
  const identity = common(raw);
  const seen = new Set<string>();
  return {
    schema_version: "microcosm.population_distributions.v1",
    ...identity,
    series: rows(raw.series).map((value) => {
      const row = record(value);
      const total_weight = number(row.total_weight);
      const missing_weight = number(row.missing_weight);
      const rawBins = rows(row.bins);
      if (!rawBins.length)
        throw new Error("Distribution bins must be declared.");
      let previousUpper: number | null | undefined;
      const bins = rawBins.map((value, index) => {
        const bin = record(value);
        const bound = (value: unknown): number | null => {
          if (value === null) return null;
          if (typeof value !== "number" || !Number.isFinite(value))
            throw new Error("Invalid bin boundary.");
          return value;
        };
        const lower = bound(bin.lower);
        const upper = bound(bin.upper);
        if (
          (lower === null && index !== 0) ||
          (upper === null && index !== rawBins.length - 1) ||
          (lower !== null && upper !== null && lower >= upper) ||
          (index > 0 && lower !== previousUpper)
        )
          throw new Error("Distribution bins must be ordered and contiguous.");
        previousUpper = upper;
        const weight = number(bin.weight);
        const share = bin.share === null ? null : number(bin.share);
        if (
          total_weight === 0
            ? share !== null
            : share === null || share > 1 || !near(share, weight / total_weight)
        )
          throw new Error(
            "Distribution share disagrees with its declared total weight.",
          );
        return { label: string(bin.label), lower, upper, weight, share };
      });
      if (
        !near(
          bins.reduce((sum, bin) => sum + bin.weight, missing_weight),
          total_weight,
        )
      )
        throw new Error(
          "Distribution bins and missing values do not account for total weight.",
        );
      const series = {
        variable: string(row.variable),
        label: string(row.label),
        entity: string(row.entity),
        unit: string(row.unit),
        weight_basis: string(row.weight_basis),
        bin_definition_id: string(row.bin_definition_id),
        geography: geo(row.geography),
        bins,
        missing_weight,
        total_weight,
      };
      const key = distributionDefinition(series, identity.period);
      if (seen.has(key)) throw new Error("Duplicate distribution series.");
      seen.add(key);
      return series;
    }),
  };
}
