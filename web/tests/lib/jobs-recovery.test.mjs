import test from "node:test";
import assert from "node:assert/strict";
import { restoreJobHistory } from "../../src/lib/jobs-recovery.mjs";
import { formatRunLog } from "../../src/lib/run-log.mjs";

test("reload recovery preserves the failure evidence and never promotes partial scores", () => {
  const running = { id: "job-active", status: "running", text: "Reading the posting", result: { score: 4 }, steps: [{ kind: "status", label: "Agent ready" }] };
  const [restored] = restoreJobHistory([running], 100);
  assert.equal(restored.status, "error");
  assert.equal(restored.result, undefined);
  assert.equal(restored.endedAt, 100);
  assert.equal(running.status, "running", "stored history is not mutated");
  const log = formatRunLog({ ...restored, output: restored.text });
  assert.match(log, /status: failed/);
  assert.match(log, /Interrupted \(page reloaded\)/);
  assert.match(log, /Reading the posting/);
  assert.doesNotMatch(log, /4\/5/);
});

test("recovery leaves settled jobs intact and does not append repeat interruptions", () => {
  const done = { id: "done", status: "done", reportN: 2, result: { score: 3 } };
  const failed = { id: "failed", status: "error", steps: [{ label: "Posting unavailable" }] };
  const recovered = restoreJobHistory([done, failed], 100);
  assert.equal(recovered[0], done);
  assert.equal(recovered[1], failed);
  assert.deepEqual(restoreJobHistory(recovered, 200), recovered);
});
