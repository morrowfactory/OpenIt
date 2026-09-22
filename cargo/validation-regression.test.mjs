import assert from 'node:assert/strict';
import test from 'node:test';
import { validateResult } from './solver/validation.js';

const product = (overrides = {}) => ({ sku: 'A', l: 100, w: 100, h: 100, q: 1, kg: 1, rotate: true, side: false, stackable: true, ...overrides });
const input = (products, extra = {}) => ({ mode: 'loose', products, container: { l: 1000, w: 500, h: 500, kg: 100, quantity: 1 }, ...extra });
const box = (productIndex, x, y, z, l = 100, w = 100, h = 100) => ({ productIndex, containerIndex: 0, x, y, z, orientation: { code: 'LWH', lengthMm: l, widthMm: w, heightMm: h } });
const has = (result, code) => result.errors.some(error => error.code === code);

test('measures actual support and rejects the 60 percent counterexample', () => {
  const audit = validateResult(input([product({ l: 60 }), product()]), { placements: [box(0, 0, 0, 0, 60), box(1, 0, 0, 100)], metrics: { minimumSupportRatio: 1 } });
  assert.equal(audit.minimumSupportRatio, .6);
  assert.ok(has(audit, 'INSUFFICIENT_SUPPORT'));
  assert.equal(audit.valid, false);
});

test('support union combines adjacent boxes without double counting overlap', () => {
  const config = input([product({ l: 50, q: 2 }), product()]);
  const good = [box(0, 0, 0, 0, 50), box(0, 50, 0, 0, 50), box(1, 0, 0, 100)];
  assert.equal(validateResult(config, { placements: good }).valid, true);
  good[1].x = 25;
  const audit = validateResult(config, { placements: good });
  assert.equal(audit.minimumSupportRatio, .75);
  assert.ok(has(audit, 'COLLISION'));
});

test('mixed SKU stack layers count upward from every lower box and loads traverse supports', () => {
  const config = input([product({ maxLayers: 2, maxTopKg: 1.5 }), product({ q: 2, maxTopKg: 1 })]);
  const audit = validateResult(config, { placements: [box(0, 0, 0, 0), box(1, 0, 0, 100), box(1, 0, 0, 200)] });
  assert.ok(has(audit, 'STACK_LAYERS'));
  assert.ok(has(audit, 'TOP_LOAD'));
  assert.equal(audit.errors.find(error => error.code === 'TOP_LOAD').productIndex, 0);
});

test('independent audit rejects count, orientation, bounds and payload contradictions', () => {
  const config = input([product({ l: 200, rotate: false, stackable: false, kg: 60 })]);
  const audit = validateResult(config, { placements: [box(0, 0, 0, 0, 100, 200), box(0, 950, 0, 0, 100, 200)], loadedByProduct: [1] });
  for (const code of ['QUANTITY_EXCEEDED', 'LOADED_COUNT_MISMATCH', 'ORIENTATION', 'OUT_OF_BOUNDS', 'CONTAINER_PAYLOAD']) assert.ok(has(audit, code), code);
});

test('nonstackable bottom cargo cannot carry a different product', () => {
  const audit = validateResult(input([product({ stackable: false }), product()]), { placements: [box(0, 0, 0, 0), box(1, 0, 0, 100)] });
  assert.ok(has(audit, 'NOT_STACKABLE'));
});

test('pallet top is real support and total height includes the deck exactly once', () => {
  const config = input([product({ h: 150, q: 11 })], { mode: 'pallet', container: { l: 1000, w: 500, h: 2000, kg: 1000, quantity: 1 }, pallet: { l: 100, w: 100, qty: 1, maxH: 1800, heightMm: 144, gap: 200 } });
  const placements = Array.from({ length: 11 }, (_, i) => box(0, 0, 0, 144 + i * 150, 100, 100, 150));
  const palletPlacements = [{ id: 'p1', containerIndex: 0, x: 0, y: 0, z: 0, lengthMm: 100, widthMm: 100, heightMm: 144, totalHeightMm: 1794, emptyWeightG: 1000 }];
  const audit = validateResult(config, { placements, palletPlacements, palletsUsed: 1 });
  assert.equal(audit.valid, true, JSON.stringify(audit.errors));
  assert.equal(audit.minimumSupportRatio, 1);
  assert.equal(audit.containerDiagnostics[0].usedWeightKg, 12);
});

