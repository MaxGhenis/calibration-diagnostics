"use client";

// The receipt view for one immutable candidate: an output-first list of the
// steps a run actually recorded, a canvas of the dependencies those receipts
// actually declare, and an inspector for whichever step is selected.
//
// Three things this surface is careful about, because the evidence is careful
// about them. Execution, cache and gate are read separately, and a failure, a
// blocked step or an absent receipt outranks the presence of an output key. A
// gate covers its own declared scope and nothing else in the run. And a
// dependency is drawn only where a receipt declared the typed artifact it
// consumed, so the graph says out loud that it is partial.

import dynamic from "next/dynamic";
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useSearchParams } from "next/navigation";

import { useQualityContext } from "@/components/layout/quality-context";
import { EmptyState } from "@/components/shared/empty-state";
import { StatusPill } from "@/components/shared/status-pill";
import { useReceiptGraph } from "@/lib/api/hooks/use-receipt-graph";
import {
  graphSelectionReadiness,
  graphSelectionUrl,
  nextStep,
  resolveGraphSelection,
  type StepMove,
} from "@/lib/microcosm/graph/navigation";
import {
  cacheReading,
  executionReading,
  formatMeasure,
  gateReading,
  neighbours,
  outputReading,
  releaseEligibilityReading,
  selectionNotice,
  stateFor,
  type AxisReading,
} from "@/lib/microcosm/graph/presentation";
import type {
  ReceiptGraphAvailable,
  ReceiptGraphNode,
} from "@/lib/microcosm/graph/types";

const ReceiptGraphCanvas = dynamic(
  () => import("@/components/microcosm/receipt-graph-canvas"),
  {
    ssr: false,
    loading: () => (
      <div className="flex h-[420px] w-full items-center justify-center rounded-md border border-border bg-card/60 text-xs text-muted-foreground sm:h-[460px]">
        Drawing recorded dependencies…
      </div>
    ),
  },
);

/* ---------------------------------------------------------------- helpers */

function Axis({ reading }: { reading: AxisReading }) {
  return (
    <StatusPill tone={reading.tone}>
      <span title={reading.help}>{reading.label}</span>
    </StatusPill>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5 py-1">
      <dt className="w-40 shrink-0 text-xs text-muted-foreground">{label}</dt>
      <dd className="min-w-0 flex-1 break-all text-xs text-foreground">{children}</dd>
    </div>
  );
}

function Mono({ children }: { children: ReactNode }) {
  return <span className="font-mono text-[11px] break-all">{children}</span>;
}

function Disclosure({
  summary,
  children,
}: {
  summary: string;
  children: ReactNode;
}) {
  return (
    <details className="rounded-md border border-border bg-muted/20 px-3 py-2">
      <summary className="cursor-pointer text-xs font-medium text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary">
        {summary}
      </summary>
      <div className="mt-2">{children}</div>
    </details>
  );
}

/* ------------------------------------------------------------------ list */

interface StepListProps {
  nodes: ReceiptGraphNode[];
  mode: string;
  selectedId: string;
  onSelect: (id: string) => void;
  registerRef: (id: string, element: HTMLButtonElement | null) => void;
  onKeyDown: (event: React.KeyboardEvent, id: string) => void;
}

