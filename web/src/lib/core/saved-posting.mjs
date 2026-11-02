import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";

/** A user-selected captured JD is input text, never proof of current liveness. */
export function prepareSavedPosting(root, url) {
  const file = path.join(root, "data/discovery/listings.json");
  let raw;
  try { raw = fs.readFileSync(file, "utf8"); }
  catch (error) { if (error.code === "ENOENT") throw new Error("No saved discovery descriptions exist. Refresh Internships first, or turn off saved-description scoring."); throw error; }
  const index = JSON.parse(raw.replace(/^\uFEFF/, ""));
  if (!Array.isArray(index.listings)) throw new Error("The saved discovery index is malformed.");
  const job = index.listings.find(item => item.canonical_url === url || item.sources?.some(source => source.url === url || source.direct_url === url));
  if (!job) throw new Error("This posting has no matching saved description. Turn off saved-description scoring to check its URL instead.");
  if (job.expired || job.exclusion_reason === "expired") throw new Error("This saved posting is marked expired; it cannot be scored as an active opportunity.");
  if (typeof job.description !== "string" || job.description.trim().length < 120) throw new Error("This posting has no complete saved job description. Open the original listing and supply its full text.");
  const capture = { schema: "career-ops-saved-jd@1", source_url: url, canonical_url: job.canonical_url,
    company: job.company, title: job.title, captured_at: job.description_captured_at || job.last_seen_at || null,
    verification: "unconfirmed — saved job-description text, not a current liveness check", description: job.description };
  const text = JSON.stringify(capture, null, 2) + "\n";
  const digest = createHash("sha256").update(text).digest("hex");
  const relative = `data/discovery/evaluation-inputs/${digest}.json`;
  const destination = path.join(root, relative);
  fs.mkdirSync(path.dirname(destination), { recursive: true });
  if (fs.existsSync(destination)) {
    if (fs.readFileSync(destination, "utf8") !== text) throw new Error("A saved evaluation input was modified; refusing to reuse different text under the same identity.");
  } else fs.writeFileSync(destination, text, { flag: "wx" });
  return { file: relative, capturedAt: capture.captured_at };
}
