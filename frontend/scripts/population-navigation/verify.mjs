import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const require = createRequire(import.meta.url);
const { webkit } = require(process.env.PLAYWRIGHT_CORE_PATH || "playwright-core");
const fixturePath = process.env.POPULATION_NAV_FIXTURE || fileURLToPath(new URL("combined-age-fixture.json", import.meta.url));
const fixture = JSON.parse(readFileSync(fixturePath, "utf8"));
const output = process.argv[2];
assert.ok(output, "Supply the output receipt path.");
assert.equal(fixture.candidates.length, 2, "The fixture must name two candidates.");
assert.notEqual(fixture.candidates[0].id, fixture.candidates[1].id);
const base = process.env.POPULATION_NAV_BASE_URL || "http://127.0.0.1:3000/calibration/dashboard";
const start = new URL(`${base.replace(/\/$/, "")}/microcosm/pipeline`);
start.searchParams.set("country", fixture.country);
start.searchParams.set("candidate", fixture.candidates[0].id);
start.searchParams.set("manifest_sha256", fixture.candidates[0].manifest_sha256);
const receipt = { status: "STARTED", fixture: path.resolve(fixturePath), base, checks: [], page_errors: [] };
const browser = await webkit.launch({ headless: true });
const check = (name, passed) => {
  receipt.checks.push({ name, passed: !!passed });
  assert.ok(passed, name);
};
try {
  for (const [name, width, height] of [["desktop", 1440, 1000], ["mobile", 390, 844]]) {
    const context = await browser.newContext({ viewport: { width, height }, isMobile: name === "mobile", hasTouch: name === "mobile" });
    const page = await context.newPage();
    page.on("pageerror", error => receipt.page_errors.push({ viewport: name, error: String(error) }));
    const verify = async (candidate, step) => {
      await page.waitForURL(url => url.searchParams.get("candidate") === candidate.id && url.searchParams.get("manifest_sha256") === candidate.manifest_sha256);
      await page.waitForFunction(({ selector, text }) => document.querySelector(selector)?.textContent.includes(text), { selector: candidate.profile_selector, text: candidate.sample_text });
      check(`${name}: ${step} shows the selected sample`, (await page.locator(candidate.profile_selector).innerText()).includes(candidate.sample_text));
      const binding = page.locator("summary", { hasText: "What was checked before any of this was drawn" });
      await binding.click();
      const text = await binding.locator("..").innerText();
      check(`${name}: ${step} binds the exact manifest and checkpoint`, text.includes(candidate.manifest_sha256) && text.includes(candidate.population_sha256));
      await binding.click();
      await page.waitForLoadState("networkidle");
    };
    await page.goto(start.href, { waitUntil: "networkidle" });
    await verify(fixture.candidates[0], "initial population");
    const select = page.getByRole("combobox", { name: "Selected population", exact: true });
    const next = fixture.candidates[1];
    const options = await select.locator("option").evaluateAll(elements => elements.map(e => ({ value: e.value, label: e.textContent })));
    const option = options.find(e => e.label.includes(next.id));
    assert.ok(option, "The second immutable candidate must be available.");
    await select.selectOption(option.value);
    await verify(next, "changed population");
    await page.goBack({ waitUntil: "networkidle" });
    await verify(fixture.candidates[0], "Back");
    await page.goForward({ waitUntil: "networkidle" });
    await verify(next, "Forward");
    await context.close();
  }
  check("no browser runtime errors", receipt.page_errors.length === 0);
  receipt.status = "PASS";
} catch (error) {
  receipt.status = "FAIL";
  receipt.error = String(error);
  throw error;
} finally {
  await browser.close();
  writeFileSync(output, `${JSON.stringify(receipt, null, 2)}\n`);
}