test('finite pallet supply, actual spacing and floor rules are independently enforced', () => {
  const config = input([], { mode: 'pallet', pallet: { l: 100, w: 100, qty: 1, maxH: 400, gap: 200 } });
  const palletPlacements = [0, 150, 500].map((x, i) => ({ id: `p${i}`, containerIndex: 0, x, y: 0, z: i === 2 ? 144 : 0, lengthMm: 100, widthMm: 100, heightMm: 144 }));
  const audit = validateResult(config, { placements: [], palletPlacements });
  for (const code of ['PALLET_QUANTITY', 'PALLET_GAP', 'PALLET_NOT_ON_FLOOR']) assert.ok(has(audit, code));
});

test('scene fallback reads every carton, ignores rendered support claims and warns about unknown top load', () => {
  const sceneItems = [{ kind: 'cargo', productIndex: 0, containerIndex: 0, originMm: { x: 0, y: 0, z: 0 }, dimensionsMm: { length: 100, width: 100, height: 100 } }];
  const audit = validateResult(input([product()]), { sceneItems, loadedByProduct: [1], unloaded: [] });
  assert.equal(audit.valid, true);
  assert.equal(audit.loadedByProduct[0], 1);
  assert.ok(audit.warnings.some(warning => warning.includes('顶部承重未校验')));
});

test('error detail is bounded while the full failure count remains visible', () => {
  const audit = validateResult(input([product({ q: 150 })]), { placements: Array.from({ length: 150 }, (_, i) => box(0, i * 100, 0, 1)) });
  assert.equal(audit.errors.length, 100);
  assert.ok(audit.errorCount > 100);
  assert.equal(audit.errorsTruncated, true);
});

test('same dimensions do not make an explicitly inverted carton orientation permissible', () => {
  const placement = box(0, 0, 0, 0);
  placement.orientation.code = 'LWH_INVERTED';
  assert.ok(has(validateResult(input([product()]), { placements: [placement] }), 'ORIENTATION'));
  placement.orientation.code = 'LWH';
  placement.orientation.upsideDown = true;
  assert.ok(has(validateResult(input([product()]), { placements: [placement] }), 'ORIENTATION'));
});

test('negative pallet tare cannot reduce reported payload', () => {
  const palletPlacements = [{ containerIndex: 0, x: 0, y: 0, z: 0, lengthMm: 100, widthMm: 100, heightMm: 144, emptyWeightG: -5000 }];
  const audit = validateResult(input([], { mode: 'pallet', pallet: { l: 100, w: 100, qty: 1 } }), { placements: [], palletPlacements });
  assert.ok(has(audit, 'INVALID_WEIGHT'));
});

test('generated zero tare does not disguise missing input as a verified value', () => {
  const palletPlacements = [{ containerIndex: 0, x: 0, y: 0, z: 0, lengthMm: 100, widthMm: 100, heightMm: 144, emptyWeightG: 0 }];
  const config = input([], { mode: 'pallet', pallet: { l: 100, w: 100, qty: 1 } });
  assert.ok(validateResult(config, { placements: [], palletPlacements }).warnings.some(warning => warning.includes('托盘自重未校验')));
  config.pallet.emptyWeightKg = 0;
  assert.equal(validateResult(config, { placements: [], palletPlacements }).warnings.some(warning => warning.includes('托盘自重未校验')), false);
});

test('longitudinal gaps use actual nearest overlapping projection and exclude tail free space', () => {
  const config = input([product({ q: 3 })]);
  const result = { placements: [box(0, 0, 0, 0), box(0, 150, 0, 0), box(0, 500, 200, 0)], metrics: { maxInternalGapMm: 999 } };
  const audit = validateResult(config, result);
  assert.equal(audit.valid, true);
  assert.equal(audit.maxInternalGapMm, 50);
  result.placements[1].x = 200;
  result.metrics.maxInternalGapMm = 0;
  const withGap = validateResult(config, result);
  assert.equal(withGap.valid, true);
  assert.ok(withGap.warnings.some(warning => warning.includes('需评估填充与固定')));
  assert.equal(withGap.securingRequired, true);
  assert.equal(withGap.securingStatus, 'not-verified');
  assert.equal(withGap.maxInternalGapMm, 100);
});

test('virtual wall requires strict longitudinal separation even in adjacent width lanes', () => {
  const config = input([product({ group: 1 }), product({ group: 2 })]);
  const result = { placements: [box(0, 0, 0, 0), box(1, 0, 100, 0)] };
  assert.ok(has(validateResult(config, result), 'PRIORITY_VIRTUAL_WALL'));
  result.placements[1].x = 100;
  assert.equal(validateResult(config, result).valid, true);
});

