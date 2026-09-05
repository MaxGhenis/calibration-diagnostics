"use client";

import { useMemo, useState } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { useQualityContext } from "@/components/layout/quality-context";
import { QualityLink } from "@/components/layout/quality-link";
import { EmptyState } from "@/components/shared/empty-state";
import { LoadingBlock } from "@/components/shared/LoadingBlock";
import { PageHeader } from "@/components/shared/page-header";
import {
  useQualityAttachment,
  useQualityIndex,
  useQualityManifest,
} from "@/lib/api/hooks/use-quality";
import { useMicrocosmTargetDiagnostics } from "@/lib/api/hooks/use-microcosm";
import { QualityMethodologyNote } from "./quality-methodology-note";
import { parseCandidateToken } from "@/lib/microcosm/quality/selection";
import {
  EVIDENCE_FAMILIES,
  type EvidenceFamily,
} from "@/lib/microcosm/quality/types";
import {
  distributionDefinition,
  geographyKey,
  percentPoints,
  percentShare,
  supportDefinition,
  type PopulationDistributions,
  type PopulationSupport,
} from "@/lib/microcosm/quality/aggregates";

const labels: Record<EvidenceFamily, string> = {
  calibration_diagnostics: "Calibration fit",
  support: "Weights and support",
  distributions: "Population distributions",
  cross_dataset: "Independent evaluation",
  validation_reach: "Validation reach",
  reform_validation: "Reform validation",
  build_manifest: "Build provenance",
  release_manifest: "Release provenance",
  demographics: "Geographic coverage",
};
const evidenceLinks: Partial<Record<EvidenceFamily, string>> = {
  calibration_diagnostics: "/microcosm",
  cross_dataset: "/microcosm/datasets",
  validation_reach: "/microcosm/model-coverage",
  support: "/microcosm/quality#support",
  distributions: "/microcosm/quality#distributions",
};
const fmt = (value: number | null | undefined, digits = 1) =>
  value == null
    ? "—"
    : value.toLocaleString("en-US", { maximumFractionDigits: digits });

export function CandidateCatalog() {
  const context = useQualityContext();
  const { data, isLoading } = useQualityIndex();
  const entries = data?.index?.candidates ?? [];
  return (
    <section className="border-b border-border pb-5">
      <h2 className="text-base font-semibold">Candidate evidence</h2>
      <p className="mt-1 text-sm text-muted-foreground">
        Inspect completed or failed runs without promoting them to the published
        release channel.
      </p>
      {isLoading ? (
        <p className="mt-2 text-sm">Loading candidate index…</p>
      ) : null}
      {data?.available === false ? (
        <p className="mt-2 text-sm text-muted-foreground">
          {data.detail} A direct immutable candidate link can still be used when
          its configured source is available.
        </p>
      ) : null}
      {data?.freshness === "stale" ? (
        <p className="mt-2 text-sm text-muted-foreground">
          Discovery was last updated {data.index?.updated_at}. This does not
          change the recorded status of a completed run.
        </p>
      ) : null}
      {data?.available && !entries.length ? (
        <p className="mt-2 text-sm text-muted-foreground">
          No candidate evidence has been registered.
        </p>
      ) : null}
      <div className="mt-3 divide-y divide-border">
        {entries.map((entry) => (
          <div
            key={entry.candidate_release_id}
            className="flex flex-wrap items-center justify-between gap-3 py-3"
          >
            <div className="min-w-0">
              <div className="break-all text-sm font-medium">
                {entry.candidate_release_id}
              </div>
              <div className="mt-1 text-xs text-muted-foreground">
                Build {entry.execution_status} · release{" "}
                {entry.release_eligibility.status.replaceAll("_", " ")} ·{" "}
                {entry.updated_at}
              </div>
              <div className="text-xs text-muted-foreground">
                {entry.release_eligibility.reason}
              </div>
            </div>
            <button
              type="button"
              className="shrink-0 text-sm text-primary underline underline-offset-4"
              onClick={() =>
                context.setSelection({
                  candidate: entry.candidate_release_id,
                  manifest_sha256: entry.manifest.sha256,
                })
              }
            >
              Inspect evidence
            </button>
          </div>
        ))}
      </div>
    </section>
  );
}

