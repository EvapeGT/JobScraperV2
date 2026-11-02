import path from "node:path";
import { createHash } from "node:crypto";

export const DISCOVERY_APP = "career-ops-internship-desk@1";
export const OFFICIAL_WEB_APP = "career-ops-official-web@1";
export function rootIdentity(root) {
  return createHash("sha256").update(path.resolve(root).toLowerCase()).digest("hex").slice(0, 16);
}
export function discoveryUrl(port = process.env.INTERNSHIP_DESK_PORT || "4381") {
  const numeric = Number(port);
  if (!Number.isInteger(numeric) || numeric < 1024 || numeric > 65535) throw new Error("Invalid local discovery port.");
  return `http://127.0.0.1:${numeric}`;
}

// The official web UI orchestrates the existing collector service. It never
// duplicates ranking, identity matching, scan logic or pipeline writes.
/** @param {{root: string, action?: "data" | "status" | "refresh", fetchFn?: typeof fetch, port?: string | number}} options */
export async function discoveryRequest({ root, action = "data", fetchFn = fetch, port }) {
  if (!["data", "status", "refresh"].includes(action)) throw new Error("Unknown discovery action.");
  const base = discoveryUrl(port);
  const get = async (endpoint, options = {}) => {
    const response = await fetchFn(`${base}/api/${endpoint}`, { cache: "no-store", signal: AbortSignal.timeout(8000), ...options });
    const body = await response.json();
    if (!response.ok) throw new Error(body.error || "The discovery service could not finish this request.");
    return body;
  };
  const health = await get("health");
  if (health.app !== DISCOVERY_APP || health.instance !== rootIdentity(root)) throw new Error("The discovery port belongs to a different app or workspace.");
  if (action === "status") return get("status");
  const { token, ...data } = await get("data");
  if (action === "data") return data;
  if (typeof token !== "string" || !token) throw new Error("The discovery service did not provide its refresh token.");
  return get("refresh", { method: "POST", headers: { Origin: base, "X-Desk-Token": token } });
}
