import assert from "node:assert/strict";
import test from "node:test";
import {
  solveBaseline, normalizeInput, makeBox, validateStackSafety,
  applyTopLoad, directSupportItems, toBrowserResult,
} from "./solver/core.js";

const palletInput = (product = {}, pallet = {}, container = {}) => ({
  mode: "pallet",
  products: [{ sku: "A", l: 500, w: 500, h: 150, q: 3, kg: 10, rotate: false, side: false, ...product }],
  pallet: { l: 500, w: 500, maxH: 1800, qty: 10, gap: 200, ...pallet },
  container: { l: 1900, w: 500, h: 2400, kg: 10000, quantity: 1, ...container },
});

test("pallet items obey non-stackable, maximum layers, and zero top load", () => {
  for (const product of [{ stackable: false }, { maxLayers: 1 }, { maxTopKg: 0 }]) {
    const result = solveBaseline(palletInput(product));
    assert.equal(result.placements.length, 3);
    assert.equal(result.palletPlacements.length, 3);
    assert.ok(result.placements.every(item => item.z === 144));
    assert.ok(result.palletPlacements.every(item => item.z === 0));
  }
});

test("finite pallet quantity limits actual pallets and keeps ungrouped cargo in unloaded totals", () => {
  const result = solveBaseline(palletInput({ stackable: false }, { qty: 1 }));
  assert.equal(result.palletsUsed, 1);
  assert.equal(result.loadedByProduct[0], 1);
  assert.equal(result.unloaded.reduce((sum, item) => sum + item.remaining, 0), 2);
  assert.equal(result.unloaded[0].reasonCode, "PALLET_PACKING_LIMIT");
  assert.equal(solveBaseline(palletInput({}, { qty: 0 })).placements.length, 0);
});

test("configured gap is honored between floor pallets without requiring a trailing wall gap", () => {
  const result = solveBaseline(palletInput({ stackable: false }));
  assert.deepEqual(result.palletPlacements.map(item => item.x), [0, 700, 1400]);
  assert.equal(result.palletPlacements.at(-1).x + result.palletPlacements.at(-1).lengthMm, 1900);
  assert.ok(result.palletPlacements.every(item => item.z === 0));
});

test("loaded-height includes the pallet only once: 11 cartons fit at 1794 mm", () => {
  const result = solveBaseline(palletInput({ q: 11 }, { qty: 1 }));
  assert.equal(result.loadedByProduct[0], 11);
  assert.equal(result.palletPlacements[0].totalHeightMm, 1794);
  assert.equal(result.metrics.minimumSupportRatio, 1);
  assert.equal(result.sceneItems.filter(item => item.kind === "pallet").length, 1);
  assert.ok(result.placements.every(item => item.palletId === result.palletPlacements[0].id));
});

test("legacy browser h field remains loaded-height and never becomes pallet thickness", () => {
  const input = palletInput({ q: 11 }, { h: 1800, maxH: 1800, qty: 1 });
  assert.equal(normalizeInput(input).palletTypes[0].heightMm, 144);
  const result = solveBaseline(input);
  assert.equal(result.loadedByProduct[0], 11);
  assert.equal(result.palletPlacements[0].heightMm, 144);
  assert.equal(result.palletPlacements[0].totalHeightMm, 1794);
  input.pallet.heightMm = 100;
  assert.equal(normalizeInput(input).palletTypes[0].heightMm, 100);
});

test("pallet top-load limit includes all upper cartons and tare counts toward payload", () => {
  const result = solveBaseline(palletInput({ maxTopKg: 15 }, { qty: 1 }));
  assert.equal(result.loadedByProduct[0], 2);
  assert.equal(result.unloaded[0].remaining, 1);
  const overloaded = solveBaseline(palletInput({ q: 1, kg: 100 }, { qty: 1, emptyWeightKg: 20 }, { kg: 110 }));
  assert.equal(overloaded.placements.length, 0);
  assert.equal(overloaded.unloaded[0].remaining, 1);
});

test("unknown top load stays unknown; zero remains a real constraint", () => {
  for (const maxTopKg of [null, undefined]) {
    assert.equal(normalizeInput(palletInput({ maxTopKg })).products[0].maxTopLoadG, undefined);
  }
  assert.equal(normalizeInput(palletInput({ maxTopKg: 0 })).products[0].maxTopLoadG, 0);
});

test("mixed-SKU maximum layers applies upward from each supporting carton", () => {
  const products = [{ maxStackLayers: 2 }, { maxStackLayers: 10 }, { maxStackLayers: 1 }];
  const bottom = { box: makeBox(0, 0, 0, 100, 100, 100), productIndex: 0, topLoadG: 0, supports: [] };
  const middle = { box: makeBox(0, 0, 100, 100, 100, 100), productIndex: 1, topLoadG: 0, supports: [bottom] };
  const top = makeBox(0, 0, 200, 100, 100, 100);
  assert.equal(validateStackSafety(top, products[2], 1000, [bottom, middle], products).reasonCode, "MAX_STACK_LAYERS");
  assert.equal(validateStackSafety(middle.box, products[2], 1000, [bottom], products).ok, true);
});

test("loads follow contact supports even where a lower box is outside the upper box projection", () => {
  const products = [{ maxTopLoadG: 5000 }, {}, {}];
  const bottom = { box: makeBox(0, 0, 0, 100, 100, 100), productIndex: 0, topLoadG: 1000, supports: [] };
  const bridge = { box: makeBox(0, 0, 100, 150, 100, 100), productIndex: 1, topLoadG: 0, supports: [bottom] };
  const top = makeBox(100, 0, 200, 50, 100, 100);
  assert.equal(validateStackSafety(top, products[2], 10000, [bottom, bridge], products).reasonCode, "MAX_TOP_LOAD");
  applyTopLoad(top, 2000, [bottom, bridge], products);
  assert.equal(bottom.topLoadG, 3000);
  assert.equal(bridge.topLoadG, 2000);
  assert.deepEqual(directSupportItems(top, [bottom, bridge]), [bridge]);
});

test("reported support is measured rather than replaced by the requested 100 percent", () => {
  const orientation = (lengthMm, heightMm) => ({ code: "LWH", lengthMm, widthMm: 100, heightMm });
  const result = toBrowserResult({
    placements: [
      { productIndex: 0, sku: "A", containerIndex: 0, x: 0, y: 0, z: 0, orientation: orientation(60, 100) },
      { productIndex: 1, sku: "B", containerIndex: 0, x: 0, y: 0, z: 100, orientation: orientation(100, 100) },
    ], metrics: { minimumSupportRatio: 1 }, warnings: [],
  }, [{}, {}], 0, []);
  assert.equal(result.metrics.minimumSupportRatio, 0.6);
});

test("expired deadline stops safely and preserves total requested quantity", () => {
  const result = solveBaseline(palletInput(), { deadline: performance.now() - 1 });
  assert.equal(result.placements.length, 0);
  assert.equal(result.unloaded.reduce((sum, item) => sum + item.remaining, 0), 3);
});
