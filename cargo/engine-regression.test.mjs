import assert from 'node:assert/strict';
import test from 'node:test';
import { assessPlan, explainUnloaded, fingerprintLayout, solvePlan } from './solver/engine.js';

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

test('integrated search selects the audited one-container six-carton solution', async () => {
  const config = { ...input, container: { l: 600, w: 400, h: 100, kg: 100, quantity: 2 },
    products: [
      { ...input.products[0], l: 200, w: 200, h: 100, q: 3, stackable: false },
      { ...input.products[0], sku: 'B', l: 100, w: 300, h: 100, q: 3, stackable: false },
    ] };
  const result = await solvePlan(config, { maxAttempts: 6 });
  assert.deepEqual(result.loadedByProduct, [3, 3]);
  assert.equal(result.metrics.containersUsed, 1);
  assert.equal(result.metrics.oversizedGapCount, 0);
  assert.equal(result.audit.valid, true);
  assert.equal(result.search.attempts, 6);
});

test('cancelling integrated search retains a validated candidate', async () => {
  let cancelled = false;
  const result = await solvePlan(input, { shouldStop: () => cancelled, onProgress: progress => { if (progress.best) cancelled = true; } });
  assert.equal(result.audit.valid, true);
  assert.equal(result.search.stopReason, 'cancelled');
  assert.equal(result.search.attempts, 0);
});

test('layout fingerprint detects placement changes even when loaded counts match', async () => {
  const result = await solvePlan(input, { maxAttempts: 0 });
  assert.match(result.layoutFingerprint, /^[a-f0-9]{64}$/);
  assert.equal(await fingerprintLayout(result), result.layoutFingerprint);
  result.sceneItems[0].originMm.x += 1;
  assert.notEqual(await fingerprintLayout(result), result.layoutFingerprint);
});

test('known operating limits reject unsafe candidates without calling the order impossible', async () => {
  const result = await solvePlan({ ...input, container: { ...input.container, maxFloorLoadKgM2: 1 } }, { maxAttempts: 2 });
  assert.equal(result.loadedByProduct[0], 0);
  assert.equal(result.audit.valid, true);
  assert.equal(result.search.strategy, 'empty-after-rejection');
  assert.ok(result.warnings.some(warning => warning.includes('地板载荷超过')));
});

test('accepted plans expose executable per-container steps and optional door diagnostics', async () => {
  const result = await solvePlan(input, { maxAttempts: 0 });
  assert.equal(result.operations.valid, true);
  assert.equal(result.loadingSteps.length, 2);
  assert.deepEqual(result.loadingSteps.map(step => step.sequence), [1, 2]);
  assert.equal(result.operations.doorChecked, false);
});

test('known floor-load limit tries spreading cartons before discarding a stack-heavy baseline', async () => {
  const config = { ...input, products: [{ ...input.products[0], q: 2 }],
    container: { ...input.container, h: 200, maxFloorLoadKgM2: 150 } };
  const result = await solvePlan(config, { maxAttempts: 1 });
  assert.deepEqual(result.loadedByProduct, [2]);
  assert.equal(result.audit.valid, true);
  assert.ok(result.placements.every(box => box.z === 0));
  assert.equal(result.operations.containerDiagnostics[0].peakFloorLoadKgM2, 100);
  assert.equal(result.metrics.containersUsed, 1);
  assert.equal(result.search.rejectedCandidates, 1);
  assert.match(result.search.strategy, /floor-first$/);
});
