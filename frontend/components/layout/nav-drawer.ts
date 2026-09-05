// Pure state machine for the mobile nav drawer (AppShell). Kept outside the
// component so open/close transitions are unit-testable without a DOM.
export type NavDrawerEvent =
  | { type: "toggle" }
  | { type: "close" }
  | { type: "navigate" }
  | { type: "escape" };

export function navDrawerReducer(open: boolean, event: NavDrawerEvent): boolean {
  switch (event.type) {
    case "toggle":
      return !open;
    case "close":
    case "navigate":
    case "escape":
      return false;
    default:
      return open;
  }
}
