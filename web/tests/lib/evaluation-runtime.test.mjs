import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { readEvaluationRuntime, parseModelCatalog, createEvaluationModelVerifier, pinnedEvaluationArgs, prepareEvaluationRuntime, pinAntigravityArgs } from "../../src/lib/evaluation-runtime.mjs";

const pin = { cli: "antigravity", model: "gemini-3.8-flash-high", label: "Gemini 3.8 Flash (High)", effort: "high" };
const catalog = "Fetching available models...\r\ngemini-4-argon-medium\tGemini 4 Argon (Medium)\r\ngemini-3.8-flash-high\tGemini 3.8 Flash (High)\r\n";
function fixture(t, contents) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "co-model-pin-"));
  fs.mkdirSync(path.join(root, "config"));
  if (contents !== undefined) fs.writeFileSync(path.join(root, "config/profile.yml"), contents);
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  return root;
}
const profile = `evaluation_runtime:\n  cli: ${pin.cli}\n  model: ${pin.model}\n  label: ${pin.label}\n  effort: ${pin.effort}\n`;

test("the pin is read from the user profile without changing any CLI defaults", t => {
  const root = fixture(t, profile);
  assert.deepEqual(readEvaluationRuntime(root), pin);
  assert.equal(fs.readFileSync(path.join(root, "config/profile.yml"), "utf8"), profile);
});

test("an absent pin preserves other installations; malformed pins block instead of inheriting a model", t => {
  assert.equal(readEvaluationRuntime(fixture(t)), null);
  assert.equal(readEvaluationRuntime(fixture(t, "name: Fictional\n")), null);
  for (const text of ["", "false", "[]", "evaluation_runtime: null", "evaluation_runtime: {}", profile.replace("antigravity", "codex"), profile.replace("effort: high", "effort: surprise"), profile.replace(pin.model, "--model argon"), "evaluation_runtime: ["]) {
    assert.throws(() => readEvaluationRuntime(fixture(t, text)));
  }
});

test("catalog parsing requires an exact model ID and its exact label", async () => {
  assert.equal(parseModelCatalog(catalog).get(pin.model), pin.label);
  for (const text of ["", "Please sign in", "gemini-4-argon-medium\tGemini 4 Argon (Medium)", `${pin.model}\tGemini 4 Argon (Medium)`, `different-id\t${pin.label}`, pin.label]) {
    await assert.rejects(createEvaluationModelVerifier({ load: async () => text })(pin, "agy", "/fixture"), /unavailable/);
  }
});

test("batch verification shares a read-only catalog request and expires after 30 seconds", async () => {
  let time = 0;
  let calls = 0;
  const verify = createEvaluationModelVerifier({ now: () => time, load: async () => { calls++; return catalog; } });
  await Promise.all(Array.from({ length: 23 }, () => verify(pin, "agy", "/fixture")));
  assert.equal(calls, 1);
  time = 29_999;
  await verify(pin, "agy", "/fixture");
  assert.equal(calls, 1);
  time = 30_000;
  await verify(pin, "agy", "/fixture");
  assert.equal(calls, 2);
});

test("catalog failures stop the batch and can be retried without a cached failure", async () => {
  let calls = 0;
  const verify = createEvaluationModelVerifier({ load: async () => { if (++calls === 1) throw new Error("catalog refused"); return catalog; } });
  await assert.rejects(verify(pin, "agy", "/fixture"), /catalog refused/);
  assert.deepEqual(await verify(pin, "agy", "/fixture"), pin);
  assert.equal(calls, 2);
});

test("a pinned launch resolves only Antigravity and passes the exact model and effort as argv", async t => {
  const root = fixture(t, profile);
  const resolvedIds = [];
  const resolve = id => { resolvedIds.push(id); return { spec: { id }, binPath: "/fixture/agy" }; };
  const prepared = await prepareEvaluationRuntime(root, resolve, createEvaluationModelVerifier({ load: async () => catalog }));
  assert.deepEqual(resolvedIds, ["antigravity"]);
  const prompt = "untrusted posting & --model argon\ntext";
  assert.deepEqual(pinnedEvaluationArgs(prepared.pin, prompt), ["--model", pin.model, "--effort", "high", "-p", prompt]);
  await assert.rejects(prepareEvaluationRuntime(root, () => null), /no other CLI/);
});

test("non-evaluation agy argv uses High while prompts remain opaque and conflicting flags fail", t => {
  const root = fixture(t, profile);
  const prompt = "--model gemini-4-argon-medium --effort low";
  const expected = pinnedEvaluationArgs(pin, prompt);
  assert.deepEqual(pinAntigravityArgs(["-p", prompt], root), expected);
  assert.deepEqual(pinAntigravityArgs(expected, root), expected);
  assert.throws(() => pinAntigravityArgs(["--model", "gemini-4-argon-medium", "-p", prompt], root), /conflicts/);
  assert.throws(() => pinAntigravityArgs(["--model=gemini-4-argon-medium", "-p", prompt], root), /conflicts/);
  assert.throws(() => pinAntigravityArgs(["--effort", "medium", "-p", prompt], root), /conflicts/);
  assert.throws(() => pinAntigravityArgs(["--effort=medium", "-p", prompt], root), /conflicts/);
  assert.throws(() => pinAntigravityArgs(["-p", prompt, "--model", "gemini-4-argon-medium"], root), /one print prompt/);
  assert.deepEqual(pinAntigravityArgs(["-p", prompt], fixture(t)), ["-p", prompt]);
});