function StepList({
  nodes,
  mode,
  selectedId,
  onSelect,
  registerRef,
  onKeyDown,
}: StepListProps) {
  if (!nodes.length) return null;
  return (
    <ul className="flex flex-col gap-1.5">
      {nodes.map((node) => {
        const state = stateFor(node, mode);
        const execution = executionReading(state.execution);
        const cache = cacheReading(state.cache);
        const selected = node.id === selectedId;
        return (
          <li key={node.id}>
            <button
              type="button"
              ref={(element) => registerRef(node.id, element)}
              aria-current={selected ? "true" : undefined}
              onClick={() => onSelect(node.id)}
              onKeyDown={(event) => onKeyDown(event, node.id)}
              className={`w-full rounded-md border px-3 py-2 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary ${
                selected
                  ? "border-primary bg-primary/5"
                  : "border-border bg-card hover:bg-muted/40"
              }`}
            >
              <span className="block truncate text-xs font-semibold text-foreground">
                {node.label}
              </span>
              <span className="mt-0.5 block truncate font-mono text-[10px] text-muted-foreground">
                {node.id}
              </span>
              <span className="mt-1 flex flex-wrap items-center gap-1 text-[10px] text-muted-foreground">
                <span>{node.group_label}</span>
                <span aria-hidden>·</span>
                <span>{execution.label}</span>
                <span aria-hidden>·</span>
                <span>{cache.label}</span>
              </span>
            </button>
          </li>
        );
      })}
    </ul>
  );
}

/* ------------------------------------------------------------- inspector */

