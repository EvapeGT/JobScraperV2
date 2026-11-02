import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { register } from "node:module";
import test from "node:test";
import "../helpers/web-ts-alias-loader.mjs";

// Exercise the real routes, real profile pin and catalog checks. The sole spawn
// boundary is replaced: no evaluation process or model prompt can run here.
const actualRuntime = new URL("../../src/lib/evaluation-runtime.mjs", import.meta.url).href;
const cliStub = `
  export const resolveCli = id => {
    globalThis.pinFixture.resolved.push(id);
    return globalThis.pinFixture.installed ? { spec: { id, name: 'Antigravity CLI', args: p => ['--model', 'gemini-4-argon-medium', '-p', p] }, binPath: '/fixture/never-run' } : null;
  };
  export const resolveCliOrFallback = () => { globalThis.pinFixture.fallbacks++; throw new Error('No CLI substitution is allowed'); };
  export const cliSubstitutionNotice = () => null;
  export const cliUnavailableError = () => ({error: 'Fixture CLI unavailable'});
`;
const runtimeStub = `
  export * from ${JSON.stringify(actualRuntime)};
  import { prepareEvaluationRuntime as prepare, createEvaluationModelVerifier } from ${JSON.stringify(actualRuntime)};
  export const prepareEvaluationRuntime = (root, resolve) => prepare(root, resolve, createEvaluationModelVerifier({load: async () => {
    if (globalThis.pinFixture.catalogError) throw new Error('Catalog check failed; evaluation blocked');
    return globalThis.pinFixture.catalog;
  }}));
`;
const spawnStub = `export function spawnHeadlessCli(bin, args) { globalThis.pinFixture.spawns.push({bin,args}); throw new Error('Fixture stopped before starting any AI process'); }`;
register(`data:text/javascript,${encodeURIComponent(`
  export function resolve(specifier, context, nextResolve) {
    const stubs = ${JSON.stringify({ "@/lib/clis": cliStub, "@/lib/evaluation-runtime.mjs": runtimeStub, "@/lib/spawn-cli.mjs": spawnStub })};
    if (Object.hasOwn(stubs, specifier)) return {url: 'data:text/javascript,' + encodeURIComponent(stubs[specifier]), shortCircuit: true};
    return nextResolve(specifier, context);
  }
`)}`, import.meta.url);
const { POST } = await import("../../src/app/api/run/route.ts");
const { GET } = await import("../../src/app/api/evaluation-runtime/route.ts");
const model = "gemini-3.8-flash-high";
const catalog = `${model}\tGemini 3.8 Flash (High)\n`;

function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "co-model-route-"));
  const previous = process.env.CAREER_OPS_ROOT;
  process.env.CAREER_OPS_ROOT = root;
  for (const dir of ["config", "data", "modes", "reports"]) fs.mkdirSync(path.join(root, dir));
  fs.writeFileSync(path.join(root, "config/profile.yml"), `evaluation_runtime:\n  cli: antigravity\n  model: ${model}\n  label: Gemini 3.8 Flash (High)\n  effort: high\n`);
  fs.writeFileSync(path.join(root, "modes/oferta.md"), "# Fictional evaluation\n");
  fs.writeFileSync(path.join(root, "cv.md"), "# Fictional candidate\n");
  fs.writeFileSync(path.join(root, "generate-pdf.mjs"), "// Never executed\n");
  fs.writeFileSync(path.join(root, "reports/039-fictional-2026-11-01.md"), "# Fictional report\n");
  const protectedFiles = new Map([
    ["data/applications.md", "| # | Company | Role | Status | Notes |\n|---|---|---|---|---|\n| 1 | Fictional Co | Intern | Applied | Keep my notes |\n"],
    ["data/status-log.tsv", "1\t2026-10-29\tEvaluated\tApplied\tmanual\tKeep\n"],
    ["data/pipeline.md", "## Pending\n- [ ] https://example.test/intern | Fictional | Intern\n"],
  ]);
  for (const [file, text] of protectedFiles) fs.writeFileSync(path.join(root, file), text);
  globalThis.pinFixture = { installed: true, resolved: [], fallbacks: 0, spawns: [], catalog };
  t.after(() => {
    for (const [file, text] of protectedFiles) assert.equal(fs.readFileSync(path.join(root, file), "utf8"), text, file);
    assert.equal(globalThis.pinFixture.fallbacks, 0);
    if (previous === undefined) delete process.env.CAREER_OPS_ROOT; else process.env.CAREER_OPS_ROOT = previous;
    fs.rmSync(root, {recursive: true, force: true});
  });
}
const request = patch => new Request("http://fixture.invalid/api/run", { method: "POST", headers: {"Content-Type": "application/json"}, body: JSON.stringify({kind: "evaluate", cliId: "antigravity", input: "https://example.test/intern", evaluationModel: model, ...patch}) });

