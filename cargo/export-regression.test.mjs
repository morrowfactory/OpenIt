import assert from 'node:assert/strict';
import test from 'node:test';
import { loadingStepsCsv, sceneAtLoadingStep } from './solver/export.js';

test('step preview uses global placement indices and keeps whole pallets together', () => {
  const result = { sceneItems: [
    { id: 'a', kind: 'cargo', containerIndex: 0 },
    { id: 'p', kind: 'pallet', containerIndex: 1 },
    { id: 'b', kind: 'cargo', containerIndex: 1 },
    { id: 'c', kind: 'cargo', containerIndex: 1 },
    { id: 'd', kind: 'cargo', containerIndex: 1 },
  ], loadingSteps: [
    { containerIndex: 0, kind: 'cargo', placementIndices: [0] },
    { containerIndex: 1, kind: 'pallet', palletId: 'p', placementIndices: [1, 2] },
    { containerIndex: 1, kind: 'cargo', placementIndices: [3] },
  ] };
  assert.deepEqual(sceneAtLoadingStep(result, 1, 0).map(item => item.id), ['a']);
  assert.deepEqual(sceneAtLoadingStep(result, 1, 1).map(item => item.id), ['a', 'p', 'b', 'c']);
  assert.deepEqual(sceneAtLoadingStep(result, 1, 2), result.sceneItems);
});

test('export uses real per-container load steps and escapes spreadsheet formulas', () => {
  const input = { products: [{ sku: '=HYPERLINK("bad")' }] };
  const result = { audit: { valid: true, warnings: [] }, operations: { valid: true, warnings: [] }, warnings: [], unloaded: [],
    solverVersion: 'test', layoutFingerprint: 'abc', loadingSteps: [{ containerIndex: 1, sequence: 1, kind: 'cargo', productIndex: 0,
      cartonCount: 1, priorityGroup: 1, x: 0, y: 0, z: 0, lengthMm: 1, widthMm: 2, heightMm: 3 }] };
  const csv = loadingStepsCsv(input, result);
  assert.ok(csv.startsWith('\ufeff'));
  assert.match(csv, /"2","1","单箱","'=HYPERLINK\(""bad""\)"/);
  assert.match(csv, /不是运输安全认证/);
  assert.throws(() => loadingStepsCsv(input, { ...result, audit: { valid: false } }), /没有通过校验/);
});
