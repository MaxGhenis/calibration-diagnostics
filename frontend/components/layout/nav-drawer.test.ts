import { expect, test } from "bun:test";

import { navDrawerReducer } from "./nav-drawer";

test("toggle flips the drawer open state", () => {
  expect(navDrawerReducer(false, { type: "toggle" })).toBe(true);
  expect(navDrawerReducer(true, { type: "toggle" })).toBe(false);
});

test("navigating always closes the drawer, even if it was already closed", () => {
  expect(navDrawerReducer(true, { type: "navigate" })).toBe(false);
  expect(navDrawerReducer(false, { type: "navigate" })).toBe(false);
});

test("escape and explicit close both close an open drawer", () => {
  expect(navDrawerReducer(true, { type: "escape" })).toBe(false);
  expect(navDrawerReducer(true, { type: "close" })).toBe(false);
});
