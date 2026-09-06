"use client";

// What a declared publisher evidence profile adds to the receipt view: how big
// the slice is, what the accounted quantity actually is, what the source
// reported as against what the model produced, how the three recorded paths
// differ, and -- first, before any of it -- that nothing here measures agreement
// with an external total.
//
// Two rules the whole surface follows. Engineering completion is drawn as
// engineering completion and never borrows the vocabulary of a passing quality
// check: the score is absent and its absence is drawn, not omitted. And every
// identifier stays reachable, in the section it belongs to rather than in one
// shared block of digests at the end, because a reader checking the accounting
// wants the accounting's digests and not the run's.

import type { ReactNode } from "react";

import { StatusPill } from "@/components/shared/status-pill";
import {
  countReading,
  priceBasisReading,
  reportedColumnReading,
  shareOf,
  tokenReading,
} from "@/lib/microcosm/graph/presentation";
import type {
  EvidencePath,
  EvidenceProfileReading,
  ExecutionEdge,
  ReceiptGraphNode,
} from "@/lib/microcosm/graph/types";

/* ---------------------------------------------------------------- pieces */

function Mono({ children }: { children: ReactNode }) {
  return <span className="font-mono text-[11px] break-all">{children}</span>;
}

function Card({
  title,
  lede,
  pills,
  children,
}: {
  title: string;
  lede?: string;
  pills?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="rounded-md border border-border bg-card px-4 py-3">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <h3 className="text-xs font-semibold text-foreground">{title}</h3>
          {lede ? (
            <p className="mt-1 max-w-3xl text-[11px] leading-relaxed text-muted-foreground">
              {lede}
            </p>
          ) : null}
        </div>
        {pills ? <div className="flex flex-wrap gap-1.5">{pills}</div> : null}
      </div>
      <div className="mt-3">{children}</div>
    </section>
  );
}

function Disclosure({ summary, children }: { summary: string; children: ReactNode }) {
  return (
    <details className="mt-3 rounded-md border border-border bg-muted/20 px-3 py-2">
      <summary className="cursor-pointer text-[11px] font-medium text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary">
        {summary}
      </summary>
      <div className="mt-2">{children}</div>
    </details>
  );
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5 py-1">
      <dt className="w-44 shrink-0 text-[11px] text-muted-foreground">{label}</dt>
      <dd className="min-w-[min(100%,12rem)] flex-1 break-words text-[11px] text-foreground">
        {children}
      </dd>
    </div>
  );
}

function Stat({ value, label }: { value: string; label: string }) {
  return (
    <div className="min-w-0 flex-1 px-3 py-2">
      <div className="text-xl font-semibold tabular-nums leading-none text-foreground">
        {value}
      </div>
      <div className="mt-1 text-[10px] font-semibold uppercase leading-tight tracking-[0.1em] text-muted-foreground">
        {label}
      </div>
    </div>
  );
}

/** One hue, five tones. Segment identity never rests on the tone alone: every
 * segment is also named and counted in the legend directly beneath it. */
const TONES = [
  "var(--chart-1)",
  "var(--chart-3)",
  "var(--chart-2)",
  "var(--chart-4)",
  "var(--chart-5)",
];

interface Segment {
  key: string;
  label: string;
  count: number;
}

