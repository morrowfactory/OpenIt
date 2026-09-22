import { allowedOrientations, normalizeInput } from './core.js';
import { validateResult } from './validation.js';
import { comparePlans, searchPlans } from './search.js';

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
    } else if (input.mode === 'pallet' && input.pallet?.qty === 0) {
      reasonCode = 'NO_PALLETS';
      reason = '可用托盘数量为 0。';
    }
    return { ...item, reasonCode, reason };
  });
}

export function assessPlan(input, result) {
  const audit = validateResult(input, result);
  const diagnostics = audit.containerDiagnostics.filter(item => item.loadedCount || item.palletsUsed).map(item => ({
    ...item,
    loadedWeightG: item.usedWeightKg * 1000,
    occupiedLengthMm: item.usedLengthMm,
    continuousDoorFreeMm: item.doorFreeLengthMm,
    longitudinalCenterOffsetMm: item.centerOfGravityMm ? item.centerOfGravityMm.x - input.container.l / 2 : 0,
    lateralCenterOffsetMm: item.centerOfGravityMm ? item.centerOfGravityMm.y - input.container.w / 2 : 0,
  }));
  return {
    ...result, audit,
    unloaded: explainUnloaded(input, result),
    warnings: [...new Set([...(result.warnings ?? []).filter(message => !/^检测到 \d+ 处纵向内部空隙/.test(message)), ...audit.warnings])],
    metrics: { ...result.metrics, minimumSupportRatio: audit.minimumSupportRatio,
      maxInternalGapMm: audit.maxInternalGapMm, oversizedGapCount: audit.oversizedGapCount,
      containerDiagnostics: diagnostics },
  };
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
          best.solverVersion = 'cargo-search/0.7.0';
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
  if (!best) throw new Error('未找到通过独立校验的方案：' + [...failures].slice(0, 3).join('；'));
  best.search = summary(controls.shouldStop?.() ? 'cancelled' : now() >= deadline ? 'time-limit' : 'completed');
  return best;
}
