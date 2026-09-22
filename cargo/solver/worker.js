import { budgetFor } from "./client.js";

export function createWorkerHandler(solvePlan, postMessage) {
  let active;
  return async function handleMessage(message) {
    if (message?.type === "cancel") {
      if (active?.id === message.id) active.stopReason = message.reason === "time-limit" ? "time-limit" : "cancelled";
      return;
    }
    if (message?.type !== "start") return;
    if (active) active.stopReason = "cancelled";
    const job = { id: message.id, stopReason: null };
    active = job;
    const budgetMs = budgetFor(message.input);
    try {
      const result = await solvePlan(message.input, {
        budgetMs,
        shouldStop: () => Boolean(job.stopReason),
        onProgress(progress) {
          if (active !== job) return;
          const safeProgress = { ...progress };
          if (safeProgress.best?.audit?.valid !== true) delete safeProgress.best;
          postMessage({ type: "progress", id: job.id, progress: safeProgress });
        },
      });
      if (active !== job) return;
      postMessage({
        type: "done", id: job.id,
        result: job.stopReason ? { ...result, search: { ...result.search, budgetMs, stopReason: job.stopReason } } : result,
      });
    } catch (error) {
      if (active === job) postMessage({ type: "error", id: job.id, error: { name: error.name ?? "Error", message: error.message ?? String(error) } });
    } finally {
      if (active === job) active = undefined;
    }
  };
}

if (typeof WorkerGlobalScope !== "undefined" && globalThis instanceof WorkerGlobalScope) {
  const handleMessage = createWorkerHandler(
    async (input, controls) => (await import("./engine.js")).solvePlan(input, controls),
    message => globalThis.postMessage(message),
  );
  globalThis.addEventListener("message", event => { void handleMessage(event.data); });
}