test("a configured Argon default is overridden with exact Flash High flags before the spawn boundary", async t => {
  fixture(t);
  const response = await POST(request());
  assert.equal(response.status, 500); // intentional fake-spawner refusal
  assert.match((await response.json()).error, /Fixture stopped/);
  const [{args}] = globalThis.pinFixture.spawns;
  assert.deepEqual(args.slice(0, 5), ["--model", model, "--effort", "high", "-p"]);
  assert.equal(args.length, 6);
  assert.equal(globalThis.pinFixture.spawns.length, 1);
});

test("CV generation verifies and pins Flash High without requiring an evaluation-only client field", async t => {
  fixture(t);
  const response = await POST(request({ kind: "pdf", input: "39", evaluationModel: undefined }));
  assert.equal(response.status, 500); // intentional fake-spawner refusal
  assert.match((await response.json()).error, /Fixture stopped/);
  assert.deepEqual(globalThis.pinFixture.spawns[0].args.slice(0, 5), ["--model", model, "--effort", "high", "-p"]);
});

test("CV generation refuses a missing Flash model before spawning or rendering", async t => {
  fixture(t);
  globalThis.pinFixture.catalog = "gemini-4-argon-medium\tGemini 4 Argon (Medium)\n";
  const response = await POST(request({ kind: "pdf", input: "39", evaluationModel: undefined }));
  assert.equal(response.status, 503);
  assert.equal(globalThis.pinFixture.spawns.length, 0);
});

for (const reason of ["missing CLI", "missing model", "catalog failure", "wrong label"]) {
  test(`${reason} fails before spawning or touching Applied statuses`, async t => {
    fixture(t);
    if (reason === "missing CLI") globalThis.pinFixture.installed = false;
    if (reason === "missing model") globalThis.pinFixture.catalog = "gemini-4-argon-medium\tGemini 4 Argon (Medium)\n";
    if (reason === "catalog failure") globalThis.pinFixture.catalogError = true;
    if (reason === "wrong label") globalThis.pinFixture.catalog = `${model}\tGemini 4 Argon (Medium)\n`;
    const response = await POST(request());
    assert.equal(response.status, 503);
    assert.match((await response.json()).error, /blocked|unavailable/i);
    assert.equal(globalThis.pinFixture.spawns.length, 0);
    const metadata = await GET();
    assert.equal(metadata.status, 503);
    const data = await metadata.json();
    assert.equal(data.pin.model, model);
    assert.equal(data.available, false);
  });
}

test("stale tabs, other CLI choices and tampered model requests cannot start a different model", async t => {
  fixture(t);
  for (const patch of [{evaluationModel: undefined}, {evaluationModel: "gemini-4-argon-medium"}, {cliId: "codex"}]) {
    const response = await POST(request(patch));
    assert.equal(response.status, 409);
    assert.match((await response.json()).error, /Reload/);
  }
  assert.equal(globalThis.pinFixture.spawns.length, 0);
});

test("pre-launch metadata reports the same verified pin without starting an evaluation", async t => {
  fixture(t);
  const response = await GET();
  assert.equal(response.status, 200);
  assert.equal((await response.json()).pin.model, model);
  assert.equal(globalThis.pinFixture.spawns.length, 0);
});
