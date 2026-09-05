// Which element takes focus when the navigation drawer closes.
//
// The button that opened the drawer is the right target for a modal close, but
// it only exists below `lg`. A close forced by the viewport crossing into
// desktop hides it, and focusing a `display: none` element silently drops focus
// to <body>. `offsetParent` is null exactly when an element or an ancestor is
// display:none, so this asks whether the toggle is really rendered rather than
// inferring it from which handler closed the drawer: the media query listens at
// 1024px while Tailwind's `lg` is 64rem, and those differ whenever the root
// font size is not 16px.
export function navCloseFocusTarget(
  toggle: HTMLElement | null,
  main: HTMLElement | null,
): HTMLElement | null {
  return toggle?.offsetParent ? toggle : main;
}