function Composition({
  segments,
  total,
  caption,
}: {
  segments: Segment[];
  total: number;
  caption: string;
}) {
  const present = segments.filter((segment) => segment.count > 0);
  return (
    <div>
      <div
        className="flex h-2 gap-[2px] overflow-hidden rounded-full bg-muted"
        role="img"
        aria-label={`${caption}. ${segments
          .map((segment) => `${segment.label}: ${countReading(segment.count)}`)
          .join("; ")}.`}
      >
        {present.map((segment) => (
          <span
            key={segment.key}
            className="h-full first:rounded-l-full last:rounded-r-full"
            style={{
              width: `${shareOf(segment.count, total)}%`,
              background: TONES[segments.indexOf(segment) % TONES.length],
            }}
          />
        ))}
      </div>
      <ul className="mt-1.5 flex flex-wrap gap-x-3 gap-y-1">
        {segments.map((segment, index) => (
          <li
            key={segment.key}
            className="inline-flex items-center gap-1.5 text-[11px] text-muted-foreground"
          >
            <span
              aria-hidden
              className="h-2 w-2 shrink-0 rounded-sm"
              style={{
                background: segment.count
                  ? TONES[index % TONES.length]
                  : "var(--border-strong)",
              }}
            />
            <span>{segment.label}</span>
            <span className="font-mono tabular-nums text-foreground">
              {countReading(segment.count)}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/* ------------------------------------------------------------- sections */

function QualityBanner({ profile }: { profile: EvidenceProfileReading }) {
  const { quality } = profile;
  return (
    <section className="rounded-md border pill-warn px-4 py-3">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="text-xs font-semibold">
            Engineering completion. Quality {quality.status}.
          </h3>
          <p className="mt-1 max-w-3xl text-[11px] leading-relaxed">
            {quality.score_reason} {quality.note}
          </p>
        </div>
        <div className="shrink-0 text-right">
          <div className="text-2xl font-semibold leading-none" aria-hidden>
            —
          </div>
          <div className="mt-1 text-[10px] font-semibold uppercase tracking-[0.1em]">
            No score
          </div>
        </div>
      </div>
      <div className="mt-3">
        <div className="text-[11px] font-medium">
          Not measured here, and not measured anywhere this attachment points at
        </div>
        {/* Named in the markup so a browser check can say *which* list a token
            was drawn in. "Unmeasured" and "withheld" are different claims, and
            the one defect this alignment fixed was `prior_wages` sitting in the
            wrong one -- a check that could only count occurrences on the page
            would not have caught it. */}
        <ul data-quality-missing className="mt-1.5 flex flex-wrap gap-x-3 gap-y-1">
          {quality.missing.map((item) => (
            <li key={item} className="inline-flex items-center gap-1.5 text-[11px]">
              <span
                aria-hidden
                className="h-2 w-2 shrink-0 rounded-full border border-current"
              />
              <span>{tokenReading(item)}</span>
            </li>
          ))}
        </ul>
      </div>
      <p className="mt-2 text-[11px] leading-relaxed">
        The basis on record is {tokenReading(quality.basis)}. Nothing below is a
        statement about a population, a national total or a congressional
        district.
      </p>
    </section>
  );
}

/** The three headline entities first, then the rest as published.
 *
 * The publisher emits them alphabetically, which put `family` above `household`
 * directly beneath a stat row reading households, people, tax units. Ordering is
 * presentation; no row is added, dropped or renamed. */
const HEADLINE_ENTITIES = ["household", "person", "tax_unit"];

function orderedEntityRows(rows: { entity: string; rows: number }[]) {
  const rank = (entity: string) => {
    const index = HEADLINE_ENTITIES.indexOf(entity);
    return index === -1 ? HEADLINE_ENTITIES.length : index;
  };
  return [...rows].sort((a, b) => rank(a.entity) - rank(b.entity));
}

function Slice({ profile }: { profile: EvidenceProfileReading }) {
  const { scope } = profile;
  // Present only on the sized profile, where the run recorded what it selected
  // from. Without it the page showed a selection rule and the count it produced,
  // and never the number the rule was applied to.
  const eligible = scope.households_by_source_cohort.filter(
    (cohort) => cohort.eligible_households !== undefined,
  );
  return (
    <Card
      title="The recorded slice"
      lede={scope.note}
      pills={<StatusPill tone="warning">Engineering slice</StatusPill>}
    >
      <div className="flex flex-wrap divide-x divide-border/60 rounded-md border border-border bg-muted/20">
        <Stat value={countReading(scope.households)} label="Households" />
        <Stat value={countReading(scope.persons)} label="People" />
        <Stat value={countReading(scope.tax_units)} label="Tax units" />
      </div>
      <div className="mt-3">
        <div className="text-[11px] font-medium text-foreground">
          Households by source income year
        </div>
        <div className="mt-1.5">
          <Composition
            total={scope.households}
            caption="Households by source income year"
            segments={scope.households_by_source_cohort.map((cohort) => ({
              key: cohort.income_year,
              label: cohort.income_year,
              count: cohort.households,
            }))}
          />
        </div>
      </div>
      {eligible.length === 0 ? null : (
        <div className="mt-2 text-[11px] leading-relaxed text-muted-foreground">
          Eligible before selection:{" "}
          {eligible
            .map(
              (cohort) =>
                `${cohort.income_year}: ${countReading(cohort.eligible_households!)}`,
            )
            .join(" · ")}
        </div>
      )}
      <dl className="mt-3 divide-y divide-border/60">
        {scope.entity_rows === undefined ? null : (
          <Row label="Entity rows">
            {orderedEntityRows(scope.entity_rows)
              .map(
                (row) => `${tokenReading(row.entity)}: ${countReading(row.rows)}`,
              )
              .join(" · ")}
          </Row>
        )}
        <Row label="Money field axes">{countReading(scope.money_field_axes)}</Row>
        <Row label="Housing universe fields">
          {countReading(scope.housing_universe_evidence_fields)} evidence fields ·{" "}
          {countReading(scope.housing_universe_carried_cells)} carried cells
        </Row>
        <Row label="Loaded modules">{countReading(scope.loaded_module_count)}</Row>
        {scope.producer_schema === undefined ? null : (
          <Row label="Producer adapter">
            <span>{tokenReading(scope.producer_schema)}</span>
            {/* The second adapter's name carries "505hh", which reads as a
                sample size beside a stat row saying 41. It is the name of the
                producer whose receipts this export knows how to read, and the
                measured counts above are the size. */}
            <span className="mt-0.5 block text-[11px] text-muted-foreground">
              Names the recorded producer this export reads, not this sample.
            </span>
          </Row>
        )}
      </dl>
      {scope.measurement === undefined ? null : (
        <Measurement measurement={scope.measurement} households={scope.households} />
      )}
    </Card>
  );
}

/** The recorded fraction as a percentage, at the precision it was recorded to.
 *
 * `0.01` is drawn as "1%" and `0.003` as "0.3%"; nothing is rounded away, so a
 * fraction with more digits keeps them. The publisher's own decimal is shown
 * beside the reading, the way the price basis token is, so the reading can be
 * checked rather than taken. */
function fractionReading(fraction: number): string {
  const percent = fraction * 100;
  return `${percent.toPrecision(12).replace(/\.?0+$/, "")}%`;
}

/** How the size was arrived at.
 *
 * The fifteen-household profile never needed this block: its size was a
 * constant the reader also held, so there was nothing to show. A measured size
 * has to be assessable, and a number on its own is not — what makes it
 * assessable is the rule it came out of, the operands that rule was applied to,
 * and how many separate places inside the run wrote the result down. All of them
 * are the publisher's own; nothing here is derived.
 *
 * "Places", not "independent measurements". Two of the places a count appears
 * are one recorded location restated by the warm execution, which shares a
 * computation content key with the cold one and so cannot disagree with it. The
 * publisher counts those apart and this draws them apart. */
function Measurement({
  measurement,
  households,
}: {
  measurement: NonNullable<EvidenceProfileReading["scope"]["measurement"]>;
  households: number;
}) {
  return (
    <div className="mt-4 rounded-md border border-border bg-muted/20 p-3">
      <div className="flex flex-wrap items-center gap-1.5">
        <div className="text-[11px] font-medium text-foreground">
          How this size was measured
        </div>
        <StatusPill tone="neutral">{tokenReading(measurement.basis)}</StatusPill>
      </div>
      <p className="mt-1.5 text-[11px] leading-relaxed text-muted-foreground">
        {measurement.note}
      </p>
      <dl className="mt-2 divide-y divide-border/60">
        <Row label="Selection">
          {/* The rule in words with its operands, then the publisher's own rule
              token beneath it. A reader who cannot audit the size from the page
              has been shown a method rather than evidence. */}
          <span>
            {fractionReading(measurement.sampling_fraction)} of eligible
            households, {tokenReading(measurement.selection_rule_scope)}
          </span>
          <span className="mt-0.5 block text-foreground">
            {countReading(households)} selected from{" "}
            {countReading(measurement.eligible_households)} eligible
          </span>
          <span className="mt-0.5 block text-muted-foreground">
            <Mono>{measurement.selection_rule}</Mono>
          </span>
        </Row>
        {measurement.nesting.length === 0 ? null : (
          <Row label="Units within one household">
            {measurement.nesting
              .map(
                (entry) =>
                  `${tokenReading(entry.entity)}: ${countReading(entry.rows)}`,
              )
              .join(" · ")}
          </Row>
        )}
      </dl>
      {/* A table would be the right semantic form here, but the location names
        * are long unbroken tokens and a three-column layout pushes the whole
        * card past a 390px viewport. Each entry is one fact, so a definition
        * list carries the same structure and wraps. The names themselves sit
        * behind a disclosure: they are the run's internal field paths, and a
        * reader checking the size wants the counts first. */}
      <dl className="mt-2 divide-y divide-border/60">
        {measurement.recorded_count_locations.map((entry) => (
          <div key={entry.fact} className="py-1.5">
            <dt className="flex flex-wrap items-baseline gap-x-2 text-[11px] text-foreground">
              <span className="font-medium">{tokenReading(entry.fact)}</span>
              <span className="tabular-nums">{countReading(entry.count)}</span>
              <span className="text-muted-foreground">
                recorded in{" "}
                {entry.locations === 1
                  ? "1 place"
                  : `${countReading(entry.locations)} places`}
                {entry.phase_restatements === 0
                  ? null
                  : `, restated ${countReading(entry.phase_restatements)}× by the warm execution`}
              </span>
            </dt>
          </div>
        ))}
      </dl>
      <Disclosure summary="Where each count was recorded">
        <dl className="divide-y divide-border/60">
          {measurement.recorded_count_locations.map((entry) => (
            <div key={entry.fact} className="py-1.5">
              <dt className="text-[11px] font-medium text-foreground">
                {tokenReading(entry.fact)}
              </dt>
              <dd className="mt-0.5 break-words text-[11px] leading-relaxed text-muted-foreground">
                {entry.sources.join(" · ")}
              </dd>
            </div>
          ))}
        </dl>
      </Disclosure>
    </div>
  );
}

function ReportedIncome({ profile }: { profile: EvidenceProfileReading }) {
  const reported = profile.reported_income;
  const { basis } = reported;
  return (
    <Card
      title="Reported source income, as accounted"
      lede={basis.note}
      pills={
        <>
          <StatusPill tone="neutral">{tokenReading(basis.measure)}</StatusPill>
          <StatusPill tone="neutral">
            {priceBasisReading(basis.price_basis, basis.price_target_year)}
          </StatusPill>
        </>
      }
    >
      <dl className="divide-y divide-border/60">
        <Row label="Nominal source">
          {tokenReading(basis.nominal_source)}
        </Row>
        {/* The series in words, then the publisher's own token, then the digest
            of the contract file the accounting node records having converted
            with. The reading is this dashboard's; the token and the digest are
            the publisher's, and both are shown so the reading can be checked
            rather than taken. */}
        <Row label="Price basis">
          <span>{priceBasisReading(basis.price_basis, basis.price_target_year)}</span>
          <span className="mt-0.5 block font-mono text-[11px] break-all text-muted-foreground">
            {basis.price_basis}
          </span>
          <span className="mt-0.5 block font-mono text-[11px] break-all text-muted-foreground">
            {basis.price_basis_resource_sha256}
          </span>
        </Row>
        <Row label="Reference period">
          {tokenReading(basis.reference_period)}
        </Row>
        <Row label="Accounting body">
          {countReading(reported.rows)} rows ·{" "}
          {countReading(reported.accounting_column_count)} columns ·{" "}
          {countReading(reported.accounting_row_bytes)} bytes a row
        </Row>
      </dl>

      <div className="mt-3">
        <div className="text-[11px] font-medium text-foreground">
          The order the amounts were combined in
        </div>
        <ul className="mt-1.5 flex flex-wrap gap-1.5">
          {reported.arithmetic_statements.map((statement) => (
            <li
              key={statement}
              className="rounded-md border border-border bg-muted/30 px-2 py-1 font-mono text-[11px] break-all text-foreground"
            >
              {statement}
            </li>
          ))}
        </ul>
      </div>

      <div className="mt-4">
        <div className="text-[11px] font-medium text-foreground">
          Result columns, and how their {countReading(reported.rows)} accounted
          values are signed
        </div>
        <p className="mt-1 text-[11px] leading-relaxed text-muted-foreground">
          Each name below is shown without the{" "}
          <span className="font-mono">asec_reported_</span> prefix and the{" "}
          <span className="font-mono">_2024_price</span> suffix every one of them
          carries; the full identifier is beside it. The unallocated column is{" "}
          {tokenReading(basis.residual_meaning)}.
        </p>
        <ul className="mt-2 flex flex-col gap-3">
          {reported.results.map((result) => (
            <li key={result.column}>
              <div className="flex flex-wrap items-baseline justify-between gap-x-3">
                <span className="text-[11px] font-medium text-foreground">
                  {reportedColumnReading(result.column)}
                </span>
                <Mono>{result.column}</Mono>
              </div>
              <div className="mt-1.5">
                <Composition
                  total={reported.rows}
                  caption={`Signed values in ${result.column}`}
                  segments={[
                    { key: "positive", label: "positive", count: result.positive },
                    { key: "zero", label: "zero", count: result.zero },
                    { key: "negative", label: "negative", count: result.negative },
                  ]}
                />
              </div>
            </li>
          ))}
        </ul>
      </div>

      <div className="mt-4">
        <div className="text-[11px] font-medium text-foreground">
          Where a zero came from, by source income year
        </div>
        <p className="mt-1 text-[11px] leading-relaxed text-muted-foreground">
          A zero amount and an absent one are different readings, and the
          publisher keeps them apart. These are the classes it recorded.
        </p>
        <ul className="mt-2 flex flex-col gap-3">
          {reported.zero_origin.map((year) => (
            <li key={year.income_year}>
              <div className="flex flex-wrap items-baseline justify-between gap-x-3">
                <span className="text-[11px] font-medium text-foreground">
                  {year.income_year}
                </span>
                <span className="text-[11px] tabular-nums text-muted-foreground">
                  {countReading(year.total)} classified
                </span>
              </div>
              <div className="mt-1.5">
                <Composition
                  total={year.total}
                  caption={`Zero origin classes in ${year.income_year}`}
                  segments={year.classes.map((entry) => ({
                    key: entry.key,
                    label: tokenReading(entry.key),
                    count: entry.count,
                  }))}
                />
              </div>
            </li>
          ))}
        </ul>
      </div>

      <div className="mt-4">
        <div className="text-[11px] font-medium text-foreground">
          Withheld, and stated as withheld
        </div>
        <ul data-not-claimed className="mt-1.5 flex flex-wrap gap-1.5">
          {reported.not_claimed.map((claim) => (
            <li
              key={claim}
              className="inline-flex items-center gap-1.5 rounded-full border border-border bg-muted/30 px-2.5 py-0.5 text-[11px] text-muted-foreground"
            >
              <span
                aria-hidden
                className="h-1.5 w-1.5 rounded-full border border-current"
              />
              {tokenReading(claim)}
            </li>
          ))}
        </ul>
      </div>

      <Disclosure summary="Column identifiers and evidence digests">
        <dl className="divide-y divide-border/60">
          <Row label="Typed evidence axes">
            {countReading(reported.typed_evidence_axis_count)}
          </Row>
          <Row label="Raw public assistance evidence">
            {countReading(reported.raw_public_assistance_evidence_count)}
          </Row>
          <Row label="Alternative association">
            {reported.alternative_association_differs
              ? "Recorded, and differs from the association above."
              : "Recorded, and agrees with the association above."}{" "}
            <Mono>{reported.alternative_association_sha256}</Mono>
          </Row>
          {reported.results.map((result) => (
            <Row key={result.column} label={reportedColumnReading(result.column)}>
              <Mono>{result.sha256}</Mono>
            </Row>
          ))}
        </dl>
        <div className="mt-2 text-[11px] font-medium text-foreground">
          All {countReading(reported.accounting_column_count)} accounting columns
        </div>
        <ul className="mt-1 flex flex-col gap-0.5">
          {reported.columns.map((column) => (
            <li
              key={column.name}
              className="flex flex-wrap items-baseline gap-x-2 text-[11px]"
            >
              <span className="min-w-0 break-all font-mono text-foreground">
                {column.name}
              </span>
              <span className="text-muted-foreground">{column.dtype}</span>
              <Mono>{column.sha256}</Mono>
            </li>
          ))}
        </ul>
      </Disclosure>
    </Card>
  );
}

function SourceAgainstModel({
  profile,
  nodes,
  edges,
}: {
  profile: EvidenceProfileReading;
  nodes: ReceiptGraphNode[];
  edges: ExecutionEdge[];
}) {
  const engine = nodes.find((node) =>
    node.typed_outputs.some((output) => output.artifact === "engine_evaluation"),
  );
  const accounting = nodes.find((node) =>
    node.typed_outputs.some((output) => output.artifact === "reported_income"),
  );
  const linked =
    engine && accounting
      ? edges.some((edge) => edge.from === engine.id && edge.to === accounting.id)
      : false;
  return (
    <Card
      title="What the source reported, and what the model produced"
      lede="Two recorded things, kept apart. This attachment publishes no comparison between them, and none is drawn."
    >
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="rounded-md border border-border bg-muted/20 px-3 py-2">
          <div className="text-[11px] font-semibold text-foreground">
            Reported by the source
          </div>
          <p className="mt-1 text-[11px] leading-relaxed text-muted-foreground">
            The accounted quantity is {tokenReading(profile.reported_income.basis.measure)},
            taken from {tokenReading(profile.reported_income.basis.nominal_source)}.
          </p>
          {accounting ? (
            <p className="mt-1 text-[11px] text-muted-foreground">
              Recorded by <Mono>{accounting.id}</Mono>.
            </p>
          ) : null}
        </div>
        <div className="rounded-md border border-border bg-muted/20 px-3 py-2">
          <div className="text-[11px] font-semibold text-foreground">
            Produced by the model
          </div>
          <p className="mt-1 text-[11px] leading-relaxed text-muted-foreground">
            The engine evaluation is a separate recorded artifact. This view
            carries its byte identity and nothing about its values.
          </p>
          {engine ? (
            <p className="mt-1 text-[11px] text-muted-foreground">
              Recorded by <Mono>{engine.id}</Mono>.
            </p>
          ) : null}
        </div>
      </div>
      <p className="mt-3 rounded-md border border-border bg-muted/30 px-3 py-2 text-[11px] leading-relaxed text-muted-foreground">
        {engine && accounting
          ? linked
            ? "The accounting step declares a typed artifact from the engine step, so the two are connected in the recorded graph."
            : "No recorded typed artifact runs from the engine step to the accounting step, so the accounted amounts in this run were not built from the engine's evaluation."
          : "This run does not record both an engine evaluation and a reported-income accounting, so no relationship between them is shown."}{" "}
        Nothing here compares the two: fit, model validation and national totals
        are on the not-measured list above, and simulated benefit amounts are on
        the withheld list.
      </p>
    </Card>
  );
}

function PathRow({ path }: { path: EvidencePath }) {
  return (
    <div className="rounded-md border border-border bg-muted/20 px-3 py-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="text-[11px] font-semibold text-foreground">
          {path.label}
        </span>
        <StatusPill tone={path.graph_execution ? "info" : "neutral"}>
          {path.graph_execution ? "Graph execution" : "Not a graph execution"}
        </StatusPill>
      </div>
      <p className="mt-1 text-[11px] leading-relaxed text-muted-foreground">
        {path.description}
      </p>
      <dl className="mt-1.5 divide-y divide-border/60">
        <Row label="Kernel calls">
          {path.kernel_calls === null
            ? "Not recorded: no graph kernel ran on this path."
            : countReading(path.kernel_calls)}
        </Row>
        <Row label="Source preparations">
          {countReading(path.source_preparation_calls)}
        </Row>
        <Row label="Served from cache">
          {path.cache_hit_count === null ? "—" : countReading(path.cache_hit_count)}
        </Row>
        {path.reported_income_rows === null ? null : (
          <Row label="Accounted rows">{countReading(path.reported_income_rows)}</Row>
        )}
      </dl>
      <Disclosure summary={`${path.label} identifiers`}>
        <dl className="divide-y divide-border/60">
          <Row label="Receipt">
            <Mono>{path.receipt_sha256}</Mono>
          </Row>
          <Row label="Execution manifest">
            {path.execution_manifest_sha256 === null ? (
              "None: this path recorded no execution manifest."
            ) : (
              <Mono>{path.execution_manifest_sha256}</Mono>
            )}
          </Row>
          <Row label="Content key">
            {path.computation_content_key === null ? (
              "None: this path recorded no computation content key."
            ) : (
              <Mono>{path.computation_content_key}</Mono>
            )}
          </Row>
          <Row label="Accounting payload">
            <Mono>{path.reported_income_payload_sha256}</Mono>
          </Row>
          <Row label="Accounting body">
            <Mono>{path.reported_income_body_sha256}</Mono>
          </Row>
        </dl>
      </Disclosure>
    </div>
  );
}

function Paths({ profile }: { profile: EvidenceProfileReading }) {
  return (
    <Card
      title="Three recorded paths"
      lede="The same work recorded three ways. The direct path is the comparison, not a third execution: it records no execution manifest and no cache reading."
    >
      <div className="grid gap-3 lg:grid-cols-3">
        {profile.paths.map((path) => (
          <PathRow key={path.key} path={path} />
        ))}
      </div>
    </Card>
  );
}

function Divergence({ profile }: { profile: EvidenceProfileReading }) {
  const { path_output_identities, lineage_divergence } = profile;
  return (
    <Card
      title="Where the direct and graph paths differ"
      lede={path_output_identities.note}
    >
      <div className="flex flex-col gap-2">
        {path_output_identities.artifacts.map((artifact) => (
          <div
            key={artifact.key}
            className="rounded-md border border-border bg-muted/20 px-3 py-2"
          >
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="text-[11px] font-semibold text-foreground">
                {tokenReading(artifact.key)}
              </span>
              <StatusPill tone={artifact.differs ? "warning" : "info"}>
                {artifact.differs
                  ? "Separately encoded bytes"
                  : "Same bytes on both paths"}
              </StatusPill>
            </div>
            <dl className="mt-1 divide-y divide-border/60">
              <Row label="Direct path">
                <Mono>{artifact.direct_sha256}</Mono>
              </Row>
              <Row label="Graph paths">
                <Mono>{artifact.graph_sha256}</Mono>
              </Row>
              {artifact.body_sha256 === null ? null : (
                <Row label="Body, on every path">
                  <Mono>{artifact.body_sha256}</Mono>
                </Row>
              )}
            </dl>
          </div>
        ))}
      </div>
      <div className="mt-3 rounded-md border border-border bg-muted/20 px-3 py-2">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <span className="text-[11px] font-semibold text-foreground">
            Lineage identities that differ
          </span>
          <StatusPill tone="neutral">
            {countReading(lineage_divergence.count)} fields
          </StatusPill>
        </div>
        <ul className="mt-1.5 flex flex-wrap gap-1.5">
          {lineage_divergence.fields.map((field) => (
            <li
              key={field}
              className="rounded-md border border-border bg-card px-2 py-0.5 font-mono text-[11px] break-all text-foreground"
            >
              {field}
            </li>
          ))}
        </ul>
        <p className="mt-1.5 text-[11px] leading-relaxed text-muted-foreground">
          {lineage_divergence.note}
        </p>
      </div>
    </Card>
  );
}

/* --------------------------------------------------------------- surface */

export function IncomeEvidenceProfile({
  profile,
  nodes,
  edges,
}: {
  profile: EvidenceProfileReading;
  nodes: ReceiptGraphNode[];
  edges: ExecutionEdge[];
}) {
  return (
    // Named on the element, so a browser check can read what this profile says
    // without also reading the site chrome around it.
    <div className="flex flex-col gap-3" data-evidence-profile={profile.id}>
      <QualityBanner profile={profile} />
      <div className="grid gap-3 xl:grid-cols-2">
        <Slice profile={profile} />
        <SourceAgainstModel profile={profile} nodes={nodes} edges={edges} />
      </div>
      <ReportedIncome profile={profile} />
      <Paths profile={profile} />
      <Divergence profile={profile} />
      <Card
        title="What this profile is"
        lede="The publisher declared a named evidence profile, and this reader checked every field it adds against that profile's own closed tables before drawing any of it."
      >
        <dl className="divide-y divide-border/60">
          <Row label="Profile">
            <Mono>{profile.id}</Mono>
          </Row>
          {profile.identities.map((identity) => (
            <Row key={identity.key} label={tokenReading(identity.key)}>
              <Mono>{identity.sha256}</Mono>
            </Row>
          ))}
        </dl>
      </Card>
    </div>
  );
}
