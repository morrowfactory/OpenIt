import assert from 'node:assert/strict';
import test from 'node:test';
import { assessPlan, explainUnloaded, solvePlan } from './solver/engine.js';

const input = { mode: 'loose', container: { l: 200, w: 100, h: 100, kg: 100, quantity: 1 },
  products: [{ sku: 'A', l: 100, w: 100, h: 100, kg: 1, q: 3, rotate: true, side: false, stackable: true, group: 1 }],
  looseCargoMaxGapMm: 50 };

test('independent audit measures support and never calls a heuristic miss impossible', async () => {
  const result = await solvePlan(input);
  assert.equal(result.audit.valid, true);
  assert.equal(result.metrics.minimumSupportRatio, 1);
  assert.equal(result.unloaded[0].reasonCode, 'SEARCH_UNRESOLVED');
  assert.match(result.unloaded[0].reason, /不等于已证明装不下/);
  assert.ok(result.warnings.some(warning => warning.includes('顶部承重未校验')));
});

test('single-box dimension and payload proofs are distinguished from search limits', () => {
  const oversized = { ...input, products: [{ ...input.products[0], l: 300 }] };
  const overweight = { ...input, products: [{ ...input.products[0], kg: 101 }] };
  const result = { unloaded: [{ productIndex: 0, remaining: 3 }] };
  assert.equal(explainUnloaded(oversized, result)[0].reasonCode, 'SINGLE_BOX_DIMENSIONS');
  assert.equal(explainUnloaded(overweight, result)[0].reasonCode, 'SINGLE_BOX_PAYLOAD');
});

test('actual result audit rejects a corrupted placement', async () => {
  const result = await solvePlan(input);
  result.placements[0].x = -10;
  assert.equal(assessPlan(input, result).audit.valid, false);
});
