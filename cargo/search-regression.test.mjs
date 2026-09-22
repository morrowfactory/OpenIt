import assert from "node:assert/strict";
import test from "node:test";
import { searchPlans, comparePlans } from "./solver/search.js";
import { solveBaseline } from "./solver/core.js";
import { validateResult } from "./solver/validation.js";

const product = (sku, l, w, h, q, extra = {}) => ({ sku, name: sku, l, w, h, q, kg: 1,
  rotate: true, side: false, stackable: true, ...extra });
const inputFor = (products, dimensions = [600, 400, 100], quantity = 1) => ({
  mode: "loose", products, looseCargoMaxGapMm: 50, optimizationGoal: "complete-order",
  container: { l: dimensions[0], w: dimensions[1], h: dimensions[2], kg: 28800, quantity },
});

function candidates(input, controls = {}) {
  const results = [];
  for (const event of searchPlans(input, { maxAttempts: 8, ...controls })) {
    if (event.type !== "candidate") continue;
    const audit = validateResult(input, event.result);
    assert.equal(audit.valid, true, JSON.stringify(audit.errors));
    results.push(event.result);
  }
  return results;
}

const bestOf = (results, input) => results.reduce((best, result) => comparePlans(result, best, input) > 0 ? result : best, null);

test("adjacent free regions fit all six floor cartons before opening another container", () => {
  for (const quantity of [1, 2]) {
    const input = inputFor([
      product("A", 200, 200, 100, 3, { stackable: false }),
      product("B", 100, 300, 100, 3, { stackable: false }),
    ], [600, 400, 100], quantity);
    const results = candidates(input, { maxAttempts: 6 });
    if (quantity === 1) assert.deepEqual(results[0].loadedByProduct, [3, 2]);
    else assert.equal(results[0].metrics.containersUsed, 2);
    const best = bestOf(results, input);
    assert.deepEqual(best.loadedByProduct, [3, 3]);
    assert.equal(best.metrics.containersUsed, 1);
    assert.equal(best.metrics.oversizedGapCount, 0);
    assert.ok(best.sceneItems.every(item => item.originMm.z === 0));
  }
});

test("every alternative respects stack limits, top load and group boundaries", () => {
  const input = inputFor([
    product("fragile", 100, 100, 100, 8, { group: 1, stackable: false, maxTopKg: 0 }),
    product("base", 100, 100, 100, 8, { group: 1, maxLayers: 2, maxTopKg: 1 }),
    product("later", 100, 100, 100, 8, { group: 2, maxLayers: 1 }),
  ], [600, 200, 300], 2);
  input.priorityGroupMode = "virtual-wall";
  const results = candidates(input);
  assert.equal(results.length, 9);
  assert.ok(bestOf(results, input).sceneItems.length >= results[0].sceneItems.length);
});

test("volume and complete-order objectives choose different real capacity-limited plans", () => {
  const input = inputFor([
    product("large", 400, 300, 100, 1, { rotate: false }),
    product("small", 100, 100, 100, 10, { rotate: false }),
  ], [400, 300, 100]);
  const results = candidates(input);
  assert.deepEqual(bestOf(results, input).loadedByProduct, [0, 10]);
  assert.deepEqual(bestOf(results, { ...input, optimizationGoal: "volume" }).loadedByProduct, [1, 0]);
});

test("weight balance moves heavy cargo toward the center without reducing count or adding containers", () => {
  const input = inputFor([
    product("heavy", 200, 200, 100, 1, { kg: 9, rotate: false }),
    product("light", 100, 200, 100, 4, { rotate: false }),
  ], [600, 200, 100]);
  input.optimizationGoal = "weight-balance";
  const results = candidates(input), best = bestOf(results, input);
  assert.deepEqual(best.loadedByProduct, [1, 4]);
  assert.equal(best.metrics.containersUsed, 1);
  assert.ok(Math.abs(results[0].metrics.containerDiagnostics[0].longitudinalCenterOffsetMm) > 100);
  assert.equal(best.metrics.containerDiagnostics[0].longitudinalCenterOffsetMm, 0);
});

test("longer searches contain the deterministic short-search prefix and cannot worsen the selected plan", () => {
  const input = inputFor([product("A", 200, 200, 100, 3), product("B", 100, 300, 100, 3)]);
  const short = candidates(input, { maxAttempts: 2 }), long = candidates(input, { maxAttempts: 8 });
  assert.deepEqual(long.slice(0, short.length), short);
  assert.deepEqual(candidates(input, { maxAttempts: 2 }), short);
  assert.ok(comparePlans(bestOf(long, input), bestOf(short, input), input) >= 0);
});

test("cancellation between progress yields retains the validated baseline", () => {
  const input = inputFor([product("A", 100, 100, 100, 200)], [1000, 1000, 300]);
  const baseline = solveBaseline(input);
  let cancel = false, progress = 0, best = null;
  for (const event of searchPlans(input, { baseline, maxAttempts: 4, shouldStop: () => cancel })) {
    if (event.type === "progress") { progress++; cancel = true; }
    if (event.type === "candidate") {
      assert.equal(validateResult(input, event.result).valid, true);
      if (comparePlans(event.result, best, input) > 0) best = event.result;
    }
  }
  assert.equal(progress, 1);
  assert.deepEqual(best, baseline);
  let ticks = 0;
  const timed = [...searchPlans(input, { baseline, deadline: 4, now: () => ++ticks })];
  assert.ok(ticks < 10);
  assert.equal(timed.filter(event => event.type === "candidate").length, 2);
  assert.equal(timed.at(-1).stopReason, "deadline-or-cancel");
});

test("historical single-SKU and mixed-container cases retain their baseline when alternatives are worse", () => {
  const standard = [product("BX-1001", 520, 380, 310, 420, { kg: 8.5, side: true }),
    product("CH-2040", 920, 480, 180, 160, { kg: 6.2, side: true }),
    product("CB-3012", 680, 420, 760, 96, { kg: 22 })];
  const scenarios = [
    inputFor(standard, [12032, 2352, 2698]),
    inputFor([standard[0], product("SKU-1002", 800, 800, 250, 100, { kg: 10 })], [12032, 2352, 2698]),
    inputFor([product("BX-1001", 520, 380, 310, 2000, { kg: 8.5, side: true })], [12032, 2352, 2698]),
    inputFor(standard.map(p => p.sku === "CB-3012" ? { ...p, q: 500 } : p), [12032, 2352, 2698], 3),
  ];
  for (const input of scenarios) {
    const results = candidates(input, { maxAttempts: 2 }), best = bestOf(results, input);
    assert.ok(best.sceneItems.length >= results[0].sceneItems.length);
    if (best.sceneItems.length === results[0].sceneItems.length) assert.ok(best.metrics.containersUsed <= results[0].metrics.containersUsed);
  }
});
