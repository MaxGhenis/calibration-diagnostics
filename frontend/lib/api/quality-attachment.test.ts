import { expect, test } from "bun:test";
import { QueryClient, QueryObserver } from "@tanstack/react-query";
import { qualityAttachmentOptions } from "./quality-attachment";
import type { QualitySelection } from "@/lib/microcosm/quality/selection";

const sha = "a".repeat(64);
const otherSha = "b".repeat(64);
const selection: QualitySelection = {
  country: "us",
  candidate: "development-population",
  manifest_sha256: sha,
  release: "",
  incumbent: "",
};
const candidate = { series: ["candidate-only"] };
const incumbent = { series: ["incumbent-only"] };
type Attachment = typeof candidate;
const options = (enabled = true, token?: string, selected = selection) =>
  qualityAttachmentOptions<Attachment>("distributions", selected, enabled, token);

test("no incumbent cannot reuse the populated candidate query cache", () => {
  const client = new QueryClient();
  client.setQueryData(options().queryKey, candidate);
  const selected = new QueryObserver(client, options());
  expect(selected.getCurrentResult().data).toEqual(candidate);
  const comparison = new QueryObserver(client, options(false, ""));
  const unsubscribe = comparison.subscribe(() => {});
  expect(comparison.getCurrentResult().data).toBeUndefined();
  expect(comparison.getCurrentResult().fetchStatus).toBe("idle");
  unsubscribe();
  client.clear();
});

test("published or malformed incumbent tokens never fall back to candidate data", () => {
  const client = new QueryClient();
  client.setQueryData(options().queryKey, candidate);
  for (const token of [
    "build-p",
    "candidate:",
    `candidate:development-population:${sha}:extra`,
    `candidate:../development-population:${sha}`,
    "candidate:development-population:bad-digest",
  ]) {
    const observer = new QueryObserver(client, options(true, token));
    const unsubscribe = observer.subscribe(() => {});
    expect(observer.getCurrentResult().data).toBeUndefined();
    expect(observer.getCurrentResult().fetchStatus).toBe("idle");
    unsubscribe();
  }
  client.clear();
});

test("removing an incumbent clears its data from an existing observer", () => {
  const client = new QueryClient();
  const token = `candidate:earlier-population:${otherSha}`;
  client.setQueryData(options().queryKey, candidate);
  client.setQueryData(options(true, token).queryKey, incumbent);
  const observer = new QueryObserver(client, options(true, token));
  expect(observer.getCurrentResult().data).toEqual(incumbent);
  observer.setOptions(options(false, ""));
  expect(observer.getCurrentResult().data).toBeUndefined();
  observer.setOptions(options(true, token));
  expect(observer.getCurrentResult().data).toEqual(incumbent);
  client.clear();
});

test("disabling a known attachment hides cached evidence without deleting the cache", () => {
  const client = new QueryClient();
  client.setQueryData(options().queryKey, candidate);
  const observer = new QueryObserver(client, options());
  expect(observer.getCurrentResult().data).toEqual(candidate);
  observer.setOptions(options(false));
  expect(observer.getCurrentResult().data).toBeUndefined();
  expect(client.getQueryData<Attachment>(options().queryKey)).toEqual(candidate);
  observer.setOptions(options());
  expect(observer.getCurrentResult().data).toEqual(candidate);
  client.clear();
});

test("attachment cache identity includes country and immutable manifest digest", () => {
  const client = new QueryClient();
  client.setQueryData(options().queryKey, candidate);
  for (const selected of [
    { ...selection, country: "uk" as const },
    { ...selection, manifest_sha256: otherSha },
  ]) {
    const observer = new QueryObserver(client, options(true, undefined, selected));
    expect(observer.getCurrentResult().data).toBeUndefined();
  }
  client.clear();
});
