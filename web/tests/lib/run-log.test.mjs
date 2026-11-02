import test from "node:test";
import assert from "node:assert/strict";
import { formatRunLog } from "../../src/lib/run-log.mjs";

test("failed logs retain the terminal cause and partial output without a confident score", () => {
  const md = formatRunLog({ id: "job-1", title: "Score", status: "error",
    result: { score: 4.5, summary: "Unfinished draft" },
    steps: [{ kind: "tool", label: "WebFetch" }, { kind: "status", label: "Posting unavailable; supply the full text." }],
    output: "The board returned a login wall." });
  assert.match(md, /status: failed/);
  assert.match(md, /verdict: —/);
  assert.doesNotMatch(md, /4\.5\/5|Unfinished draft/);
  assert.match(md, /Posting unavailable; supply the full text/);
  assert.match(md, /The board returned a login wall/);
});

test("successful and legacy log requests retain their verdict", () => {
  for (const status of ["done", undefined]) {
    const md = formatRunLog({ id: "job-2", status, result: { score: 3.2, summary: "Supported fit" } });
    assert.match(md, /status: completed/);
    assert.match(md, /verdict: 3\.2\/5 — Supported fit/);
  }
});
