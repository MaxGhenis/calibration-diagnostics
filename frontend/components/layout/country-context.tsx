"use client";

import {
  createContext,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";
import { useRouter, useSearchParams } from "next/navigation";

import {
  DEFAULT_COUNTRY,
  isCountry,
  type MicrocosmCountry,
} from "@/lib/microcosm/countries";

export type Country = MicrocosmCountry;

export interface CountryReleaseSelection {
  country: Country;
  value: string;
}

export { isCountry };

const STORAGE_KEY = "microcosm-country";

export function countrySwitchUrl(currentUrl: string, next: Country): string {
  const url = new URL(currentUrl);
  if (url.pathname.endsWith("/microcosm/datasets")) {
    url.search = "";
  } else {
    // Release identifiers are repository-specific. A release selected for one
    // country must never be requested from another country's repository.
    for (const key of ["release", "candidate", "manifest_sha256", "incumbent"]) url.searchParams.delete(key);
  }
  url.searchParams.set("country", next);
  return url.toString();
}

export function selectedReleaseForCountry(
  country: Country,
  selection: CountryReleaseSelection,
): string {
  return selection.country === country ? selection.value : "";
}

function persistCountry(country: Country) {
  try {
    window.localStorage.setItem(STORAGE_KEY, country);
  } catch {
    // Ignore storage failures (private mode, etc.).
  }
}

interface CountryContextValue {
  country: Country;
  setCountry: (country: Country) => void;
}

const CountryContext = createContext<CountryContextValue>({
  country: DEFAULT_COUNTRY,
  setCountry: () => {},
});

export function CountryProvider({ children }: { children: ReactNode }) {
  const router = useRouter();
  const search = useSearchParams();
  const [country, setCountryState] = useState<Country>(DEFAULT_COUNTRY);

  useEffect(() => {
    const requested = search.get("country");
    if (isCountry(requested)) {
      setCountryState(requested);
      persistCountry(requested);
      return;
    }
    const stored = window.localStorage.getItem(STORAGE_KEY);
    if (isCountry(stored)) setCountryState(stored);
  }, [search]);

  const setCountry = (next: Country) => {
    if (next === country) return;
    setCountryState(next);
    persistCountry(next);
    // Route through Next so server page search parameters are recalculated;
    // raw history replacement would leave initialRelease props stale.
    router.replace(countrySwitchUrl(window.location.href, next), { scroll: false });
  };

  return (
    <CountryContext.Provider value={{ country, setCountry }}>
      {children}
    </CountryContext.Provider>
  );
}

export function useCountry(): CountryContextValue {
  return useContext(CountryContext);
}