function Inspector({
  payload,
  node,
  mode,
  onSelect,
  onClose,
}: {
  payload: ReceiptGraphAvailable;
  node: ReceiptGraphNode | undefined;
  mode: string;
  onSelect: (id: string) => void;
  onClose: () => void;
}) {
  if (!node)
    return (
      <div className="rounded-md border border-dashed border-border bg-muted/20 px-4 py-6 text-xs leading-relaxed text-muted-foreground">
        Choose a step to read its receipt: what it consumed, what it recorded,
        whether this execution computed it or reused a cached result, and the
        identifiers behind each of those.
      </div>
    );

  const state = stateFor(node, mode);
  const hop = neighbours(payload.edges, node.id);
  const byId = new Map(payload.nodes.map((entry) => [entry.id, entry]));
  const label = (id: string) => byId.get(id)?.label ?? id;

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="text-sm font-semibold leading-tight text-foreground">
            {node.label}
          </div>
          <div className="mt-0.5 break-all font-mono text-[11px] text-muted-foreground">
            {node.id}
          </div>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="shrink-0 rounded-md border border-border px-2 py-1 text-[11px] text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
        >
          Close
        </button>
      </div>

      <div className="flex flex-wrap gap-1.5">
        <Axis reading={executionReading(state.execution)} />
        <Axis reading={cacheReading(state.cache)} />
        <Axis reading={gateReading(state.gate)} />
        <Axis reading={outputReading(state)} />
      </div>
      <p className="text-xs leading-relaxed text-muted-foreground">
        {state.outputs_reason}
      </p>
      {node.identity_differs ? (
        <p className="rounded-md border pill-warn px-3 py-2 text-xs leading-relaxed">
          The recorded executions do not agree about this step&apos;s own
          identity. Both readings are kept below rather than merged.
        </p>
      ) : null}
      {node.unconnected ? (
        <p className="rounded-md border border-border bg-muted/30 px-3 py-2 text-xs leading-relaxed text-muted-foreground">
          This receipt declares no typed artifact, so nothing in the saved run
          manifests connects it to another step. It is shown as a record, not
          placed in the flow.
        </p>
      ) : null}

      {hop.builtFrom.length || hop.usedBy.length ? (
        <div className="flex flex-col gap-2">
          {(
            [
              ["Built from", hop.builtFrom],
              ["Used by", hop.usedBy],
            ] as const
          ).map(([heading, ids]) =>
            ids.length ? (
              <div key={heading}>
                <div className="text-xs font-medium text-foreground">{heading}</div>
                <div className="mt-1 flex flex-wrap gap-1.5">
                  {ids.map((id) => (
                    <button
                      key={id}
                      type="button"
                      onClick={() => onSelect(id)}
                      className="rounded-md border border-border bg-card px-2 py-1 text-[11px] text-foreground hover:bg-muted/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                    >
                      {label(id)}
                    </button>
                  ))}
                </div>
              </div>
            ) : null,
          )}
        </div>
      ) : null}

      {node.typed_inputs.length ? (
        <div>
          <div className="text-xs font-medium text-foreground">Recorded inputs</div>
          <dl className="mt-1 divide-y divide-border/60">
            {node.typed_inputs.map((input) => (
              <Field key={input.name} label={input.name}>
                {input.type} v{input.type_version} · from{" "}
                <Mono>{input.producer ?? "—"}</Mono>
              </Field>
            ))}
          </dl>
        </div>
      ) : null}

      {node.typed_outputs.length ? (
        <div>
          <div className="text-xs font-medium text-foreground">Recorded outputs</div>
          <dl className="mt-1 divide-y divide-border/60">
            {node.typed_outputs.map((output) => (
              <Field key={output.name} label={output.name}>
                {output.type} v{output.type_version}
              </Field>
            ))}
          </dl>
        </div>
      ) : null}

      {node.measures.length ? (
        <div>
          <div className="text-xs font-medium text-foreground">From the receipt</div>
          <dl className="mt-1 divide-y divide-border/60">
            {node.measures.map((measure) => (
              <Field key={measure.key} label={measure.label}>
                {formatMeasure(measure.value)}
              </Field>
            ))}
          </dl>
        </div>
      ) : null}

      {state.gate_record ? (
        <div className="rounded-md border border-border bg-muted/20 px-3 py-2">
          <div className="text-xs font-medium text-foreground">Gate record</div>
          <dl className="mt-1 divide-y divide-border/60">
            <Field label="Outcome">{state.gate_record.outcome ?? "—"}</Field>
            <Field label="Declared scope">{state.gate_record.scope ?? "—"}</Field>
          </dl>
          {state.gate_record.checks.map((check) => (
            <div key={check.name} className="mt-2">
              <div className="font-mono text-[11px] text-foreground">{check.name}</div>
              <dl className="divide-y divide-border/60">
                {check.details.map((detail) => (
                  <Field key={detail.key} label={detail.key}>
                    {formatMeasure(detail.value)}
                  </Field>
                ))}
              </dl>
              {check.failures.length ? (
                <ul className="mt-1 list-disc pl-4 text-[11px] text-[var(--neg)]">
                  {check.failures.map((failure) => (
                    <li key={failure}>{failure}</li>
                  ))}
                </ul>
              ) : null}
            </div>
          ))}
          <p className="mt-2 text-[11px] leading-relaxed text-muted-foreground">
            This verdict covers the scope named above. It says nothing about any
            other step in the run.
          </p>
        </div>
      ) : null}

      {node.source_pins.length ? (
        <div>
          <div className="text-xs font-medium text-foreground">Source files pinned</div>
          <dl className="mt-1 divide-y divide-border/60">
            {node.source_pins.map((pin) => (
              <Field key={pin.key} label={pin.label}>
                <Mono>{pin.sha256}</Mono>
              </Field>
            ))}
          </dl>
        </div>
      ) : null}

      <Disclosure summary="Identifiers and pins">
        <dl className="divide-y divide-border/60">
          {node.states.map((entry) => (
            <Field key={entry.mode} label={`Node key · ${entry.mode}`}>
              <Mono>{entry.node_key ?? "—"}</Mono>
            </Field>
          ))}
          <Field label="Kernel">{node.kernel_ref ?? "—"}</Field>
          <Field label="Implementation">
            <Mono>{node.kernel_impl_hash ?? "—"}</Mono>
          </Field>
          <Field label="Determinism">
            {node.determinism ?? "—"} · numeric {node.numeric ?? "—"} · tolerance{" "}
            {node.tolerance === null ? "none" : String(node.tolerance)}
          </Field>
          <Field label="Seed">
            <Mono>{node.seed ?? "—"}</Mono>
          </Field>
          <Field label="Libraries">
            {node.runtime_dependencies.join(", ") || "—"}
          </Field>
          {node.typed_inputs.map((input) => (
            <Field key={`in:${input.name}`} label={`Input key · ${input.name}`}>
              <Mono>{input.artifact_key ?? "—"}</Mono>
            </Field>
          ))}
          {node.typed_outputs.map((output) => (
            <Field key={`out:${output.name}`} label={`Output key · ${output.name}`}>
              <Mono>{output.artifact_key ?? "—"}</Mono>
            </Field>
          ))}
          {node.opaque_artifact_keys.map((entry) => (
            <Field key={`opaque:${entry.name}`} label={`Stored bytes · ${entry.name}`}>
              <Mono>{entry.key}</Mono>
            </Field>
          ))}
          {node.states.map((entry) =>
            entry.frame_key ? (
              <Field key={`frame:${entry.mode}`} label={`Frame key · ${entry.mode}`}>
                <Mono>{entry.frame_key}</Mono>
              </Field>
            ) : null,
          )}
          {node.states.map((entry) =>
            entry.weight_key ? (
              <Field key={`weight:${entry.mode}`} label={`Weight key · ${entry.mode}`}>
                <Mono>{entry.weight_key}</Mono>
              </Field>
            ) : null,
          )}
          <Field label="Column artifacts">
            {node.column_artifact_total
              ? `${node.column_artifact_total.toLocaleString("en-US")} across ${node.column_artifact_counts
                  .map((entry) => `${entry.entity} ${entry.count}`)
                  .join(", ")}`
              : "none"}
          </Field>
          {node.states.map((entry) => (
            <Field key={`time:${entry.mode}`} label={`Elapsed · ${entry.mode}`}>
              {entry.wall_time_seconds === null
                ? "—"
                : `${entry.wall_time_seconds.toFixed(3)} s`}
            </Field>
          ))}
        </dl>
      </Disclosure>
    </div>
  );
}

