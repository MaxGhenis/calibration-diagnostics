"use client";

import { useEffect, useRef } from "react";
import { usePathname } from "next/navigation";

import { GlobalLoader } from "./global-loader";
import { useCountry } from "./country-context";
import { NavSidebar } from "./nav-sidebar";
import { SiteHeader } from "./site-header";
import { SiteFooter } from "./site-footer";
import { navCloseFocusTarget } from "./nav-focus";
import { QualityStrip } from "./quality-strip";
import { useQualityContext } from "./quality-context";

// The dashboard chrome, skinned to microcosm.institute. We deliberately do NOT use
// ui-kit's <DashboardShell>/<Header> here: the shell paints an opaque bg-muted
// that would hide the body's paper wash + grain, and the header read as a hard
// exit from microcosm.institute. The shell stays transparent so the site atmosphere
// (app/globals.css body::before + .site-grain) shows through, and the header /
// footer come from the microcosm.institute-style components.
//
// Below `lg` the w-56 sidebar has nowhere to shrink to, so navigation instead
// lives in a native <dialog>, opened modally by the Menu button. A <dialog>
// without `open` is UA `display: none` -- invisible and unreachable by Tab or
// AT with no extra markup -- and showModal() gives us the rest for free: the
// background becomes inert (real focus containment, not just a visual scrim),
// Escape and backdrop clicks close it, and focus returns to the invoking
// button on close. That native machinery only engages for whichever control
// currently calls showModal()/close(), so it can't reach into desktop's
// always-static <aside> below and make it inert too. Desktop (`lg:` and up)
// renders that separate, permanently-visible sidebar instead of the dialog.
export function AppShell({ children }: { children: React.ReactNode }) {
  const { country } = useCountry();
  const { release } = useQualityContext();
  const pathname = usePathname();
  const dialogRef = useRef<HTMLDialogElement>(null);
  const navToggleRef = useRef<HTMLButtonElement>(null);
  const mainRef = useRef<HTMLElement>(null);

  // The dialog only exists below `lg`; leave it closed for the next route
  // rather than carrying an open modal across navigations. close() on an
  // already-closed dialog is a documented no-op, so this is safe every time.
  useEffect(() => {
    dialogRef.current?.close();
  }, [pathname]);

  // If the viewport crosses into desktop while the dialog is still open
  // (e.g. rotating a tablet, or resizing the window), close it explicitly
  // rather than letting `lg:hidden` merely paint over a still-modal dialog --
  // that would leave the rest of the page inert with nothing visible to
  // close it.
  useEffect(() => {
    const query = window.matchMedia("(min-width: 1024px)");
    const onChange = (event: MediaQueryListEvent) => {
      if (event.matches) dialogRef.current?.close();
    };
    query.addEventListener("change", onChange);
    return () => query.removeEventListener("change", onChange);
  }, []);

  const closeNav = () => dialogRef.current?.close();
  const openNav = () => dialogRef.current?.showModal();

  return (
    <div className="flex min-h-screen flex-col text-foreground">
      <GlobalLoader />
      <SiteHeader />
      <div className="app-viewport relative flex">
        <aside className="hidden w-56 shrink-0 overflow-y-auto border-r border-border-light bg-card/50 lg:block">
          <NavSidebar />
        </aside>
        <dialog
          ref={dialogRef}
          aria-labelledby="nav-drawer-title"
          // Escape, the Close button and a nav link all return focus to the
          // Menu button that opened the drawer. A close forced by the viewport
          // crossing into desktop cannot: that button is `lg:hidden` by then,
          // so focus falls through to the main landmark, which is visible at
          // every width. preventScroll keeps the reader's place, since <main>
          // is the scroll container.
          onClose={() =>
            navCloseFocusTarget(
              navToggleRef.current,
              mainRef.current,
            )?.focus({ preventScroll: true })
          }
          onClick={(event) => {
            if (event.target === dialogRef.current) closeNav();
          }}
          className="fixed inset-y-0 left-0 m-0 h-dvh max-h-none w-64 max-w-[80vw] border-0 border-r border-border-light bg-card p-0 shadow-lg open:flex open:flex-col backdrop:bg-[var(--scrim)] backdrop:backdrop-blur-[2px] lg:hidden"
        >
          <div className="flex shrink-0 items-center justify-between border-b border-border-light px-4 py-2">
            <span
              id="nav-drawer-title"
              className="font-mono text-xs font-medium uppercase tracking-[0.08em] text-foreground/60"
            >
              Navigation
            </span>
            <button
              type="button"
              autoFocus
              onClick={closeNav}
              className="inline-flex items-center gap-2 rounded-md border border-border px-2.5 py-1.5 font-mono text-xs font-medium uppercase tracking-[0.08em] text-foreground/80 hover:text-foreground"
            >
              <svg
                aria-hidden="true"
                viewBox="0 0 24 24"
                width="16"
                height="16"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
              >
                <path d="M6 6l12 12M18 6l-12 12" />
              </svg>
              Close menu
            </button>
          </div>
          <div className="flex-1 overflow-y-auto">
            <NavSidebar onNavigate={closeNav} />
          </div>
        </dialog>
        <main
          ref={mainRef}
          tabIndex={-1}
          className="flex min-w-0 flex-1 flex-col overflow-auto outline-none"
        >
          <div className="flex items-center border-b border-border-light px-4 py-2 lg:hidden">
            <button
              ref={navToggleRef}
              type="button"
              aria-haspopup="dialog"
              onClick={openNav}
              className="inline-flex items-center gap-2 rounded-md border border-border px-2.5 py-1.5 font-mono text-xs font-medium uppercase tracking-[0.08em] text-foreground/80 hover:text-foreground"
            >
              <svg
                aria-hidden="true"
                viewBox="0 0 24 24"
                width="16"
                height="16"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
              >
                <path d="M4 6h16M4 12h16M4 18h16" />
              </svg>
              Menu
            </button>
          </div>
          <div key={`${country}:${release}`} className="min-w-0 flex-1 p-6 pt-0 lg:pt-6"><QualityStrip />{children}</div>
          <SiteFooter />
        </main>
      </div>
    </div>
  );
}
