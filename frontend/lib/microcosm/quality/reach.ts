import { ArtifactError } from "../../cross-dataset/artifact";
import { object } from "./artifact";

/** Validate the existing model-coverage shape before a supplied attachment
 * enters the treemap. This does not change how validation reach is computed. */
export function validateValidationReach(
  value: unknown,
): Record<string, unknown> {
  const data = object(value, "validation reach");
  const source = object(data.source, "validation reach source");
  for (const field of ["repo", "version", "commit"]) {
    if (typeof source[field] !== "string" || !source[field].trim()) {
      throw new ArtifactError(
        "malformed_artifact",
        `Validation reach source ${field} is missing.`,
      );
    }
  }
  function count(raw: Record<string, unknown>, field: string): number {
    const value = raw[field];
    if (
      typeof value !== "number" ||
      !Number.isSafeInteger(value) ||
      value < 0
    ) {
      throw new ArtifactError(
        "malformed_artifact",
        `Validation reach ${field} must be a nonnegative count.`,
      );
    }
    return value;
  }
  const totals = object(data.totals, "validation reach totals");
  for (const field of [
    "variables",
    "rules",
    "anchored",
    "exercised",
    "unreached",
    "inputs",
  ])
    count(totals, field);
  if (
    Number(totals.anchored) +
      Number(totals.exercised) +
      Number(totals.unreached) !==
    totals.rules
  ) {
    throw new ArtifactError(
      "malformed_artifact",
      "Validation reach totals do not reconcile.",
    );
  }
  const anchors = object(data.anchor_counts, "validation reach anchor counts");
  for (const field of ["calibration", "reform", "backtest"])
    count(anchors, field);
  function node(value: unknown): Record<string, unknown> {
    const raw = object(value, "validation reach node");
    if (typeof raw.name !== "string" || !raw.name)
      throw new ArtifactError(
        "malformed_artifact",
        "Validation reach node requires a name.",
      );
    const rules = count(raw, "rules");
    if (count(raw, "anchored") + count(raw, "exercised") > rules)
      throw new ArtifactError(
        "malformed_artifact",
        "Validation reach node exceeds its rule count.",
      );
    count(raw, "inputs");
    if (raw.children !== undefined) {
      if (!Array.isArray(raw.children))
        throw new ArtifactError(
          "malformed_artifact",
          "Validation reach children must be an array.",
        );
      raw.children.forEach(node);
    }
    for (const field of [
      "anchored_names",
      "exercised_names",
      "unreached_names",
    ]) {
      if (
        raw[field] !== undefined &&
        (!Array.isArray(raw[field]) ||
          raw[field].some((name) => typeof name !== "string"))
      )
        throw new ArtifactError(
          "malformed_artifact",
          "Validation reach rule names must be strings.",
        );
    }
    return raw;
  }
  const root = node(data.tree);
  for (const field of ["rules", "anchored", "exercised", "inputs"]) {
    if (root[field] !== totals[field])
      throw new ArtifactError(
        "malformed_artifact",
        "Validation reach tree and totals disagree.",
      );
  }
  return data;
}
