import { expect, test } from "bun:test";
import { validateValidationReach } from "./reach";

const original = await Bun.file(
  new URL("../../../public/model-coverage.json", import.meta.url),
).json();

test("existing validation reach artifact retains its exact inventory", () => {
  expect(validateValidationReach(original)).toEqual(original);
});

test("malformed or contradictory reach inventories fail before rendering", () => {
  for (const patch of [
    { source: { ...original.source, version: null } },
    { totals: { ...original.totals, rules: -1 } },
    { tree: { ...original.tree, children: "invalid" } },
    { tree: { ...original.tree, anchored: original.tree.rules + 1 } },
    { tree: { ...original.tree, inputs: original.tree.inputs + 1 } },
  ])
    expect(() => validateValidationReach({ ...original, ...patch })).toThrow();
});
