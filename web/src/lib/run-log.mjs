// Logs are diagnostic records, never candidate facts or evidence of an
// application. A failed attempt must not acquire a confident score in its log.
export function formatRunLog(body) {
  const failed = body.status === "error";
  const steps = (Array.isArray(body.steps) ? body.steps : [])
    .map((step) => `- ${step.kind === "tool" ? `🔧 ${step.label}` : step.label}`)
    .join("\n");
  const verdict = !failed && body.result?.score != null
    ? `${body.result.score}/5 — ${body.result.summary || ""}` : "—";
  return `# Web run · ${body.title || body.id}

- id: ${body.id}
- status: ${failed ? "failed" : "completed"}
- page: ${body.page || "-"}
- input: ${body.input || "-"}
- verdict: ${verdict}

## Steps
${steps}

## Output
${body.output || ""}
`;
}
