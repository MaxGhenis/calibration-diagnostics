"use client";

import { useQualityContext } from "./quality-context";
import { QualityLink } from "./quality-link";
import {
  useQualityIndex,
  useQualityManifest,
  useResolvedComparison,
} from "@/lib/api/hooks/use-quality";
import {
  releaseSelectOptions,
  useMicrocosmReleases,
} from "@/lib/api/hooks/use-microcosm";
import { StatusPill } from "@/components/shared/status-pill";

export function QualityStrip() {
  const context = useQualityContext();
  const comparison = useResolvedComparison();
  const { data: catalog } = useQualityIndex();
  const { data: releases } = useMicrocosmReleases();
  const manifest = useQualityManifest();
  const entries = catalog?.index?.candidates ?? [];
  const options = [
    ...releaseSelectOptions(releases),
    ...entries.map((entry) => ({
      value: `candidate:${entry.candidate_release_id}:${entry.manifest.sha256}`,
      label: `${entry.candidate_release_id} · ${entry.release_eligibility.status.replaceAll("_", " ")}`,
    })),
  ];
  for (const value of [context.release, comparison.incumbent]) {
    if (value && !options.some((option) => option.value === value))
      options.push({
        value,
        label: value.startsWith("candidate:") ? value.split(":")[1] : value,
      });
  }
  const select = (value: string) => {
    if (value.startsWith("candidate:")) {
      const [, candidate, manifest_sha256] = value.split(":");
      context.setSelection({ candidate, manifest_sha256 });
    } else context.setSelection({ release: value });
  };
  // An incumbent is a comparison against a different population, so the one
  // already selected is not on offer. While the population is Latest its own
  // release id is the same population under another name, so that goes too.
  const selected = new Set(
    [
      context.release,
      context.release ? "" : (releases?.latest_release_id ?? ""),
    ].filter(Boolean),
  );
  const eligibility = manifest.data?.release_eligibility;
  return (
    <section
      aria-label="Population context"
      className="mb-5 border-b border-border py-3"
    >
      <div className="flex flex-wrap items-end gap-x-5 gap-y-3">
        <label className="min-w-0 flex-1 basis-full text-xs text-muted-foreground sm:basis-64">
          Population
          <select
            aria-label="Selected population"
            className="mt-1 block w-full max-w-[440px] rounded border border-border bg-background px-2 py-1.5 text-sm text-foreground"
            value={context.release}
            onChange={(event) => select(event.target.value)}
          >
            {options.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </label>
        <label className="min-w-0 flex-1 basis-full text-xs text-muted-foreground sm:basis-64">
          Incumbent comparison
          <select
            aria-label="Incumbent population"
            className="mt-1 block w-full max-w-[350px] rounded border border-border bg-background px-2 py-1.5 text-sm text-foreground"
            value={comparison.incumbent}
            onChange={(event) =>
              context.setSelection({ incumbent: event.target.value })
            }
          >
            <option value="">No comparison selected</option>
            {options
              .filter((option) => option.value && !selected.has(option.value))
              .map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
          </select>
        </label>
        <QualityLink
          href="/microcosm/quality"
          className="py-1.5 text-sm text-primary underline underline-offset-4"
        >
          Inspect quality evidence
        </QualityLink>
      </div>
      <div
        className="mt-2 flex flex-wrap items-center gap-2 text-xs text-muted-foreground"
        role="status"
      >
        {context.selection.candidate ? (
          <>
            <span>Candidate evidence</span>
            {manifest.isLoading ? <span>Checking identity…</span> : null}
            {manifest.error ? (
              <span className="text-destructive">{manifest.error.message}</span>
            ) : null}
            {manifest.data ? (
              <>
                <span>Build {manifest.data.execution_status}</span>
                <StatusPill
                  tone={
                    eligibility?.status === "eligible"
                      ? "success"
                      : eligibility?.status === "not_evaluated"
                        ? "neutral"
                        : "warning"
                  }
                >
                  {eligibility?.status.replaceAll("_", " ")}
                </StatusPill>
                <span>{eligibility?.reason}</span>
              </>
            ) : null}
          </>
        ) : (
          <span>
            Published release selection · independent evidence requires an
            explicit identity match
          </span>
        )}
        {/* A hand-authored URL, the Latest pointer and a re-registered
            candidate can all name the selected population a second time. That
            draws no comparison; say which resolution applied, instead of
            leaving the control looking as though it lost the selection. */}
        {comparison.reason ? <span>{comparison.reason}</span> : null}
        {catalog?.freshness === "stale" ? (
          <span>
            Candidate discovery feed is over 24 hours old; immutable attachments
            remain addressable.
          </span>
        ) : null}
      </div>
    </section>
  );
}
