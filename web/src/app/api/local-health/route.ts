import { careerOpsRoot } from "@/lib/career-ops";
import { OFFICIAL_WEB_APP, rootIdentity } from "@/lib/core/discovery.mjs";

export const dynamic = "force-dynamic";
export function GET() {
  return Response.json({ app: OFFICIAL_WEB_APP, instance: rootIdentity(careerOpsRoot()) });
}
