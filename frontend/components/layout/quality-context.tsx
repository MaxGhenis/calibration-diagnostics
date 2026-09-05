"use client";

import { createContext, useContext, useMemo, type ReactNode } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useCountry } from "./country-context";
import {
  candidateReleaseToken,
  qualityHref,
  selectionFromSearch,
  selectionUrl,
  type QualitySelection,
} from "@/lib/microcosm/quality/selection";

interface QualityContextValue {
  selection: QualitySelection;
  release: string;
  setSelection: (patch: Partial<Omit<QualitySelection, "country">>) => void;
  href: (destination: string) => string;
}

const QualityContext = createContext<QualityContextValue | null>(null);

export function QualityProvider({ children }: { children: ReactNode }) {
  const { country } = useCountry();
  const search = useSearchParams();
  const router = useRouter();
  const selection = useMemo(
    () => selectionFromSearch(new URLSearchParams(search.toString()), country),
    [country, search],
  );
  return (
    <QualityContext.Provider
      value={{
        selection,
        release: candidateReleaseToken(selection) || selection.release,
        setSelection: (patch) =>
          router.push(selectionUrl(window.location.href, country, patch), {
            scroll: false,
          }),
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