/* --------------------------------------------------------------- surface */

export interface ReceiptGraphSurfaceProps {
  payload: ReceiptGraphAvailable;
  mode: string;
  selectedId: string;
  onModeChange: (mode: string) => void;
  onSelect: (id: string) => void;
  onClearSelection: () => void;
  reducedMotion?: boolean;
  /** Injected so the surface can be rendered and tested without a canvas. */
  canvas?: ReactNode;
}

export function ReceiptGraphSurface({
  payload,
  mode,
  selectedId,
  onModeChange,
  onSelect,
  onClearSelection,
  reducedMotion = false,
  canvas,
}: ReceiptGraphSurfaceProps) {
  const [filter, setFilter] = useState("");
  const itemRefs = useRef<Record<string, HTMLButtonElement | null>>({});
  const registerRef = useCallback((id: string, element: HTMLButtonElement | null) => {
    itemRefs.current[id] = element;
  }, []);

  const needle = filter.trim().toLowerCase();
  const visible = payload.nodes.filter(
    (node) =>
      !needle ||
      node.id.toLowerCase().includes(needle) ||
      node.label.toLowerCase().includes(needle),
  );
  const connected = visible.filter((node) => !node.unconnected);
  const unconnected = visible.filter((node) => node.unconnected);
  const order = [...connected, ...unconnected].map((node) => node.id);
  const selected = payload.nodes.find((node) => node.id === selectedId);

  const move = (id: string, delta: StepMove) => {
    const target = nextStep(order, id, delta);
    if (!target) return;
    onSelect(target);
    itemRefs.current[target]?.focus();
  };

  const onItemKeyDown = (event: React.KeyboardEvent, id: string) => {
    const handlers: Record<string, () => void> = {
      ArrowDown: () => move(id, 1),
      ArrowUp: () => move(id, -1),
      Home: () => move(id, "first"),
      End: () => move(id, "last"),
    };
    const handler = handlers[event.key];
    if (!handler) return;
    event.preventDefault();
    handler();
  };

  // Escape anywhere in the surface drops the selection and puts focus back on
  // the step it was on, so the reader never loses their place to <body>.
  const onSurfaceKeyDown = (event: React.KeyboardEvent) => {
    if (event.key !== "Escape" || !selectedId) return;
    event.stopPropagation();
    const restore = itemRefs.current[selectedId];
    onClearSelection();
    restore?.focus();
  };

  const active = payload.executions.find((execution) => execution.mode === mode);
  const canvasLabel = `Recorded artifact dependencies: ${payload.coverage.recorded_edges} links between ${payload.coverage.connected_nodes} of ${payload.nodes.length} receipts. The step list beside this canvas carries the same information.`;

  return (
    <div className="flex flex-col gap-4" onKeyDown={onSurfaceKeyDown}>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <fieldset className="flex flex-wrap items-center gap-2">
          <legend className="sr-only">Recorded execution</legend>
          <span className="text-xs font-medium text-muted-foreground">Execution</span>
          {payload.executions.map((execution) => (
            <button
              key={execution.mode}
              type="button"
              aria-pressed={execution.mode === mode}
              onClick={() => onModeChange(execution.mode)}
              className={`rounded-md border px-2.5 py-1 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary ${
                execution.mode === mode
                  ? "border-primary bg-primary/10 text-foreground"
                  : "border-border bg-card text-muted-foreground hover:bg-muted/40"
              }`}
            >
              {execution.label}
            </button>
          ))}
        </fieldset>
        <div className="flex flex-wrap items-center gap-1.5">
          <StatusPill tone={payload.coverage.complete ? "info" : "warning"}>
            {payload.coverage.complete
              ? "Full recorded coverage"
              : `Partial graph · ${payload.coverage.connected_nodes} of ${payload.nodes.length} connected`}
          </StatusPill>
          <StatusPill tone="neutral">
            {payload.candidate.execution_status} execution
          </StatusPill>
          <StatusPill
            tone={
              payload.candidate.release_eligibility.status === "eligible"
                ? "info"
                : "warning"
            }
          >
            {releaseEligibilityReading(
              payload.candidate.release_eligibility.status,
            )}
          </StatusPill>
        </div>
      </div>

      {active ? (
        <p className="text-xs leading-relaxed text-muted-foreground">
          {active.description} {active.computed_count} of {active.receipt_count}{" "}
          receipts were computed here and {active.cache_hit_count} were served
          from cache.
        </p>
      ) : null}

      <div className="grid gap-4 xl:grid-cols-[minmax(196px,240px)_minmax(0,1fr)_minmax(248px,312px)]">
        <div className="order-1 flex min-w-0 flex-col gap-2">
          <label className="flex flex-col gap-1">
            <span className="text-xs font-medium text-foreground">
              Steps, output first
            </span>
            <input
              type="search"
              value={filter}
              onChange={(event) => setFilter(event.target.value)}
              placeholder="Filter by name or id"
              className="h-8 rounded-md border border-border bg-background px-2 text-xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
            />
          </label>
          <StepList
            nodes={connected}
            mode={mode}
            selectedId={selectedId}
            onSelect={onSelect}
            registerRef={registerRef}
            onKeyDown={onItemKeyDown}
          />
          {unconnected.length ? (
            <>
              <div className="mt-1 text-[11px] font-medium uppercase tracking-[0.06em] text-muted-foreground">
                No recorded dependency
              </div>
              <StepList
                nodes={unconnected}
                mode={mode}
                selectedId={selectedId}
                onSelect={onSelect}
                registerRef={registerRef}
                onKeyDown={onItemKeyDown}
              />
            </>
          ) : null}
          {!visible.length ? (
            <p className="text-xs text-muted-foreground">
              No step matches that filter.
            </p>
          ) : null}
        </div>

        <div className="order-3 min-w-0 xl:order-2">
          {canvas ?? (
            <ReceiptGraphCanvas
              nodes={payload.nodes}
              edges={payload.edges}
              mode={mode}
              selectedId={selectedId}
              onSelect={onSelect}
              reducedMotion={reducedMotion}
              ariaLabel={canvasLabel}
            />
          )}
          <p className="mt-2 text-[11px] leading-relaxed text-muted-foreground">
            {payload.coverage.reason}
          </p>
        </div>

        <div className="order-2 min-w-0 xl:order-3">
          <Inspector
            payload={payload}
            node={selected}
            mode={mode}
            onSelect={onSelect}
            onClose={() => {
              const restore = itemRefs.current[selectedId];
              onClearSelection();
              restore?.focus();
            }}
          />
        </div>
      </div>

      <div className="grid gap-3 lg:grid-cols-2">
        <div className="rounded-md border border-border bg-card px-4 py-3">
          <div className="text-xs font-semibold text-foreground">
            {payload.comparison.title}
          </div>
          <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
            {payload.comparison.content_key_note}
          </p>
          {/* The two manifest digests below are what tells the executions
              apart, and nothing the publisher attached pins either of them.
              That qualification belongs beside the claim, not only in the
              limits further down. */}
          <p className="mt-1 text-[11px] leading-relaxed text-muted-foreground">
            {payload.comparison.execution_note}
          </p>
          <dl className="mt-2 divide-y divide-border/60">
            <Field label="Content key">
              <Mono>{payload.comparison.content_key}</Mono>
            </Field>
            {payload.executions.map((execution) => (
              <Field key={execution.mode} label={`${execution.label} manifest`}>
                <Mono>{execution.manifest_sha256}</Mono>
              </Field>
            ))}
            <Field label="Outputs">
              {payload.comparison.output_identity.identical
                ? `Identical across every recorded execution: ${payload.comparison.output_identity.compared_artifacts} recorded artifact keys over ${payload.comparison.output_identity.compared_nodes} receipts.`
                : `${payload.comparison.output_identity.differences.length} differences across ${payload.comparison.output_identity.compared_nodes} receipts.`}
            </Field>
            <Field label="Kernel calls">
              {payload.executions
                .map((execution) => `${execution.label} ${execution.computed_count}`)
                .join(" · ")}
            </Field>
          </dl>
          {payload.comparison.output_identity.differences.length ? (
            <ul className="mt-2 list-disc pl-4 text-[11px] text-[var(--warn)]">
              {payload.comparison.output_identity.differences.map((difference) => (
                <li key={`${difference.id}:${difference.field}`}>
                  {difference.id} · {difference.field}
                </li>
              ))}
            </ul>
          ) : null}
          {payload.comparison.cache_differences.length ? (
            <div className="mt-2">
              <div className="text-xs font-medium text-foreground">
                Where the executions differ
              </div>
              <ul className="mt-1 flex flex-col gap-0.5 text-[11px] text-muted-foreground">
                {payload.comparison.cache_differences.map((difference) => (
                  <li key={difference.id}>
                    {difference.label}:{" "}
                    {difference.states
                      .map((state) => `${state.mode} ${state.cache}`)
                      .join(", ")}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </div>

        <div className="rounded-md border border-border bg-card px-4 py-3">
          <div className="text-xs font-semibold text-foreground">
            What this run is not connected to
          </div>
          <dl className="mt-1 divide-y divide-border/60">
            {payload.mappings.map((mapping) => (
              <div key={mapping.key} className="py-1.5">
                <div className="flex flex-wrap items-center gap-2">
                  <dt className="text-xs font-medium text-foreground">
                    {mapping.label}
                  </dt>
                  <StatusPill tone="neutral">
                    {mapping.state.replaceAll("_", " ")}
                  </StatusPill>
                </div>
                <dd className="mt-0.5 text-[11px] leading-relaxed text-muted-foreground">
                  {mapping.reason}
                </dd>
              </div>
            ))}
            {payload.edge_families.map((family) => (
              <div key={family.kind} className="py-1.5">
                <div className="flex flex-wrap items-center gap-2">
                  <dt className="text-xs font-medium text-foreground">
                    {family.label}
                  </dt>
                  <StatusPill tone="neutral">
                    {family.state.replaceAll("_", " ")}
                  </StatusPill>
                </div>
                <dd className="mt-0.5 text-[11px] leading-relaxed text-muted-foreground">
                  {family.reason}
                </dd>
              </div>
            ))}
          </dl>
        </div>
      </div>

      <Disclosure summary="What was checked before any of this was drawn">
        <dl className="divide-y divide-border/60">
          {payload.binding.checks.map((check) => (
            <Field key={check.label} label={check.label}>
              {check.detail}
            </Field>
          ))}
          <Field label="Candidate manifest">
            <Mono>{payload.binding.candidate_manifest_sha256}</Mono>
          </Field>
          <Field label="Build evidence">
            <Mono>{payload.binding.build_evidence_sha256}</Mono>
          </Field>
          <Field label="Population">
            <Mono>{payload.binding.population_sha256}</Mono>
          </Field>
          <Field label="Implementation">
            <Mono>{payload.binding.kernel_impl_hash}</Mono>
          </Field>
          <Field label="Run">{payload.candidate.run_id}</Field>
          <Field label="Release eligibility">
            {payload.candidate.release_eligibility.reason}
          </Field>
          <Field label="Gates">{payload.gates.note}</Field>
          <Field label="Receipt projection">{payload.projection.note}</Field>
          <Field label="Stage names">{payload.projection.label_basis}</Field>
        </dl>
        <ul className="mt-2 list-disc pl-4 text-[11px] leading-relaxed text-muted-foreground">
          {payload.limits.map((limit) => (
            <li key={limit}>{limit}</li>
          ))}
        </ul>
      </Disclosure>
    </div>
  );
}

/* ------------------------------------------------------------ connected */

function useReducedMotion() {
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    const query = window.matchMedia("(prefers-reduced-motion: reduce)");
    setReduced(query.matches);
    const onChange = (event: MediaQueryListEvent) => setReduced(event.matches);
    query.addEventListener("change", onChange);
    return () => query.removeEventListener("change", onChange);
  }, []);
  return reduced;
}

export function ReceiptGraphView() {
  const { selection } = useQualityContext();
  const search = useSearchParams();
  const reducedMotion = useReducedMotion();
  const { data, isPending, error } = useReceiptGraph();

  // The step and the execution live in the URL beside the candidate, so a
  // copied link reopens the same reading. Every other parameter is left alone,
  // and changing population already clears view-local keys.
  const patch = useCallback(
    (values: Partial<Record<"execution" | "node", string>>) => {
      // Only client-side inspector state changes. Next's history integration
      // updates useSearchParams without reusing a prefetched static route whose
      // canonical URL can discard these query parameters in production.
      window.history.replaceState(
        null,
        "",
        graphSelectionUrl(window.location.href, values),
      );
    },
    [],
  );

  const payload = data && data.available ? data : undefined;
  const { mode, selectedId } = useMemo(
    () =>
      resolveGraphSelection(
        { execution: search.get("execution"), node: search.get("node") },
        payload,
      ),
    [search, payload],
  );

  // A selection that cannot produce a request is stated as what it is. Only
  // once the request is actually in flight does the view report reading, so a
  // candidate carrying no usable manifest digest never leaves the reader
  // waiting on a fetch that was never started.
  const readiness = graphSelectionReadiness(selection);
  if (readiness !== "ready") {
    const notice = selectionNotice(readiness);
    return <EmptyState title={notice.title} description={notice.description} />;
  }
  if (isPending)
    return (
      <EmptyState title="Reading the candidate's build receipts…" variant="compact" />
    );
  if (error || !data)
    return (
      <EmptyState
        title="Build receipts unavailable"
        description={
          error instanceof Error
            ? error.message
            : "The selected candidate's build receipts could not be read."
        }
      />
    );
  if (!data.available)
    return (
      <EmptyState title="Build receipts unavailable" description={data.reason} />
    );

  return (
    <ReceiptGraphSurface
      payload={data}
      mode={mode}
      selectedId={selectedId}
      reducedMotion={reducedMotion}
      onModeChange={(next) => patch({ execution: next })}
      onSelect={(id) => patch({ node: id })}
      onClearSelection={() => patch({ node: "" })}
    />
  );
}
