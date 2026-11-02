// A reload cannot reconnect to the original request. Preserve its partial
// output and identify the interruption without retrying or inventing a score.
export function restoreJobHistory(history, now = Date.now()) {
  return history.map((job) => job.status === "running" ? {
    ...job,
    status: "error",
    result: undefined,
    endedAt: now,
    steps: [...(job.steps || []), { kind: "status", label: "Interrupted (page reloaded)", ts: now }],
  } : job);
}
