// Navigation identities describe only the geography metadata in this surface.
// They do not infer a boundary vintage or equate a legacy ID with a dimension.
export const DEFAULT_GEOGRAPHY = "United States";
export const DEFAULT_GEOGRAPHY_LEVEL = "national";

export interface GeographyRow {
  geography?: string | null;
  geography_id?: string | null;
  geography_dimension_id?: string | null;
  geography_rank?: number | null;
  level?: string | null;
}

export class AmbiguousGeographyError extends Error {
  constructor() {
    super("This geography label matches more than one geographic identity. Choose a geography from the list.");
  }
}

function present(value: string | null | undefined): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

export function geographyKey(row: GeographyRow): string {
  const level = row.level?.trim() || DEFAULT_GEOGRAPHY_LEVEL;
  const label = row.geography?.trim() || DEFAULT_GEOGRAPHY;
  const dimension = row.geography_dimension_id;
  const value = row.geography_id;
  if (present(dimension) && !present(value)) {
    throw new Error("A declared geography dimension requires a geography value ID.");
  }
  const identity = present(dimension) && present(value)
    ? ["dimension", dimension, value]
    : present(value)
      ? ["legacy_id", level, value]
      : ["legacy_label", level, label];
  return `geo:v1:${encodeURIComponent(JSON.stringify(identity))}`;
}

export interface GeographyOption {
  key: string;
  label: string;
  aliases: string[];
  dimensionId: string | null;
  rank: number | null;
}

export function geographyOptions(rows: GeographyRow[]): GeographyOption[] {
  const groups = new Map<string, GeographyRow[]>();
  for (const row of rows) {
    const key = geographyKey(row);
    const members = groups.get(key) ?? [];
    members.push(row);
    groups.set(key, members);
  }
  const options = [...groups].map(([key, members]) => {
    const aliases = [...new Set(members.map((row) => row.geography?.trim() || DEFAULT_GEOGRAPHY))].sort();
    const ranks = new Set(members.map((row) => row.geography_rank));
    const rank = members[0].geography_rank;
    return {
      key,
      label: aliases.join(" / "),
      aliases,
      dimensionId: members[0].geography_dimension_id ?? null,
      rank: ranks.size === 1 && typeof rank === "number" && Number.isFinite(rank) && rank >= 0 ? rank : null,
    };
  });
  // Equal labels remain recognizable and selectable. The suffix disambiguates
  // them for people; the exact key, never this display text, selects the rows.
  const aliasCounts = new Map<string, number>();
  for (const option of options) {
    for (const label of option.aliases) aliasCounts.set(label, (aliasCounts.get(label) ?? 0) + 1);
  }
  for (const option of options) {
    if (option.aliases.some((label) => aliasCounts.get(label)! > 1)) {
      const row = groups.get(option.key)![0];
      option.label += ` (${row.geography_dimension_id ?? row.level ?? DEFAULT_GEOGRAPHY_LEVEL} / ${row.geography_id ?? row.geography ?? DEFAULT_GEOGRAPHY})`;
    }
  }
  const dimensions = new Set(options.map((option) => option.dimensionId));
  const ordered = dimensions.size === 1 && !dimensions.has(null) && options.every((option) => option.rank != null);
  return options.sort((a, b) =>
    (ordered ? a.rank! - b.rank! : 0) || a.label.localeCompare(b.label) || a.key.localeCompare(b.key),
  );
}

/** Old URLs carry a label. Resolve only against the complete loaded surface,
 * before narrowing by program or filters; a narrower view must not hide an
 * identity collision. Unknown selections remain empty, as in the old reader. */
export function resolveGeographySelection(value: string, options: GeographyOption[]): string {
  if (options.some((option) => option.key === value)) return value;
  const matches = options.filter((option) => option.aliases.includes(value));
  if (matches.length > 1) throw new AmbiguousGeographyError();
  return matches[0]?.key ?? value;
}
