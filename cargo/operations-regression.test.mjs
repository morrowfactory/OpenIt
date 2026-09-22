import assert from 'node:assert/strict';
import test from 'node:test';
import { diagnoseOperations } from './solver/operations.js';

const product = (overrides = {}) => ({ sku: 'A', l: 100, w: 100, h: 100, q: 1, kg: 1, rotate: true, side: false, group: 1, ...overrides });
const input = (products, extra = {}) => ({ mode: 'loose', products, container: { l: 1000, w: 500, h: 500, kg: 1000, quantity: 1 }, ...extra });
const box = (productIndex, x, y, z, l = 100, w = 100, h = 100, containerIndex = 0) => ({ productIndex, containerIndex, x, y, z, orientation: { lengthMm: l, widthMm: w, heightMm: h } });
const has = (audit, code) => audit.errors.some(error => error.code === code);

test('unknown door and structural limits are explicitly not checked', () => {
  const audit = diagnoseOperations(input([product()]), { placements: [box(0, 0, 0, 0)] });
  assert.equal(audit.doorChecked, false);
  assert.equal(audit.containerDiagnostics[0].floorLoadStatus, 'not-checked');
  assert.ok(audit.warnings.some(warning => warning.includes('柜门通过性未校验')));
  assert.deepEqual(audit.containerDiagnostics[0].centerOfGravityMm, { x: 50, y: 50, z: 50 });
});

test('door check uses every permitted carton orientation and flags unverified turning space', () => {
  const config = input([product({ l: 200, w: 100, h: 100 })]);
  Object.assign(config.container, { doorWidthMm: 150, doorHeightMm: 150 });
  const audit = diagnoseOperations(config, { placements: [box(0, 0, 0, 0, 100, 200, 100)] });
  assert.equal(has(audit, 'CARGO_DOOR'), false);
  assert.ok(audit.warnings.some(warning => warning.includes('柜内转向空间未校验')));
  config.products[0].w = 200;
  assert.ok(has(diagnoseOperations(config, { placements: [box(0, 0, 0, 0, 200, 200)] }), 'CARGO_DOOR'));
});

test('support dependencies take precedence over naive x sorting', () => {
  const config = input([product({ q: 2 }), product({ l: 200 })]);
  const audit = diagnoseOperations(config, { placements: [box(1, 0, 0, 100, 200), box(0, 100, 0, 0), box(0, 0, 0, 0)] });
  assert.deepEqual(audit.loadingSteps.map(step => step.placementIndices[0]), [2, 1, 0]);
  assert.equal(audit.valid, true);
});

test('a later unloading group blocking an earlier one yields a sequence error', () => {
  const audit = diagnoseOperations(input([product({ group: 2 }), product({ group: 1 })]), { placements: [box(0, 0, 0, 0), box(1, 100, 0, 0)] });
  assert.ok(has(audit, 'LOADING_SEQUENCE'));
  assert.deepEqual(audit.loadingSteps, []);
});

test('pallet transport checks actual total height and emits one whole-pallet step', () => {
  const config = input([product()], { mode: 'pallet', pallet: { l: 100, w: 100, heightMm: 144, emptyWeightKg: 2 }, container: { l: 1000, w: 500, h: 500, kg: 1000, quantity: 1, doorWidthMm: 150, doorHeightMm: 200 } });
  const result = { placements: [box(0, 0, 0, 144)], palletPlacements: [{ id: 'P', containerIndex: 0, x: 0, y: 0, z: 0, lengthMm: 100, widthMm: 100, heightMm: 144, totalHeightMm: 180 }] };
  const audit = diagnoseOperations(config, result);
  assert.ok(has(audit, 'PALLET_DOOR'));
  assert.equal(audit.loadingSteps.length, 1);
  assert.equal(audit.loadingSteps[0].kind, 'pallet');
  assert.equal(audit.loadingSteps[0].heightMm, 244);
  assert.equal(audit.loadingSteps[0].cartonCount, 1);
});

test('floor loads include the whole stack and supplied balance limits are enforced', () => {
  const config = input([product({ q: 2, kg: 10 })]);
  Object.assign(config.container, { maxFloorLoadKgM2: 1500, maxLongitudinalOffsetMm: 200, maxLateralOffsetMm: 100 });
  const audit = diagnoseOperations(config, { placements: [box(0, 0, 0, 0), box(0, 0, 0, 100)] });
  assert.equal(audit.containerDiagnostics[0].peakFloorLoadKgM2, 2000);
  assert.deepEqual(audit.containerDiagnostics[0].centerOfGravityMm, { x: 50, y: 50, z: 100 });
  for (const code of ['FLOOR_LOAD', 'LONGITUDINAL_CENTER', 'LATERAL_CENTER']) assert.ok(has(audit, code), code);
});

test('step numbers restart in each container', () => {
  const config = input([product({ q: 2 })]);
  config.container.quantity = 2;
  const audit = diagnoseOperations(config, { placements: [box(0, 0, 0, 0), box(0, 0, 0, 0, 100, 100, 100, 1)] });
  assert.deepEqual(audit.loadingSteps.map(step => [step.containerIndex, step.sequence]), [[0, 1], [1, 1]]);
});

test('explicit input pallet tare controls center and floor load despite contradictory output', () => {
  const config = input([product()], { mode: 'pallet', pallet: { l: 100, w: 100, emptyWeightKg: 10 }, container: { l: 1000, w: 500, h: 500, kg: 1000, quantity: 1 } });
  const result = { placements: [box(0, 0, 0, 144)], palletPlacements: [{ id: 'P', containerIndex: 0, x: 0, y: 0, z: 0, lengthMm: 100, widthMm: 100, heightMm: 144, emptyWeightG: 0 }] };
  const audit = diagnoseOperations(config, result);
  assert.ok(has(audit, 'PALLET_TARE_MISMATCH'));
  assert.equal(audit.containerDiagnostics[0].peakFloorLoadKgM2, 1100);
  assert.equal(audit.containerDiagnostics[0].centerOfGravityMm.z, (10 * 72 + 194) / 11);
  config.pallet.emptyWeightKg = 0;
  result.palletPlacements[0].emptyWeightG = 10000;
  const zeroTareAudit = diagnoseOperations(config, result);
  assert.ok(has(zeroTareAudit, 'PALLET_TARE_MISMATCH'));
  assert.equal(zeroTareAudit.containerDiagnostics[0].peakFloorLoadKgM2, 100);
});
