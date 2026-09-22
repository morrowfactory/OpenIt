import assert from 'node:assert/strict';
import test from 'node:test';
import { solveBaseline } from './solver/core.js';
import { searchPlans } from './solver/search.js';
import { validateResult } from './solver/validation.js';
import { diagnoseOperations } from './solver/operations.js';

const product = (sku, l, w, h, q = 1) => ({ sku, l, w, h, q, kg: 1, rotate: true, side: false });

test('cargo that cannot pass any permitted orientation is left out while feasible cargo still loads', () => {
  const input = { mode: 'loose', products: [product('too-wide', 400, 300, 300), product('fits', 100, 100, 100, 2)],
    container: { l: 600, w: 600, h: 600, kg: 1000, quantity: 1, doorWidthMm: 200, doorHeightMm: 200 } };
  for (const event of searchPlans(input, { maxAttempts: 3 })) {
    if (event.type !== 'candidate') continue;
    assert.deepEqual(event.result.loadedByProduct, [0, 2]);
    assert.equal(validateResult(input, event.result).valid, true);
    assert.equal(diagnoseOperations(input, event.result).valid, true);
  }
  assert.equal(solveBaseline(input).unloaded[0].reasonCode, 'DOOR_LIMIT');
  const withoutDoor = { ...input, container: { ...input.container, doorWidthMm: undefined, doorHeightMm: undefined } };
  assert.deepEqual(solveBaseline(withoutDoor).loadedByProduct, [1, 2]);
});

test('permitted transport rotation does not forbid a different final packing orientation', () => {
  const input = { mode: 'loose', products: [product('turn-after-entry', 300, 100, 100)],
    container: { l: 100, w: 300, h: 100, kg: 1000, quantity: 1, doorWidthMm: 100, doorHeightMm: 100 } };
  for (const event of searchPlans(input, { maxAttempts: 3 })) {
    if (event.type !== 'candidate') continue;
    assert.deepEqual(event.result.loadedByProduct, [1]);
    assert.equal(event.result.placements[0].orientation.widthMm, 300);
    assert.equal(validateResult(input, event.result).valid, true);
    const operations = diagnoseOperations(input, event.result);
    assert.equal(operations.valid, true);
    assert.ok(operations.warnings.some(warning => warning.includes('柜内转向空间未校验')));
  }
});

test('palletizing respects the low door and loading uses the actual rotated whole-pallet width', () => {
  const input = { mode: 'pallet', products: [product('A', 500, 600, 200, 4)],
    pallet: { l: 500, w: 600, heightMm: 144, maxH: 1000, qty: 4, gap: 50 },
    container: { l: 1300, w: 600, h: 1500, kg: 1000, quantity: 1, doorWidthMm: 500, doorHeightMm: 600 } };
  const result = solveBaseline(input);
  assert.deepEqual(result.loadedByProduct, [4]);
  assert.equal(result.palletPlacements.length, 2);
  assert.ok(result.palletPlacements.every(pallet => pallet.rotated && pallet.widthMm === 500 && pallet.totalHeightMm === 544));
  assert.equal(validateResult(input, result).valid, true);
  assert.equal(diagnoseOperations(input, result).valid, true);
  const withoutDoor = { ...input, container: { ...input.container, doorWidthMm: undefined, doorHeightMm: undefined } };
  assert.equal(solveBaseline(withoutDoor).palletPlacements.length, 1);
  const noFootprintPasses = { ...input, container: { ...input.container, doorWidthMm: 400 } };
  const unloaded = solveBaseline(noFootprintPasses);
  assert.deepEqual(unloaded.loadedByProduct, [0]);
  assert.equal(unloaded.unloaded.reduce((sum, item) => sum + item.remaining, 0), 4);
});
