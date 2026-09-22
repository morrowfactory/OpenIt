import assert from "node:assert/strict";
import test from "node:test";
import { budgetFor, createCargoPlanRunner } from "./solver/client.js";
import { createWorkerHandler } from "./solver/worker.js";

const validPlan = (count = 1) => ({
  audit: { valid: true }, loadedByProduct: [count], placements: [{ id: `box-${count}` }],
  warnings: [], search: { attempts: 1, stopReason: "complete" },
});

function harness() {
  let now = 0, nextTimer = 0;
  const timers = new Map(), workers = [];
  class FakeWorker {
    constructor(url, options) { this.url = url; this.options = options; this.messages = []; workers.push(this); }
    postMessage(message) { this.messages.push(message); }
    terminate() { this.terminated = true; }
    emit(message) { this.onmessage?.({ data: { id: this.messages[0].id, ...message } }); }
  }
  const run = createCargoPlanRunner({
    WorkerClass: FakeWorker,
    setTimer: (fn, delay) => { const id = ++nextTimer; timers.set(id, { fn, at: now + delay }); return id; },
    clearTimer: id => timers.delete(id),
  });
  function advance(ms) {
    const target = now + ms;
    for (;;) {
      const next = [...timers.entries()].filter(([, timer]) => timer.at <= target).sort((a, b) => a[1].at - b[1].at)[0];
      if (!next) break;
      now = next[1].at;
      timers.delete(next[0]);
      next[1].fn();
    }
    now = target;
  }
  return { run, workers, advance, timers };
}

test("search budgets are the selected 5 seconds, 30 seconds, or 2 minutes", () => {
  assert.deepEqual(["fast", "balanced", "deep"].map(simulationTimeLimit => budgetFor({ simulationTimeLimit })), [5000, 30000, 120000]);
});

test("cancellation returns the latest validated best after one second of cleanup", async () => {
  const h = harness(), best = validPlan(5), callbackResults = [];
  const job = h.run({ simulationTimeLimit: "deep" }, { onBest: result => callbackResults.push(result) });
  h.workers[0].emit({ type: "progress", progress: { attempt: 1, best } });
  job.cancel();
  assert.equal(h.workers[0].messages.at(-1).type, "cancel");
  h.advance(1000);
  const result = await job.promise;
  assert.deepEqual(result.placements, best.placements);
  assert.equal(result.search.stopReason, "cancelled");
  assert.equal(best.search.stopReason, "complete");
  assert.equal(h.workers[0].terminated, true);
  assert.deepEqual(callbackResults, [best]);
  assert.equal(h.timers.size, 0);
});

test("time budget retains a validated candidate and ignores late worker completion", async () => {
  const h = harness(), best = validPlan(2), seen = [];
  const job = h.run({ simulationTimeLimit: "fast" }, { onProgress: progress => seen.push(progress) });
  h.workers[0].emit({ type: "progress", progress: { best } });
  h.advance(5000);
  assert.equal(h.workers[0].terminated, undefined);
  assert.equal(h.workers[0].messages.at(-1).reason, "time-limit");
  h.advance(1000);
  assert.equal((await job.promise).search.stopReason, "time-limit");
  h.workers[0].emit({ type: "done", result: validPlan(99) });
  h.workers[0].emit({ type: "progress", progress: { best: validPlan(99) } });
  assert.equal(seen.length, 1);
});

test("superseded requests settle with AbortError and cannot overwrite new callbacks", async () => {
  const h = harness(), oldSeen = [], newSeen = [];
  const old = h.run({}, { onBest: result => oldSeen.push(result) });
  const oldRejected = assert.rejects(old.promise, { name: "AbortError" });
  const current = h.run({}, { onBest: result => newSeen.push(result) });
  h.workers[0].emit({ type: "done", result: validPlan(88) });
  h.workers[1].emit({ type: "progress", id: h.workers[0].messages[0].id, progress: { best: validPlan(77) } });
  h.workers[1].emit({ type: "done", result: validPlan(3) });
  await oldRejected;
  assert.equal((await current.promise).loadedByProduct[0], 3);
  assert.deepEqual(oldSeen, []);
  assert.equal(newSeen.length, 1);
});

test("invalid progress cannot become a fallback; cancellation with no best rejects", async () => {
  const h = harness(), seen = [], progressSeen = [];
  const job = h.run({}, { onBest: result => seen.push(result), onProgress: progress => progressSeen.push(progress) });
  h.workers[0].emit({ type: "progress", progress: { best: { audit: { valid: false }, placements: [1] } } });
  job.cancel();
  const rejected = assert.rejects(job.promise, { name: "AbortError" });
  h.advance(1000);
  await rejected;
  assert.deepEqual(seen, []);
  assert.equal(progressSeen[0].best, undefined);
});

test("worker errors reject when no validated candidate exists", async () => {
  const h = harness(), job = h.run({});
  const rejected = assert.rejects(job.promise, /模块失败/);
  h.workers[0].emit({ type: "error", error: { name: "Error", message: "模块失败" } });
  await rejected;
  assert.equal(h.workers[0].terminated, true);
});

test("Worker-unavailable browsers get an explicit error without invoking a synchronous solver", async () => {
  const run = createCargoPlanRunner({ WorkerClass: null });
  await assert.rejects(run({}).promise, /不支持后台计算/);
});

test("worker protocol forwards only validated best and keeps cancellation request IDs", async () => {
  const sent = [];
  let finish, controls;
  const handle = createWorkerHandler((_input, options) => {
    controls = options;
    return new Promise(resolve => { finish = resolve; });
  }, message => sent.push(message));
  const running = handle({ type: "start", id: 17, input: { simulationTimeLimit: "fast" } });
  assert.equal(controls.budgetMs, 5000);
  controls.onProgress({ best: { audit: { valid: false } }, attempt: 1 });
  controls.onProgress({ best: validPlan(), attempt: 2 });
  assert.equal(sent[0].progress.best, undefined);
  assert.equal(sent[1].progress.best.audit.valid, true);
  await handle({ type: "cancel", id: 99 });
  assert.equal(controls.shouldStop(), false);
  await handle({ type: "cancel", id: 17 });
  assert.equal(controls.shouldStop(), true);
  finish(validPlan());
  await running;
  assert.equal(sent.at(-1).id, 17);
  assert.equal(sent.at(-1).result.search.stopReason, "cancelled");
});

test("worker protocol suppresses completion from an obsolete job", async () => {
  const sent = [], finishes = [];
  const handle = createWorkerHandler(() => new Promise(resolve => finishes.push(resolve)), message => sent.push(message));
  const first = handle({ type: "start", id: 1, input: {} });
  const second = handle({ type: "start", id: 2, input: {} });
  finishes[0](validPlan(1));
  await first;
  finishes[1](validPlan(2));
  await second;
  assert.deepEqual(sent.map(message => message.id), [2]);
});
