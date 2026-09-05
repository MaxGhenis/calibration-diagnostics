import { useQuery } from "@tanstack/react-query";
import { useQualityContext } from "@/components/layout/quality-context";
import type {
  CandidateQualityManifest,
  QualityIndexResponse,
} from "@/lib/microcosm/quality/types";
import { apiGet } from "../client";

export function useQualityIndex() {
  const { selection } = useQualityContext();
  return useQuery({
    queryKey: ["quality", "index", selection.country],
    queryFn: () =>
      apiGet<QualityIndexResponse>("/microcosm/quality", {
        country: selection.country,
      }),
    staleTime: 30_000,
    refetchInterval: 60_000,
    retry: false,
  });
}

export function useQualityParams() {
  const { selection } = useQualityContext();
  return {
    candidate: selection.candidate || undefined,
    manifest_sha256: selection.candidate
      ? selection.manifest_sha256
      : undefined,
  };
}

export function useQualityManifest() {
  const { selection } = useQualityContext();
  return useQuery({
    queryKey: [
      "quality",
      "manifest",
      selection.country,
      selection.candidate,
      selection.manifest_sha256,
    ],
    queryFn: () =>
      apiGet<CandidateQualityManifest>("/microcosm/quality", {
        view: "manifest",
        ...selection,
      }),
    enabled: Boolean(selection.candidate),
    staleTime: Infinity,
    retry: false,
  });
}

export function useQualityAttachment<T>(
  view: string,
  enabled = true,
  token?: string,
) {
  const { selection } = useQualityContext();
  const identity = token?.startsWith("candidate:")
    ? token.split(":").slice(1)
    : [selection.candidate, selection.manifest_sha256];
  const candidate = identity[0];
  const sha = identity[1];
  return useQuery({
    queryKey: ["quality", view, selection.country, candidate, sha],
    queryFn: () =>
      apiGet<T>("/microcosm/quality", {
        view,
        country: selection.country,
        candidate,
        manifest_sha256: sha,
      }),
    enabled:
      enabled &&
      Boolean(candidate) &&
      (token === undefined || token.startsWith("candidate:")),
    staleTime: Infinity,
    retry: false,
  });
}
