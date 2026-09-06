"use client";

import { createContext, useContext, useMemo, type ReactNode } from "react";
import { useSearchParams } from "next/navigation";
import { useCountry } from "./country-context";
import {
  candidateReleaseToken,
  qualityHref,
  requestedIncumbent,
  selectionFromSearch,
  selectionUrl,
  type QualitySelection,
} from "@/lib/microcosm/quality/selection";

interface QualityContextValue {
  selection: QualitySelection;
  release: string;
  // What the URL asked to compare against, kept alongside the resolved
  // selection so a surface can explain a comparison it is not drawing.
  requestedIncumbent: string;
  setSelection: (patch: Partial<Omit<QualitySelection, "country">>) => void;
  href: (destination: string) => string;
}

const QualityContext = createContext<QualityContextValue | null>(null);

export function QualityProvider({ children }: { children: ReactNode }) {
  const { country } = useCountry();
  const search = useSearchParams();
  const params = useMemo(
    () => new URLSearchParams(search.toString()),
    [search],
  );
  const selection = useMemo(
    () => selectionFromSearch(params, country),
    [country, params],
  );
  return (
    <QualityContext.Provider
      value={{
        selection,
        release: candidateReleaseToken(selection) || selection.release,
        requestedIncumbent: requestedIncumbent(params, country),
        // A population change also changes server-provided data. A document
        // navigation preserves its complete immutable identity; the cached
        // static route can otherwise restore the previous canonical query.
        setSelection: (patch) =>
          window.location.assign(selectionUrl(window.location.href, country, patch)),
        href: (destination) => qualityHref(destination, selection),
      }}
    >
      {children}
    </QualityContext.Provider>
  );
}

export function useQualityContext(): QualityContextValue {
  const value = useContext(QualityContext);
  if (!value) throw new Error("Quality context requires QualityProvider.");
  return value;
}
