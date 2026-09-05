"use client";

import { useEffect, useReducer, useRef } from "react";
import { usePathname } from "next/navigation";

import { GlobalLoader } from "./global-loader";
import { useCountry } from "./country-context";
import { NavSidebar } from "./nav-sidebar";
import { SiteHeader } from "./site-header";
import { SiteFooter } from "./site-footer";
import { QualityStrip } from "./quality-strip";
import { useQualityContext } from "./quality-context";
import { navDrawerReducer } from "./nav-drawer";

// The dashboard chrome, skinned to microcosm.institute. We deliberately do NOT use
// ui-kit's <DashboardShell>/<Header> here: the shell paints an opaque bg-muted
// that would hide the body's paper wash + grain, and the header read as a hard
// exit from microcosm.institute. The shell stays transparent so the site atmosphere
// (app/globals.css body::before + .site-grain) shows through, and the header /
// footer come from the microcosm.institute-style components.
//
// Below `lg` the w-56 sidebar has nowhere to shrink to, so it becomes an
// off-canvas drawer (absolutely positioned within .app-viewport, toggled by
// the Menu button) instead of squeezing <main> down to a sliver.
export function AppShell({ children }: { children: React.ReactNode }) {
  const { country } = useCountry();
  const { release } = useQualityContext();
  const pathname = usePathname();
  const [navOpen, dispatchNav] = useReducer(navDrawerReducer, false);
  const navToggleRef = useRef<HTMLButtonElement>(null);

  // The drawer only exists below `lg`; leave it closed for the next route
  // rather than carrying an open overlay across navigations.
  useEffect(() => {
    dispatchNav({ type: "navigate" });
  }, [pathname]);

  useEffect(() => {
    if (!navOpen) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      dispatchNav({ type: "escape" });
      navToggleRef.current?.focus();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [navOpen]);

  const closeNav = () => dispatchNav({ type: "close" });

  return (
    <div className="flex min-h-screen flex-col text-foreground">
      <GlobalLoader />
      <SiteHeader />
      <div className="app-viewport relative flex">
        {navOpen ? (
          <button
            type="button"
            aria-label="Close navigation"
            onClick={closeNav}
            className="absolute inset-0 z-30 cursor-default bg-[var(--scrim)] backdrop-blur-[2px] lg:hidden"
          />
        ) : null}
        <aside
          id="nav-drawer"
          className={`absolute inset-y-0 left-0 z-40 w-64 max-w-[80vw] transform overflow-y-auto border-r border-border-light bg-card shadow-lg backdrop-blur-sm transition-transform duration-200 ease-out lg:static lg:z-auto lg:w-56 lg:max-w-none lg:translate-x-0 lg:bg-card/50 lg:shadow-none lg:transition-none ${
            navOpen ? "translate-x-0" : "-translate-x-full"
          }`}
        >
          <NavSidebar onNavigate={closeNav} />
        </aside>
        <main className="flex min-w-0 flex-1 flex-col overflow-auto">
          <div className="flex items-center border-b border-border-light px-4 py-2 lg:hidden">
            <button
              ref={navToggleRef}
              type="button"
              aria-expanded={navOpen}
              aria-controls="nav-drawer"
              onClick={() => dispatchNav({ type: "toggle" })}
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
                {navOpen ? (
                  <path d="M6 6l12 12M18 6l-12 12" />
                ) : (
                  <path d="M4 6h16M4 12h16M4 18h16" />
                )}
              </svg>
              {navOpen ? "Close menu" : "Menu"}
            </button>
          </div>
          <div key={`${country}:${release}`} className="min-w-0 flex-1 p-6 pt-0"><QualityStrip />{children}</div>
          <SiteFooter />
        </main>
      </div>
    </div>
  );
}
