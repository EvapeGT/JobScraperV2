import { careerOpsRoot } from "@/lib/career-ops";
import { discoveryRequest } from "@/lib/core/discovery.mjs";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(req: Request) {
  const action = new URL(req.url).searchParams.get("action") === "status" ? "status" : "data";
  try { return Response.json(await discoveryRequest({ root: careerOpsRoot(), action })); }
  catch (error) { return Response.json({ error: `Discovery is unavailable. Run Start Internship Desk again. ${error instanceof Error ? error.message : ""}` }, { status: 503 }); }
}
export async function POST() {
  try { return Response.json(await discoveryRequest({ root: careerOpsRoot(), action: "refresh" }), { status: 202 }); }
  catch (error) { return Response.json({ error: error instanceof Error ? error.message : "Discovery refresh could not start." }, { status: 503 }); }
}
