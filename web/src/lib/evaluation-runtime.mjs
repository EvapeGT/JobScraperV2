import fs from "node:fs";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import * as yaml from "js-yaml";
import { getProfilePath } from "./core/profile-path.mjs";

const execFileAsync = promisify(execFile);

/** Optional user-layer pin. Missing pins preserve the existing runtime selection. */
export function readEvaluationRuntime(root) {
  let text;
  try { text = fs.readFileSync(getProfilePath(root), "utf8"); }
  catch (error) { if (error.code === "ENOENT") return null; throw error; }
  const profile = yaml.load(text);
  if (!profile || typeof profile !== "object" || Array.isArray(profile)) {
    throw new Error("Invalid evaluation profile. Evaluations are blocked; no default model will be used.");
  }
  const pin = profile?.evaluation_runtime;
  if (pin === undefined) return null;
  if (!pin || pin.cli !== "antigravity" || typeof pin.model !== "string" ||
      !/^[a-z0-9][a-z0-9._-]*$/.test(pin.model) ||
      typeof pin.label !== "string" || !pin.label.trim() ||
      !["low", "medium", "high", "xhigh", "max"].includes(pin.effort)) {
    throw new Error("Invalid evaluation_runtime in your profile. Evaluations are blocked; no default model will be used.");
  }
  return { cli: pin.cli, model: pin.model, label: pin.label.trim(), effort: pin.effort };
}

/** agy models emits exact model IDs and display labels separated by a tab. */
export function parseModelCatalog(text) {
  const models = new Map();
  for (const line of text.split(/\r?\n/)) {
    const match = /^([a-z0-9][a-z0-9._-]*)\t+([^\t]+)$/.exec(line.trim());
    if (match) models.set(match[1], match[2].trim());
  }
  return models;
}

async function loadCatalog(binPath, root) {
  try {
    const { stdout } = await execFileAsync(binPath, ["models"], {
      cwd: root, windowsHide: true, timeout: 20_000, maxBuffer: 512 * 1024,
    });
    return stdout;
  } catch {
    throw new Error("Could not verify Antigravity's available models (sign-in, catalog error or timeout). Evaluation blocked; no other model was started.");
  }
}

// One read-only catalog request for concurrent batch entries. Short-lived results
// avoid starting an Antigravity backend for every row; catalog errors are not cached.
export function createEvaluationModelVerifier({ load = loadCatalog, now = Date.now, ttlMs = 30_000 } = {}) {
  const cache = new Map();
  return async (pin, binPath, root) => {
    const key = JSON.stringify([binPath, root]);
    let entry = cache.get(key);
    if (!entry || entry.expires <= now()) {
      entry = { expires: Infinity, promise: null };
      cache.set(key, entry);
      entry.promise = Promise.resolve().then(() => load(binPath, root)).then((text) => {
        entry.expires = now() + ttlMs;
        return parseModelCatalog(text);
      }).catch((error) => {
        if (cache.get(key) === entry) cache.delete(key);
        throw error;
      });
    }
    const models = await entry.promise;
    if (models.get(pin.model) !== pin.label) {
      throw new Error(`${pin.label} (${pin.model}) is unavailable in Antigravity's model catalog. Evaluation blocked; no other model will be used.`);
    }
    return pin;
  };
}

export const verifyEvaluationModel = createEvaluationModelVerifier();

export function pinnedEvaluationArgs(pin, prompt) {
  return ["--model", pin.model, "--effort", pin.effort, "-p", prompt];
}

/** Apply the user pin to every dashboard agy launch, including non-evaluation workers. */
export function pinAntigravityArgs(args, root) {
  const pin = readEvaluationRuntime(root);
  if (!pin) return args;
  // These are the non-interactive invocations the dashboard supports. The
  // prompt is an opaque argument: a flag mentioned in its text is never argv.
  const promptAt = args.findIndex(arg => ["-p", "--print", "--prompt"].includes(arg));
  if (promptAt < 0 || promptAt !== args.length - 2) {
    throw new Error("Pinned Antigravity runs require one print prompt. No AI run was started.");
  }
  const prefix = args.slice(0, promptAt);
  for (let i = 0; i < prefix.length; i++) {
    const arg = prefix[i];
    for (const [flag, expected] of [["--model", pin.model], ["--effort", pin.effort]]) {
      if (arg === flag) {
        if (prefix[++i] !== expected) throw new Error(`Antigravity ${flag} conflicts with the profile pin. No AI run was started.`);
      } else if (arg.startsWith(`${flag}=`) && arg !== `${flag}=${expected}`) {
        throw new Error(`Antigravity ${flag} conflicts with the profile pin. No AI run was started.`);
      }
    }
  }
  const has = flag => prefix.some(arg => arg === flag || arg.startsWith(`${flag}=`));
  return [
    ...(!has("--model") ? ["--model", pin.model] : []),
    ...(!has("--effort") ? ["--effort", pin.effort] : []),
    ...args,
  ];
}

/** Strict resolution: a pinned evaluation must never substitute another CLI. */
export async function prepareEvaluationRuntime(root, resolveCli, verify = verifyEvaluationModel) {
  const pin = readEvaluationRuntime(root);
  if (!pin) return null;
  const resolved = resolveCli(pin.cli);
  if (!resolved) throw new Error(`Pinned evaluation runtime '${pin.cli}' is not installed. Evaluation blocked; no other CLI will be used.`);
  await verify(pin, resolved.binPath, root);
  return { ...resolved, pin };
}