export function QualityOverviewView() {
  const context = useQualityContext();
  const manifest = useQualityManifest();
  const hasIncumbent = Boolean(parseCandidateToken(context.selection.incumbent));
  const data = manifest.data;
  const targetDiagnostics = useMicrocosmTargetDiagnostics(
    { release: context.release, limit: 1 },
    Boolean(
      context.selection.candidate &&
        data?.attachments.calibration_diagnostics?.status === "available",
    ),
  );
  const support = useQualityAttachment<PopulationSupport>(
    "support",
    data?.attachments.support?.status === "available",
  );
  const distributions = useQualityAttachment<PopulationDistributions>(
    "distributions",
    data?.attachments.distributions?.status === "available",
  );
  const incumbentSupport = useQualityAttachment<PopulationSupport>(
    "support",
    hasIncumbent,
    context.selection.incumbent,
  );
  const incumbentDistributions = useQualityAttachment<PopulationDistributions>(
    "distributions",
    hasIncumbent,
    context.selection.incumbent,
  );
  const [level, setLevel] = useState("national");
  const [geography, setGeography] = useState("");
  const [variable, setVariable] = useState("");
  const geographies = useMemo(() => {
    const all = [
      ...(support.data?.rows ?? []).map((row) => row.geography),
      ...(distributions.data?.series ?? []).map((row) => row.geography),
    ];
    return [...new Map(all.map((geo) => [geographyKey(geo), geo])).values()];
  }, [support.data, distributions.data]);
  const levels = [...new Set(geographies.map((geo) => geo.level))];
  const selectedLevel = levels.includes(level) ? level : levels[0];
  const geoOptions = geographies.filter((geo) => geo.level === selectedLevel);
  const selectedGeo =
    geoOptions.find((geo) => geographyKey(geo) === geography) ?? geoOptions[0];
  const key = selectedGeo ? geographyKey(selectedGeo) : "";
  const seriesOptions =
    distributions.data?.series.filter(
      (series) => geographyKey(series.geography) === key,
    ) ?? [];
  const seriesKey = (series: PopulationDistributions["series"][number]) =>
    distributionDefinition(series, distributions.data?.period ?? "");
  const series =
    seriesOptions.find((series) => seriesKey(series) === variable) ??
    seriesOptions[0];
  const districtVintageKnown =
    !selectedGeo?.level.includes("district") || Boolean(selectedGeo.vintage);
  const comparisonSeries =
    hasIncumbent && series && districtVintageKnown
      ? incumbentDistributions.data?.series.find(
          (other) =>
            distributionDefinition(
              other,
              incumbentDistributions.data!.period,
            ) === distributionDefinition(series, distributions.data!.period),
        )
      : undefined;
  const supportRows =
    support.data?.rows.filter((row) => row.geography.level === selectedLevel) ??
    [];
  const supportComparable = Boolean(
    hasIncumbent &&
      support.data &&
      incumbentSupport.data &&
      supportDefinition(support.data) ===
        supportDefinition(incumbentSupport.data),
  );
  const chart =
    series?.bins.map((bin, index) => ({
      label: bin.label,
      candidate: bin.share == null ? null : bin.share * 100,
      incumbent:
        comparisonSeries?.bins[index]?.share == null
          ? null
          : comparisonSeries.bins[index].share! * 100,
    })) ?? [];

  if (!context.selection.candidate)
    return (
      <div className="flex flex-col gap-5">
        <PageHeader
          eyebrow="Microcosm · population quality"
          title="Quality evidence"
          description="Choose a candidate to inspect population structure, support and independent evidence under one identity."
        />
        <CandidateCatalog />
      </div>
    );
  if (manifest.isLoading)
    return <LoadingBlock label="Verifying candidate evidence…" />;
  if (manifest.error || !data)
    return (
      <EmptyState
        title="Candidate evidence unavailable"
        description={
          manifest.error?.message ??
          "No immutable manifest is available for this selection."
        }
      />
    );

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        eyebrow="Microcosm · population quality"
        title="Quality evidence"
        description="Calibration, population structure and independent checks for the selected candidate. A low target error alone does not establish release eligibility."
      />
      <section className="border-b border-border pb-5">
        <div className="grid gap-4 md:grid-cols-3">
          <div>
            <div className="text-xs text-muted-foreground">Execution</div>
            <div className="mt-1 font-medium">{data.execution_status}</div>
          </div>
          <div>
            <div className="text-xs text-muted-foreground">
              Producer release decision
            </div>
            <div className="mt-1 font-medium">
              {data.release_eligibility.status.replaceAll("_", " ")}
            </div>
          </div>
          <div>
            <div className="text-xs text-muted-foreground">
              Evidence created
            </div>
            <div className="mt-1 text-sm">{data.created_at}</div>
          </div>
        </div>
        <p className="mt-3 text-sm text-muted-foreground">
          {data.release_eligibility.reason}
        </p>
        <details className="mt-3 text-xs">
          <summary className="cursor-pointer text-primary">
            Population and build identity
          </summary>
          <dl className="mt-2 grid gap-2 break-all font-mono">
            <div>Candidate: {data.candidate_release_id}</div>
            <div>Build run: {data.run_id}</div>
            <div>
              Population: {data.population?.sha256 ?? "No population produced"}
            </div>
            <div>
              Period / entity:{" "}
              {data.population
                ? `${data.population.period} / ${data.population.entity}`
                : "Not available"}
            </div>
            {Object.entries(data.provenance).map(([name, value]) => (
              <div key={name}>
                {name}: {value}
              </div>
            ))}
          </dl>
        </details>
      </section>
      <section>
        <h2 className="text-base font-semibold">Evidence attachments</h2>
        <p className="mt-1 text-xs text-muted-foreground">
          Available files are declared by this immutable manifest; their bytes
          are verified when opened. Model and run evidence do not establish
          population validity.
        </p>
        <table className="mt-3 w-full text-left text-sm">
          <thead className="border-b border-border text-xs text-muted-foreground">
            <tr>
              <th className="py-2 font-medium">Evidence</th>
              <th className="font-medium">State / scope</th>
              <th className="font-medium">Reason</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {EVIDENCE_FAMILIES.map((family) => {
              const attachment = data.attachments[family];
              const available = attachment?.status === "available";
              return (
                <tr key={family}>
                  <td className="py-2.5">
                    {available && evidenceLinks[family] ? (
                      <QualityLink
                        href={evidenceLinks[family]!}
                        className="text-primary underline underline-offset-4"
                      >
                        {labels[family]}
                      </QualityLink>
                    ) : (
                      labels[family]
                    )}
                  </td>
                  <td className="pr-3 text-xs">
                    {attachment?.status ?? "missing"}
                    {available ? ` · ${attachment.scope}` : ""}
                  </td>
                  <td className="text-xs text-muted-foreground">
                    {attachment?.reason ??
                      (available
                        ? "Identity and digest declared"
                        : "Not published for this candidate")}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </section>
      <section id="distributions" className="border-t border-border pt-5">
        <h2 className="text-base font-semibold">Population distributions</h2>
        <div className="mt-3 flex flex-wrap items-end gap-4">
          <label className="text-xs text-muted-foreground">
            Geographic level
            <select
              aria-label="Quality geographic level"
              className="mt-1 block rounded border border-border bg-background px-2 py-1.5 text-sm text-foreground"
              value={selectedLevel ?? ""}
              onChange={(event) => {
                setLevel(event.target.value);
                setGeography("");
              }}
            >
              <option value="" disabled>
                No published geography
              </option>
              {levels.map((item) => (
                <option value={item} key={item}>
                  {item.replaceAll("_", " ")}
                </option>
              ))}
            </select>
          </label>
          <label className="text-xs text-muted-foreground">
            Geography
            <select
              aria-label="Quality geography"
              className="mt-1 block max-w-xs rounded border border-border bg-background px-2 py-1.5 text-sm text-foreground"
              value={key}
              onChange={(event) => setGeography(event.target.value)}
            >
              {!geoOptions.length ? (
                <option value="">No published geography</option>
              ) : null}
              {geoOptions.map((geo) => (
                <option value={geographyKey(geo)} key={geographyKey(geo)}>
                  {geo.label}
                  {geo.vintage ? ` · ${geo.vintage}` : ""}
                </option>
              ))}
            </select>
          </label>
          <label className="text-xs text-muted-foreground">
            Variable
            <select
              aria-label="Distribution variable"
              className="mt-1 block rounded border border-border bg-background px-2 py-1.5 text-sm text-foreground"
              value={series ? seriesKey(series) : ""}
              onChange={(event) => setVariable(event.target.value)}
            >
              {!seriesOptions.length ? (
                <option value="">No published distribution</option>
              ) : null}
              {seriesOptions.map((item) => (
                <option key={seriesKey(item)} value={seriesKey(item)}>
                  {item.label} · {item.entity} · {item.unit}
                </option>
              ))}
            </select>
          </label>
        </div>
        {distributions.isLoading ? (
          <LoadingBlock label="Loading weighted distributions…" />
        ) : null}
        {distributions.error ? (
          <p role="alert" className="mt-3 text-sm text-destructive">
            {distributions.error.message}
          </p>
        ) : null}
        {series ? (
          <>
            <p className="mt-3 text-sm text-muted-foreground">
              {series.label} · {series.entity} · {series.weight_basis} weights ·{" "}
              {distributions.data?.period}. Missing values account for{" "}
              {percentShare(
                series.total_weight
                  ? series.missing_weight / series.total_weight
                  : null,
              )}{" "}
              of total weight.
            </p>
            <div
              className="mt-4 h-[280px]"
              aria-label={`${series.label} weighted distribution`}
            >
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={chart}>
                  <CartesianGrid vertical={false} stroke="var(--border)" />
                  <XAxis
                    dataKey="label"
                    tick={{ fill: "var(--muted-foreground)", fontSize: 12 }}
                  />
                  <YAxis
                    unit="%"
                    tick={{ fill: "var(--muted-foreground)", fontSize: 12 }}
                  />
                  <Tooltip
                    separator=": "
                    formatter={(value) =>
                      percentPoints(value == null ? null : Number(value))
                    }
                  />
                  <Legend />
                  <Bar
                    dataKey="candidate"
                    name="Candidate"
                    fill="var(--chart-1)"
                    isAnimationActive={false}
                  />
                  {comparisonSeries ? (
                    <Bar
                      dataKey="incumbent"
                      name="Incumbent"
                      fill="var(--chart-5)"
                      isAnimationActive={false}
                    />
                  ) : null}
                </BarChart>
              </ResponsiveContainer>
            </div>
            <p className="text-xs text-muted-foreground">
              Unit: {series.unit}. Bin definition: {series.bin_definition_id}.
              Shares include missing values in their denominator.
            </p>
            {context.selection.incumbent && !comparisonSeries ? (
              <p className="mt-2 text-xs text-muted-foreground">
                No incumbent distribution with matching period, entity, weight
                basis, units, bins and geography vintage is attached.
                {incumbentDistributions.error
                  ? ` ${incumbentDistributions.error.message}`
                  : ""}
              </p>
            ) : null}
          </>
        ) : !distributions.isLoading && !distributions.error ? (
          <p className="mt-3 text-sm text-muted-foreground">
            {data.attachments.distributions?.reason ??
              "No weighted distributions have been published for this candidate."}
          </p>
        ) : null}
      </section>
      <section id="support" className="border-t border-border pt-5">
        <h2 className="text-base font-semibold">Weights and support</h2>
        {support.data ? (
          <>
            <p className="mt-1 text-xs text-muted-foreground">
              {support.data.entity} records · {support.data.weight_basis}{" "}
              weights on {support.data.weight_entity} · {support.data.period}.
              Effective sample size measures weight concentration, not
              independent source coverage.
            </p>
            <div className="mt-3 max-h-[480px] overflow-auto">
              <table className="w-full text-left text-sm">
                <thead className="sticky top-0 border-b border-border bg-background text-xs text-muted-foreground">
                  <tr>
                    <th className="py-2">Geography</th>
                    <th>Records / positive weight</th>
                    <th>Weight mass</th>
                    <th>Effective sample size</th>
                    <th>Largest weight share</th>
                    {context.selection.incumbent ? (
                      <th>Incumbent ESS</th>
                    ) : null}
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {supportRows.map((row) => {
                    const other =
                      supportComparable &&
                      (!row.geography.level.includes("district") ||
                        row.geography.vintage)
                        ? incumbentSupport.data?.rows.find(
                            (candidate) =>
                              geographyKey(candidate.geography) ===
                              geographyKey(row.geography),
                          )
                        : undefined;
                    return (
                      <tr key={geographyKey(row.geography)}>
                        <td className="py-2.5 pr-3">
                          <button
                            className="text-primary underline underline-offset-4"
                            onClick={() =>
                              setGeography(geographyKey(row.geography))
                            }
                          >
                            {row.geography.label}
                          </button>
                          <div className="text-xs text-muted-foreground">
                            {row.geography.id}
                            {row.geography.vintage
                              ? ` · ${row.geography.vintage}`
                              : ""}
                          </div>
                        </td>
                        <td>
                          {fmt(row.record_count, 0)} /{" "}
                          {fmt(row.positive_weight_count, 0)}
                        </td>
                        <td>{fmt(row.weight_sum)}</td>
                        <td>{fmt(row.effective_sample_size)}</td>
                        <td>{percentShare(row.max_weight_share)}</td>
                        {context.selection.incumbent ? (
                          <td>{fmt(other?.effective_sample_size)}</td>
                        ) : null}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </>
        ) : (
          <p className="mt-3 text-sm text-muted-foreground">
            {support.error?.message ??
              data.attachments.support?.reason ??
              "No weight/support diagnostics have been published for this candidate."}
          </p>
        )}
        {context.selection.incumbent && !supportComparable ? (
          <p className="mt-2 text-xs text-muted-foreground">
            An incumbent comparison requires an attached population with the
            same period, entity and weight definitions.
            {incumbentSupport.error ? ` ${incumbentSupport.error.message}` : ""}
          </p>
        ) : null}
      </section>
      <div className="flex flex-wrap gap-5 border-t border-border pt-4 text-sm">
        {(targetDiagnostics.data?.levels ?? []).map((level) => (
          <QualityLink
            key={level}
            href={`/microcosm/targets?level=${encodeURIComponent(level)}`}
            className="text-primary underline"
          >
            Inspect {level.replaceAll("_", " ")} calibration targets
          </QualityLink>
        ))}
        {context.selection.incumbent &&
        data.attachments.calibration_diagnostics?.status === "available" ? (
          <QualityLink
            href="/microcosm/compare"
            className="text-primary underline"
          >
            Compare shared calibration targets
          </QualityLink>
        ) : null}
      </div>
      <QualityMethodologyNote />
    </div>
  );
}
