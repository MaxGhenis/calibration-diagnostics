import { describe, expect, test } from "bun:test";

import {
  graphSelectionReadiness,
  graphSelectionUrl,
  nextStep,
  receiptGraphIdentity,
  resolveGraphSelection,
} from "./navigation";

const OFFER = {
  executions: [{ mode: "cold" }, { mode: "replay" }],
  nodes: [
    { id: "assign_us_puma_ladder" },
    { id: "assemble_stacked_spine" },
    { id: "assemble_stacked_spine.prepare" },
  ],
};

describe("a link that carries a reading", () => {
  test("reopens the same step in the same execution", () => {
    expect(
      resolveGraphSelection(
        { execution: "replay", node: "assemble_stacked_spine" },
        OFFER,
      ),
    ).toEqual({ mode: "replay", selectedId: "assemble_stacked_spine" });
  });

  test("falls back to the first recorded execution when none is named", () => {
    expect(resolveGraphSelection({ execution: null, node: null }, OFFER)).toEqual({
      mode: "cold",
      selectedId: "",
    });
  });

  test("ignores an execution this run did not record", () => {
    expect(
      resolveGraphSelection({ execution: "direct", node: null }, OFFER).mode,
    ).toBe("cold");
  });

  test("ignores a step this candidate's run has no receipt for", () => {
    expect(
      resolveGraphSelection(
        { execution: "cold", node: "calibrate_national_targets" },
        OFFER,
      ).selectedId,
    ).toBe("");
  });

  test("selects nothing at all when the run is unavailable", () => {
    expect(
      resolveGraphSelection({ execution: "cold", node: "anything" }, undefined),
    ).toEqual({ mode: "", selectedId: "" });
  });
});

describe("writing the reading back into the URL", () => {
  // Inspector selection uses the history API and retains the mounted URL.
  const current =
    "http://dashboard.test/calibration/dashboard/microcosm/pipeline?country=us&candidate=us-graph-f001-geography-20260905-v1&manifest_sha256=ff2f231bbe96267bbb230264cece5131314edab449d9cdd03b85aa452535b885&incumbent=candidate%3Aother%3Aabc";

  test("leaves the candidate selection exactly as it was", () => {
    const next = new URL(graphSelectionUrl(current, { node: "assign_us_puma_ladder" }));
    expect(next.searchParams.get("country")).toBe("us");
    expect(next.searchParams.get("candidate")).toBe(
      "us-graph-f001-geography-20260905-v1",
    );
    expect(next.searchParams.get("manifest_sha256")).toBe(
      "ff2f231bbe96267bbb230264cece5131314edab449d9cdd03b85aa452535b885",
    );
    expect(next.searchParams.get("incumbent")).toBe("candidate:other:abc");
    expect(next.searchParams.get("node")).toBe("assign_us_puma_ladder");
  });

  test("drops its own key rather than writing an empty one", () => {
    const withNode = graphSelectionUrl(current, { node: "assemble_stacked_spine" });
    const cleared = new URL(graphSelectionUrl(withNode, { node: "" }));
    expect(cleared.searchParams.has("node")).toBe(false);
    expect(cleared.searchParams.get("candidate")).toBe(
      "us-graph-f001-geography-20260905-v1",
    );
  });

  test("keeps the mounted base path exactly once", () => {
    const next = graphSelectionUrl(current, { execution: "replay" });
    expect(next).toStartWith(
      "http://dashboard.test/calibration/dashboard/microcosm/pipeline?",
    );
    expect(new URL(next).pathname).toBe("/calibration/dashboard/microcosm/pipeline");
  });

  test("keeps the fragment the reader arrived on", () => {
    expect(
      graphSelectionUrl(`${current}#support`, { execution: "replay" }),
    ).toEndWith("#support");
  });
});