test('cross-group contact is rejected in no-cross-stacking and allowed in allow-stacking', () => {
  const config = input([product({ group: 1 }), product({ group: 2 })], { priorityGroupMode: 'no-cross-stacking' });
  const result = { placements: [box(0, 0, 0, 0), box(1, 0, 0, 100)] };
  assert.ok(has(validateResult(config, result), 'PRIORITY_CROSS_STACKING'));
  config.priorityGroupMode = 'allow-stacking';
  assert.equal(validateResult(config, result).valid, true);
});

test('virtual wall separates whole pallet extents for different unloading groups', () => {
  const config = input([product({ group: 1 }), product({ group: 2 })], { mode: 'pallet', pallet: { l: 200, w: 100, qty: 2, gap: 50, maxH: 400 } });
  const palletPlacements = [0, 150].map((y, i) => ({ id: `p${i}`, containerIndex: 0, x: 0, y, z: 0, lengthMm: 200, widthMm: 100, heightMm: 144, emptyWeightG: 0 }));
  const audit = validateResult(config, { placements: [box(0, 0, 0, 144), box(1, 100, 150, 144)], palletPlacements });
  assert.ok(has(audit, 'PRIORITY_VIRTUAL_WALL'));
});

test('gap warnings summarize each container rather than each open cross-section', () => {
  const config = input([product({ q: 4 })]);
  const audit = validateResult(config, { placements: [0, 200, 450, 750].map(x => box(0, x, 0, 0)) });
  const warnings = audit.warnings.filter(warning => warning.includes('纵向截面空隙'));
  assert.equal(warnings.length, 1);
  assert.match(warnings[0], /3 处/);
  assert.match(warnings[0], /最大 200 mm/);
  assert.match(warnings[0], /可能含顶部台阶/);
  assert.match(warnings[0], /不代表均为可再放单箱的封闭空洞/);
});

test('default pallet capacity is identified as unverified and explicit capacity removes that warning', () => {
  const config = input([], { mode: 'pallet', pallet: { l: 100, w: 100, qty: 1 } });
  const result = { placements: [], palletPlacements: [{ containerIndex: 0, x: 0, y: 0, z: 0, lengthMm: 100, widthMm: 100, heightMm: 144, emptyWeightG: 0 }] };
  assert.ok(validateResult(config, result).warnings.some(warning => warning.includes('默认托盘承重 1000 kg')));
  config.pallet.maxLoadKg = 800;
  assert.equal(validateResult(config, result).warnings.some(warning => warning.includes('默认托盘承重')), false);
});

test('explicit pallet tare overrides inconsistent result tare, including an explicit zero', () => {
  const config = input([product()], { mode: 'pallet', container: { l: 1000, w: 500, h: 500, kg: 5, quantity: 1 }, pallet: { l: 100, w: 100, qty: 1, emptyWeightKg: 10 } });
  const result = { placements: [box(0, 0, 0, 144)], palletPlacements: [{ containerIndex: 0, x: 0, y: 0, z: 0, lengthMm: 100, widthMm: 100, heightMm: 144, emptyWeightG: 0 }] };
  const audit = validateResult(config, result);
  assert.ok(has(audit, 'PALLET_TARE_MISMATCH'));
  assert.ok(has(audit, 'CONTAINER_PAYLOAD'));
  assert.equal(audit.containerDiagnostics[0].usedWeightKg, 11);
  config.pallet.emptyWeightKg = 0;
  result.palletPlacements[0].emptyWeightG = 10000;
  assert.equal(validateResult(config, result).containerDiagnostics[0].usedWeightKg, 1);
  assert.ok(has(validateResult(config, result), 'PALLET_TARE_MISMATCH'));
});

test('rendered scene cannot omit or move cartons relative to raw placements', () => {
  const config = input([product()]);
  const result = { placements: [box(0, 0, 0, 0)], sceneItems: [{ kind: 'cargo', productIndex: 0, containerIndex: 0, originMm: { x: 0, y: 0, z: 0 }, dimensionsMm: { length: 100, width: 100, height: 100 } }] };
  assert.equal(validateResult(config, result).valid, true);
  result.sceneItems[0].originMm.x = 1;
  assert.ok(has(validateResult(config, result), 'SCENE_PLACEMENT_MISMATCH'));
  result.sceneItems = [];
  assert.ok(has(validateResult(config, result), 'SCENE_COUNT_MISMATCH'));
});
