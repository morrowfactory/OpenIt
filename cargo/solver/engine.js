import { allowedOrientations, normalizeInput, solveBaseline } from './core.js';
import { validateResult } from './validation.js';
import { comparePlans, searchPlans } from './search.js';
import { diagnoseOperations } from './operations.js';

// Only a single-box proof is a hard "cannot fit" diagnosis. A failed heuristic
// is not evidence that the remaining order is physically impossible.
export function explainUnloaded(input, result) {
  const normalized = normalizeInput(input);
  return (result.unloaded ?? []).map(item => {
    const product = normalized.products[item.productIndex];
    let reasonCode = 'SEARCH_UNRESOLVED';
    let reason = '当前搜索尚未找到满足条件的摆法；这不等于已证明装不下。可尝试更长计算时间、其他目标或调整条件。';
    const orientations = allowedOrientations(product);
    if (!orientations.some(box => box.lengthMm <= input.container.l && box.widthMm <= input.container.w && box.heightMm <= input.container.h)) {
      reasonCode = 'SINGLE_BOX_DIMENSIONS';
      reason = '单箱所有允许朝向均超过柜内尺寸；当前箱型和朝向下无法装入。';
    } else if (product.weightG > input.container.kg * 1000) {
      reasonCode = 'SINGLE_BOX_PAYLOAD';
      reason = '单箱重量超过单柜额定载重。';
    } else if (Number.isFinite(input.container.doorWidthMm) && Number.isFinite(input.container.doorHeightMm) &&
        !orientations.some(box => box.widthMm <= input.container.doorWidthMm && box.heightMm <= input.container.doorHeightMm)) {
      reasonCode = 'SINGLE_BOX_DOOR';
      reason = '单箱所有允许运输朝向均无法通过输入的柜门净宽和净高。';
    } else if (input.mode === 'pallet' && input.pallet?.qty === 0) {
      reasonCode = 'NO_PALLETS';
      reason = '可用托盘数量为 0。';
    }
    return { ...item, reasonCode, reason };
  });
}

export function assessPlan(input, result) {
  const audit = validateResult(input, result);
  const operations = audit.valid ? diagnoseOperations(input, result) : null;
  audit.geometryValid = audit.valid;
  if (operations) {
    audit.valid = operations.valid;
    audit.errors = [...audit.errors, ...operations.errors];
    audit.errorCount += operations.errorCount;
    audit.errorsTruncated ||= operations.errorsTruncated;
  }
  const diagnostics = audit.containerDiagnostics.filter(item => item.loadedCount || item.palletsUsed).map(item => ({
    ...item,
    loadedWeightG: item.usedWeightKg * 1000,
    occupiedLengthMm: item.usedLengthMm,
    continuousDoorFreeMm: item.doorFreeLengthMm,
    longitudinalCenterOffsetMm: item.centerOfGravityMm ? item.centerOfGravityMm.x - input.container.l / 2 : 0,
    lateralCenterOffsetMm: item.centerOfGravityMm ? item.centerOfGravityMm.y - input.container.w / 2 : 0,
    ...(operations?.containerDiagnostics.find(diagnostic => diagnostic.containerIndex === item.containerIndex) ?? {}),
  }));
  const warnings = [...new Set([...(result.warnings ?? []).filter(message => !/^检测到 \d+ 处纵向内部空隙/.test(message)),
    ...audit.warnings, ...(operations?.warnings ?? [])])];
  const steps = operations?.loadingSteps ?? [], sequenceByPlacement = new Map();
  for (const step of steps) for (const index of step.placementIndices) sequenceByPlacement.set(index, step.sequence);
  let cargoIndex = 0;
  const sceneItems = result.sceneItems.map(item => item.kind === 'cargo'
    ? { ...item, loadSequence: sequenceByPlacement.get(cargoIndex++) ?? item.loadSequence }
    : item);
  return {
    ...result, sceneItems, audit, operations, loadingSteps: steps,
    unloaded: explainUnloaded(input, result),
    warnings: warnings.length <= 45 ? warnings : [...warnings.slice(0, 44), `另有 ${warnings.length - 44} 项提醒；完整约束诊断请检查原始审计结果。`],
    metrics: { ...result.metrics, minimumSupportRatio: audit.minimumSupportRatio,
      maxInternalGapMm: audit.maxInternalGapMm, oversizedGapCount: audit.oversizedGapCount,
      containerDiagnostics: diagnostics },
  };
}

export async function fingerprintLayout(result) {
  const geometry = (result.sceneItems ?? []).map(item => [item.kind, item.containerIndex, item.productIndex,
    item.originMm.x, item.originMm.y, item.originMm.z,
    item.dimensionsMm.length, item.dimensionsMm.width, item.dimensionsMm.height]);
  geometry.sort((a, b) => { const left=JSON.stringify(a),right=JSON.stringify(b);return left<right?-1:left>right?1:0; });
  const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify(geometry)));
  return [...new Uint8Array(hash)].map(value => value.toString(16).padStart(2, '0')).join('');
}

export async function solvePlan(input, controls = {}) {
  const now = controls.now ?? (() => performance.now());
  const started = now(), budgetMs = Math.max(1, Math.min(120000, controls.budgetMs ?? 30000));
  const deadline = Math.min(controls.deadline ?? Infinity, started + budgetMs);
  let best, attempts = 0, validCandidates = 0, rejectedCandidates = 0, bestAttempt = 0, strategy = 'baseline';
  const failures = new Set();
  const summary = stopReason => ({ budgetMs, elapsedMs: Math.max(0, now() - started), attempts,
    validCandidates, rejectedCandidates, bestAttempt, strategy, stopReason });
  for (const event of searchPlans(input, { ...controls, now, deadline })) {
    if (event.type === 'candidate') {
      attempts = Math.max(attempts, event.attempt);
      const candidate = assessPlan(input, event.result);
      if (candidate.audit.valid) {
        validCandidates++;
        if (comparePlans(candidate, best, input) > 0) {
          best = candidate; bestAttempt = event.attempt; strategy = event.strategy;
          best.solverVersion = 'cargo-search/0.9.0';
          best.layoutFingerprint = await fingerprintLayout(best);
          best.search = summary('completed');
          controls.onProgress?.({ attempts, validCandidates, rejectedCandidates, best });
        }
      } else {
        rejectedCandidates++;
        candidate.audit.errors.slice(0, 3).forEach(error => failures.add(error.message));
      }
    } else controls.onProgress?.({ ...event, attempts, validCandidates, rejectedCandidates });
    // Yield actual event-loop turns so the worker can receive cancellation.
    await new Promise(resolve => setTimeout(resolve, 0));
    if (controls.shouldStop?.() || now() >= deadline) break;
  }
  if (!best) {
    best = assessPlan(input, solveBaseline(input, { shouldStop: () => true }));
    if (!best.audit.valid) throw new Error('未找到通过独立校验的方案：' + [...failures].slice(0, 3).join('；'));
    best.warnings.unshift('试算方案均未满足全部已知约束，本次仅返回空方案，不代表已证明装不下：' + [...failures].slice(0, 3).join('；'));
    best.solverVersion = 'cargo-search/0.9.0';
    best.layoutFingerprint = await fingerprintLayout(best);
    strategy = 'empty-after-rejection';
  }
  best.search = summary(controls.shouldStop?.() ? 'cancelled' : now() >= deadline ? 'time-limit' : 'completed');
  return best;
}