describe("moving through the list from the keyboard", () => {
  const order = ["a", "b", "c"];

  test("steps forward and back", () => {
    expect(nextStep(order, "a", 1)).toBe("b");
    expect(nextStep(order, "b", -1)).toBe("a");
  });

  test("clamps at both ends rather than wrapping", () => {
    expect(nextStep(order, "a", -1)).toBe("a");
    expect(nextStep(order, "c", 1)).toBe("c");
  });

  test("jumps to the ends", () => {
    expect(nextStep(order, "b", "first")).toBe("a");
    expect(nextStep(order, "b", "last")).toBe("c");
  });

  test("lands on the first step when nothing is selected yet", () => {
    expect(nextStep(order, "", 1)).toBe("a");
  });

  test("has nowhere to go in an empty list", () => {
    expect(nextStep([], "a", 1)).toBeUndefined();
  });
});

/* ------------------------------------------------- what may be asked for */

describe("whether the view has enough of a selection to ask anything", () => {
  const selection = (candidate: string, manifest_sha256: string) =>
    ({
      country: "us" as const,
      candidate,
      manifest_sha256,
      release: "",
      incumbent: "",
    });

  test("no candidate is no request", () => {
    expect(graphSelectionReadiness(selection("", ""))).toBe("no_candidate");
  });

  test("a candidate without a usable manifest digest is incomplete, not pending", () => {
    // The request needs both halves of the immutable identity. A URL that
    // carries only the candidate leaves the query disabled, so the view has to
    // say the selection is incomplete rather than read as though a fetch were
    // still running.
    for (const digest of ["", "not-a-digest", "ff2f231b", "F".repeat(64)])
      expect(
        graphSelectionReadiness(
          selection("us-graph-f001-geography-20260905-v1", digest),
        ),
      ).toBe("incomplete_identity");
  });

  test("a candidate with its digest is a request", () => {
    expect(
      graphSelectionReadiness(
        selection(
          "us-graph-f001-geography-20260905-v1",
          "ff2f231bbe96267bbb230264cece5131314edab449d9cdd03b85aa452535b885",
        ),
      ),
    ).toBe("ready");
  });

  test("the identity handed to the request is the one the selection spells", () => {
    expect(
      receiptGraphIdentity(
        selection(
          "us-graph-f001-geography-20260905-v1",
          "ff2f231bbe96267bbb230264cece5131314edab449d9cdd03b85aa452535b885",
        ),
      ),
    ).toEqual({
      candidate: "us-graph-f001-geography-20260905-v1",
      manifest_sha256:
        "ff2f231bbe96267bbb230264cece5131314edab449d9cdd03b85aa452535b885",
    });
    expect(receiptGraphIdentity(selection("us-graph-f001", ""))).toBeUndefined();
  });

  test("the query runs exactly when the view calls the selection ready", () => {
    // The bug was two conditions for one question: the hook decided whether to
    // fetch, the view decided what to say, and a selection the hook refused
    // could still read as one the view was waiting on. They are one function
    // now. This holds them to that — `enabled: Boolean(identity)` in
    // `useReceiptGraph` and `readiness !== "ready"` in `ReceiptGraphView` have
    // to answer alike for every selection, or the permanent-pending state comes
    // back by a different route.
    const digest = "ff2f231bbe96267bbb230264cece5131314edab449d9cdd03b85aa452535b885";
    const cases = [
      ["", ""],
      ["", digest],
      ["us-graph-f001-geography-20260905-v1", ""],
      ["us-graph-f001-geography-20260905-v1", " "],
      ["us-graph-f001-geography-20260905-v1", "not-a-digest"],
      ["us-graph-f001-geography-20260905-v1", "ff2f231b"],
      ["us-graph-f001-geography-20260905-v1", digest.toUpperCase()],
      ["us-graph-f001-geography-20260905-v1", `${digest}0`],
      ["us-graph-f001-geography-20260905-v1", ` ${digest}`],
      ["candidate:with:colons", digest],
      ["us-graph-f001-geography-20260905-v1", digest],
    ] as const;
    for (const [candidate, manifest] of cases) {
      const selected = selection(candidate, manifest);
      expect(
        `${candidate}/${manifest}: ${graphSelectionReadiness(selected) === "ready"}`,
      ).toBe(
        `${candidate}/${manifest}: ${Boolean(receiptGraphIdentity(selected))}`,
      );
    }
    // And the matrix is not vacuous in either direction.
    expect(
      cases.filter(([c, m]) => graphSelectionReadiness(selection(c, m)) === "ready"),
    ).toHaveLength(1);
  });
});
