import { expect, test } from "bun:test";
import { navCloseFocusTarget } from "./nav-focus";

const main = { id: "main" } as unknown as HTMLElement;
const rendered = { offsetParent: { id: "row" } } as unknown as HTMLElement;
const hidden = { offsetParent: null } as unknown as HTMLElement;

test("closing the drawer never hands focus to a menu button the layout has hidden", () => {
  expect(navCloseFocusTarget(rendered, main)).toBe(rendered);
  expect(navCloseFocusTarget(hidden, main)).toBe(main);
  expect(navCloseFocusTarget(null, main)).toBe(main);
});
