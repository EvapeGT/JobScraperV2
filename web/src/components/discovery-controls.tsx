"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { RefreshCw } from "lucide-react";

type Status = { id?: string | null; running: boolean; phase: string; message: string; sources?: Record<string, string> };
export function DiscoveryControls() {
  const router = useRouter();
  const [status, setStatus] = useState<Status | null>(null);
  const [error, setError] = useState("");
  const [starting, setStarting] = useState(false);
  const running = useRef(false);
  const lastId = useRef<string | null>(null);

  useEffect(() => {
    let live = true, timer: ReturnType<typeof setTimeout>;
    async function poll() {
      try {
        const response = await fetch("/api/discovery?action=status", { cache: "no-store" });
        const next = await response.json();
        if (!response.ok) throw new Error(next.error);
        if (!live) return;
        setError("");
        setStatus(next);
        if (!next.running && (running.current || lastId.current && lastId.current !== next.id)) router.refresh();
        running.current = next.running; lastId.current = next.id;
        timer = setTimeout(poll, next.running ? 1500 : 8000);
      } catch (reason) {
        if (!live) return;
        setError(reason instanceof Error ? reason.message : "Could not read discovery status.");
        timer = setTimeout(poll, 8000);
      }
    }
    void poll();
    return () => { live = false; clearTimeout(timer); };
  }, [router]);

  async function refresh() {
    setStarting(true); setError("");
    try {
      const response = await fetch("/api/discovery", { method: "POST" });
      const next = await response.json();
      if (!response.ok) throw new Error(next.error);
      running.current = true; setStatus(next);
    } catch (reason) { setError(reason instanceof Error ? reason.message : "The search could not start."); }
    finally { setStarting(false); }
  }
  return <div className="space-y-3">
    <button type="button" onClick={refresh} disabled={starting || status?.running} className="inline-flex items-center gap-2 rounded-md bg-brand px-4 py-2.5 text-sm font-semibold text-brand-foreground hover:bg-brand-200 disabled:cursor-wait disabled:opacity-60">
      <RefreshCw className={`size-4 ${status?.running ? "motion-safe:animate-spin" : ""}`} />
      {starting || status?.running ? "Refreshing discovery…" : "Refresh Career-ops + JobSpy"}
    </button>
    <div role="status" aria-live="polite" className="text-sm text-muted">
      {error ? <p className="text-red-700 dark:text-red-400">{error}</p> : status?.id ? <p>{status.message}</p> : <p>Refresh searches company sources, JobStreet, Indeed and LinkedIn. Scoring starts only when you request it in the inbox.</p>}
      {status?.running && <p className="mt-2 text-xs">Company sources: {status.sources?.native || "waiting"} · JobSpy: {status.sources?.jobspy || "waiting"} · JobStreet: {status.sources?.jobstreet || "waiting"}. Saved results remain available.</p>}
    </div>
  </div>;
}
