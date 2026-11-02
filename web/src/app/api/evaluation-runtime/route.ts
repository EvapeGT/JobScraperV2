import { careerOpsRoot } from "@/lib/career-ops";
import { resolveCli } from "@/lib/clis";
import { readEvaluationRuntime, prepareEvaluationRuntime } from "@/lib/evaluation-runtime.mjs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Metadata only: listing models never submits an evaluation prompt.
export async function GET() {
  let pin = null;
  try {
    const root = careerOpsRoot();
    pin = readEvaluationRuntime(root);
    await prepareEvaluationRuntime(root, resolveCli);
    return Response.json({ pin, available: true }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return Response.json({ pin, available: false, error: error instanceof Error ? error.message : "Could not verify the evaluation model." },
      { status: 503, headers: { "Cache-Control": "no-store" } });
  }
}
