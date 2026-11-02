"use client";

import { useEffect, useState } from "react";

export type EvaluationPin = { cli: string; model: string; label: string; effort: string };
export type EvaluationRuntimeState = { ready: boolean; loading: boolean; pin: EvaluationPin | null; error: string };

export function useEvaluationRuntimeProbe(): EvaluationRuntimeState {
  const [state, setState] = useState<EvaluationRuntimeState>({ ready: false, loading: true, pin: null, error: "" });
  useEffect(() => {
    const controller = new AbortController();
    let request = 0;
    const check = async () => {
      const current = ++request;
      setState((s) => ({ ...s, ready: false, loading: true }));
      try {
        const response = await fetch("/api/evaluation-runtime", { cache: "no-store", signal: controller.signal });
        const data = await response.json();
        if (controller.signal.aborted || current !== request) return;
        setState({ ready: response.ok && data.available === true, loading: false, pin: data.pin ?? null, error: data.error || "" });
      } catch {
        if (!controller.signal.aborted && current === request) setState((s) => ({ ...s, ready: false, loading: false, error: "Could not verify the evaluation model. Reload to retry; evaluation is blocked." }));
      }
    };
    void check();
    window.addEventListener("focus", check);
    return () => { controller.abort(); window.removeEventListener("focus", check); };
  }, []);
  return state;
}

export function EvaluationRuntimeNotice({ state }: { state: EvaluationRuntimeState }) {
  return (
    <div className="my-2 text-xs text-muted">
      {state.pin && <p className="font-medium text-foreground">Evaluation model: {state.pin.label} · Antigravity · pinned</p>}
      {state.loading ? <p role="status">Checking model availability…</p> : state.error ? <p role="alert" className="text-red-600 dark:text-red-400">{state.error}</p> : state.pin ? <p>{state.pin.model} · effort {state.pin.effort}. Stops if unavailable; no model fallback.</p> : <p>Evaluation uses the AI CLI selected in Config.</p>}
    </div>
  );
}
