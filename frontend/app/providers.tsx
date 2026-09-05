"use client";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ReactQueryDevtools } from "@tanstack/react-query-devtools";
import { Suspense, useState } from "react";

import { CountryProvider } from "@/components/layout/country-context";
import { QualityProvider } from "@/components/layout/quality-context";
import { PUBLISHED_RELEASE_STALE_TIME_MS } from "@/lib/api/cache-policy";

export function Providers({ children }: { children: React.ReactNode }) {
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            staleTime: PUBLISHED_RELEASE_STALE_TIME_MS,
            refetchOnWindowFocus: false,
            retry: 2,
          },
        },
      }),
  );

  return (
    <QueryClientProvider client={queryClient}>
      <Suspense><CountryProvider><QualityProvider>{children}</QualityProvider></CountryProvider></Suspense>
      <ReactQueryDevtools initialIsOpen={false} />
    </QueryClientProvider>
  );
}
