const SEARCH_BUDGETS = { fast: 5000, balanced: 30000, deep: 120000 };

export function budgetFor(input) {
  return SEARCH_BUDGETS[input.simulationTimeLimit] ?? SEARCH_BUDGETS.balanced;
}

function abortError(message) {
  const error = new Error(message);
  error.name = "AbortError";
  return error;
}

/** Injectable browser boundary; tests use a worker and clock with no real threads. */
export function createCargoPlanRunner({
  WorkerClass = globalThis.Worker,
  setTimer = globalThis.setTimeout,
  clearTimer = globalThis.clearTimeout,
  now = () => performance.now(),
  graceMs = 1000,
} = {}) {
  let sequence = 0;
  let active;

  return function runCargoPlan(input, { onProgress, onBest } = {}) {
    active?.supersede();
    const id = ++sequence;
    const budgetMs = budgetFor(input);
    const startedAt = now();
    let worker, best, finished = false, stopReason, budgetTimer, graceTimer;
    let resolve, reject;
    const promise = new Promise((done, fail) => { resolve = done; reject = fail; });
    const session = {
      supersede() {
        finish(undefined, abortError("本次计算已由新的计算替代。"));
      },
    };
    active = session;

    function finish(result, error) {
      if (finished) return;
      finished = true;
      clearTimer(budgetTimer);
      clearTimer(graceTimer);
      worker?.terminate();
      if (active === session) active = undefined;
      if (error) reject(error);
      else resolve(result);
    }

    function retainedResult(reason, error) {
      if (!best) {
        finish(undefined, reason === "cancelled" ? abortError("计算已取消，尚未产生通过校验的方案。") : error ?? new Error("计算时限已到，尚未产生通过校验的方案。"));
        return;
      }
      finish({
        ...best,
        search: { ...best.search, budgetMs, elapsedMs: Math.min(130000, Math.max(0, now() - startedAt)), stopReason: reason },
        warnings: error ? [...(best.warnings ?? []), `继续优化未完成：${error.message}`] : best.warnings,
      });
    }

    function requestStop(reason) {
      if (finished || stopReason) return;
      stopReason = reason;
      clearTimer(budgetTimer);
      try { worker?.postMessage({ type: "cancel", id, reason }); }
      catch (error) { retainedResult(reason, error); return; }
      graceTimer = setTimer(() => retainedResult(reason), graceMs);
    }

    function acceptBest(result) {
      if (result?.audit?.valid !== true) return false;
      best = result;
      if (active === session && !finished) onBest?.(result);
      return true;
    }

    if (typeof WorkerClass !== "function") {
      finish(undefined, new Error("当前浏览器不支持后台计算（Web Worker），请使用支持此功能的浏览器。"));
      return { promise, cancel() {} };
    }
    try {
      worker = new WorkerClass(new URL("./worker.js", import.meta.url), { type: "module" });
      worker.onmessage = ({ data }) => {
        if (finished || active !== session || data?.id !== id) return;
        if (data.type === "progress") {
          const progress = { ...data.progress };
          if (progress.best && !acceptBest(progress.best)) delete progress.best;
          onProgress?.(progress);
        } else if (data.type === "done") {
          if (!acceptBest(data.result)) {
            retainedResult(stopReason ?? "error", new Error("后台计算未返回通过独立校验的方案。"));
            return;
          }
          if (stopReason) retainedResult(stopReason);
          else finish(data.result);
        } else if (data.type === "error") {
          const error = new Error(data.error?.message ?? "后台计算失败。");
          error.name = data.error?.name ?? "Error";
          retainedResult(stopReason ?? "error", error);
        }
      };
      worker.onerror = event => {
        if (finished || active !== session) return;
        event.preventDefault?.();
        retainedResult(stopReason ?? "error", new Error(event.message ?? "后台计算模块加载失败。"));
      };
      budgetTimer = setTimer(() => requestStop("time-limit"), budgetMs);
      worker.postMessage({ type: "start", id, input });
    } catch (error) {
      finish(undefined, error);
    }
    return { promise, cancel: () => requestStop("cancelled") };
  };
}

export const runCargoPlan = createCargoPlanRunner();
