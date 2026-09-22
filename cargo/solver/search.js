import {
  allowedOrientations, applyTopLoad, boxesOverlap, computeContainerDiagnostics,
  computeLooseGapStats, directSupportItems, makeBox, normalizeInput, solveBaseline,
  supportRatio, toBrowserResult, validateStackSafety,
} from "./core.js";

const EPS = 1e-6;
const volume = box => box.length * box.width * box.height;
const contains = (a, b) => b.x >= a.x - EPS && b.y >= a.y - EPS && b.z >= a.z - EPS &&
  b.x2 <= a.x2 + EPS && b.y2 <= a.y2 + EPS && b.z2 <= a.z2 + EPS;

// The six remaining slabs deliberately overlap. A later carton can therefore
// span adjacent regions that the baseline's non-overlapping cuts split apart.
function subtract(spaces, box) {
  const next = [];
  for (const space of spaces) {
    if (!boxesOverlap(space, box)) { next.push(space); continue; }
    if (box.x > space.x + EPS) next.push(makeBox(space.x, space.y, space.z, box.x - space.x, space.width, space.height));
    if (box.x2 < space.x2 - EPS) next.push(makeBox(box.x2, space.y, space.z, space.x2 - box.x2, space.width, space.height));
    if (box.y > space.y + EPS) next.push(makeBox(space.x, space.y, space.z, space.length, box.y - space.y, space.height));
    if (box.y2 < space.y2 - EPS) next.push(makeBox(space.x, box.y2, space.z, space.length, space.y2 - box.y2, space.height));
    if (box.z > space.z + EPS) next.push(makeBox(space.x, space.y, space.z, space.length, space.width, box.z - space.z));
    if (box.z2 < space.z2 - EPS) next.push(makeBox(space.x, space.y, box.z2, space.length, space.width, space.z2 - box.z2));
  }
  next.sort((a, b) => volume(b) - volume(a));
  const maximal = [];
  for (const space of next) if (!maximal.some(other => contains(other, space))) maximal.push(space);
  return maximal;
}

function lexicographic(a, b) {
  for (let i = 0; i < a.length; i++) if (Math.abs(a[i] - b[i]) > EPS) return a[i] - b[i];
  return 0;
}

function summarize(result, input) {
  const items = result.sceneItems.filter(item => item.kind === "cargo");
  const loaded = input.products.map(() => 0), containers = new Map();
  for (const item of items) {
    loaded[item.productIndex]++;
    const stats = containers.get(item.containerIndex) ?? { length: 0, weight: 0, xMoment: 0, yMoment: 0 };
    const weight = input.products[item.productIndex].kg;
    stats.length = Math.max(stats.length, item.originMm.x + item.dimensionsMm.length);
    stats.weight += weight;
    stats.xMoment += (item.originMm.x + item.dimensionsMm.length / 2) * weight;
    stats.yMoment += (item.originMm.y + item.dimensionsMm.width / 2) * weight;
    containers.set(item.containerIndex, stats);
  }
  const diagnostics = [...containers.values()];
  return {
    count: items.length,
    complete: input.products.filter((product, i) => product.q > 0 && loaded[i] >= product.q).length,
    volume: items.reduce((sum, item) => sum + volume(item.dimensionsMm), 0),
    containers: containers.size,
    gaps: result.metrics.oversizedGapCount ?? 0,
    gap: result.metrics.maxInternalGapMm ?? 0,
    length: diagnostics.reduce((sum, item) => sum + item.length, 0),
    balance: diagnostics.reduce((sum, item) => sum + (item.weight > 0 ?
      Math.abs(item.xMoment - item.weight * input.container.l / 2) / input.container.l +
      Math.abs(item.yMoment - item.weight * input.container.w / 2) / input.container.w : 0), 0),
  };
}

/** Positive means a improves b. Only independently validated candidates belong here. */
export function comparePlans(a, b, input) {
  if (!b) return 1;
  const left = summarize(a, input), right = summarize(b, input);
  const score = value => {
    const first = input.optimizationGoal === "volume" ? [value.volume, value.count] : [value.count, value.complete];
    const rest = [-value.containers];
    if (input.optimizationGoal === "weight-balance") rest.push(-value.balance);
    return [...first, ...rest, -value.gaps, -value.gap, -value.length];
  };
  return lexicographic(score(left), score(right));
}

function strategyFor(attempt, products, input) {
  const variant = attempt % 20;
  const orders = [
    p => -(p.lengthMm * p.widthMm * p.heightMm),
    p => p.lengthMm * p.widthMm * p.heightMm,
    p => -(p.lengthMm * p.widthMm),
    p => -p.quantity,
    p => -p.weightG,
  ];
  const order = orders[Math.floor(variant / 4)];
  const ranked = products.map((product, index) => ({ index, score: order(product) }));
  // Later attempts vary ties with a fixed integer hash, never wall-clock randomness.
  const tie = index => attempt < 20 ? index : Math.imul(index + 1, 2654435761 ^ attempt) >>> 0;
  ranked.sort((a, b) => a.score - b.score || tie(a.index) - tie(b.index));
  const ranks = products.map((_, index) => ranked.findIndex(item => item.index === index));
  const orientationScores = [
    o => [o.lengthMm, o.heightMm, -o.widthMm],
    o => [o.heightMm, -o.widthMm, o.lengthMm],
    o => [-o.lengthMm, o.heightMm, o.widthMm],
    o => [o.widthMm, o.heightMm, o.lengthMm],
  ];
  const orientationScore = orientationScores[attempt % 4];
  const orientations = products.map(product => allowedOrientations(product).sort((a, b) =>
    lexicographic(orientationScore(a), orientationScore(b))));
  return { ranks, orientations, enforceGap: attempt >= 20,
    balance: input.optimizationGoal === "weight-balance" && attempt >= 4,
    name: `maximal-space-${attempt + 1}` };
}

function yzOverlap(a, b) {
  return a.y < b.y2 - EPS && a.y2 > b.y + EPS && a.z < b.z2 - EPS && a.z2 > b.z + EPS;
}

function createsGap(box, placed, maximumGap) {
  let nextGap = Infinity;
  for (const item of placed) {
    if (!yzOverlap(box, item.box)) continue;
    if (item.box.x2 <= box.x + EPS && Math.min(item.nextGap, box.x - item.box.x2) > maximumGap + EPS) return true;
    if (item.box.x >= box.x2 - EPS) nextGap = Math.min(nextGap, item.box.x - box.x2);
  }
  return Number.isFinite(nextGap) && nextGap > maximumGap + EPS;
}

function resultFor(input, plan, placements, containers, rejections) {
  const counts = plan.products.map(() => 0);
  for (const item of placements) counts[item.productIndex]++;
  const unloaded = plan.products.flatMap((product, index) => counts[index] >= product.quantity ? [] : [{
    sku: product.sku, productIndex: index, remaining: product.quantity - counts[index],
    reasonCode: "SEARCH_INCOMPLETE", reason: "当前搜索尚未找到可行摆法，可继续优化或检查具体约束。",
    rejectedCandidates: Object.fromEntries(rejections[index]),
  }]);
  const loadedVolumeMm3 = placements.reduce((sum, item) => sum + item.orientation.lengthMm * item.orientation.widthMm * item.orientation.heightMm, 0);
  const loadedWeightG = placements.reduce((sum, item) => sum + plan.products[item.productIndex].weightG, 0);
  const containerVolumeMm3 = containers.reduce((sum, item) => sum + item.type.innerLengthMm * item.type.innerWidthMm * item.type.innerHeightMm, 0);
  const containerPayloadG = containers.reduce((sum, item) => sum + item.type.maxPayloadG, 0);
  const gap = computeLooseGapStats(placements, plan.looseCargoMaxGapMm);
  const result = toBrowserResult({
    placements, unloaded, warnings: [], solverVersion: "maximal-space/0.6.0",
    metrics: {
      loadedVolumeMm3, loadedWeightG, containerVolumeMm3, containerPayloadG,
      volumeRatio: containerVolumeMm3 ? loadedVolumeMm3 / containerVolumeMm3 : 0,
      weightRatio: containerPayloadG ? loadedWeightG / containerPayloadG : 0,
      containersUsed: new Set(placements.map(item => item.containerIndex)).size,
      ...gap, targetGapMm: 0, looseCargoMaxGapMm: plan.looseCargoMaxGapMm,
      minimumSupportRatio: plan.minimumSupportRatio,
      containerDiagnostics: computeContainerDiagnostics(placements, plan.products, containers),
    },
  }, plan.products, 0, input.products.map(product => product.color));
  return result;
}

function* construct(input, plan, strategy, controls) {
  const remaining = plan.products.map(product => product.quantity);
  const placements = [], containers = [], rejections = plan.products.map(() => new Map());
  for (const type of plan.containerTypes) for (let i = 0; i < type.quantity; i++) containers.push({ containerIndex: containers.length, type });
  const reject = (index, reason) => rejections[index].set(reason, (rejections[index].get(reason) ?? 0) + 1);
  let stopReason = "complete", checks = 0;
  outer: for (const { containerIndex, type } of containers) {
    let spaces = [makeBox(0, 0, 0, type.innerLengthMm, type.innerWidthMm, type.innerHeightMm)];
    const placed = [];
    let usedWeight = 0, activeGroup = 1;
    while (remaining.some(quantity => quantity > 0)) {
      if (controls.stopped()) { stopReason = "deadline-or-cancel"; break outer; }
      let best;
      spaces.sort((a, b) => a.x - b.x || a.z - b.z || a.y - b.y);
      for (const space of spaces) {
        for (let index = 0; index < remaining.length; index++) {
          if (!remaining[index]) continue;
          const product = plan.products[index], group = product.priorityGroup ?? 1;
          if (group < activeGroup) continue;
          if (usedWeight + product.weightG > type.maxPayloadG + EPS) { reject(index, "PAYLOAD_LIMIT"); continue; }
          for (let oi = 0; oi < strategy.orientations[index].length; oi++) {
            if (++checks % 128 === 0 && controls.stopped()) { stopReason = "deadline-or-cancel"; break outer; }
            const orientation = strategy.orientations[index][oi];
            if (orientation.lengthMm > space.length + EPS || orientation.widthMm > space.width + EPS || orientation.heightMm > space.height + EPS) continue;
            if ((Number.isFinite(type.doorWidthMm) && orientation.widthMm > type.doorWidthMm + EPS) ||
                (Number.isFinite(type.doorHeightMm) && orientation.heightMm > type.doorHeightMm + EPS)) { reject(index, "DOOR_LIMIT"); continue; }
            const balance = strategy.balance ? product.weightG / orientation.lengthMm * (
              Math.abs(space.x + orientation.lengthMm / 2 - type.innerLengthMm / 2) / type.innerLengthMm +
              Math.abs(space.y + orientation.widthMm / 2 - type.innerWidthMm / 2) / type.innerWidthMm) : 0;
            const score = [group, space.x, space.z, space.y, balance, strategy.ranks[index], oi];
            if (best && lexicographic(score, best.score) >= 0) continue;
            const box = makeBox(space.x, space.y, space.z, orientation.lengthMm, orientation.widthMm, orientation.heightMm);
            if (strategy.enforceGap && createsGap(box, placed, plan.looseCargoMaxGapMm)) { reject(index, "INTERNAL_GAP_LIMIT"); continue; }
            if (supportRatio(box, placed) + EPS < plan.minimumSupportRatio) { reject(index, "SUPPORT_LIMIT"); continue; }
            const safety = validateStackSafety(box, product, product.weightG, placed, plan.products, group, plan.priorityGroupMode);
            if (!safety.ok) { reject(index, safety.reasonCode); continue; }
            best = { box, index, orientation, score, group, safety };
          }
        }
      }
      if (!best) break;
      const { box, index, orientation, group, safety } = best, product = plan.products[index];
      applyTopLoad(box, product.weightG, placed, plan.products);
      let nextGap = Infinity;
      for (const item of placed) {
        if (!yzOverlap(box, item.box)) continue;
        if (item.box.x2 <= box.x + EPS) item.nextGap = Math.min(item.nextGap, box.x - item.box.x2);
        if (item.box.x >= box.x2 - EPS) nextGap = Math.min(nextGap, item.box.x - box.x2);
      }
      placed.push({ box, productIndex: index, weightG: product.weightG, priorityGroup: group,
        stackLevel: safety.stackLevel, topLoadG: 0, nextGap, supports: directSupportItems(box, placed) });
      placements.push({ productIndex: index, sku: product.sku, orientation, x: box.x, y: box.y, z: box.z, containerIndex, priorityGroup: group });
      remaining[index]--;
      usedWeight += product.weightG;
      activeGroup = Math.max(activeGroup, group);
      spaces = subtract(spaces, box);
      if (spaces.length > controls.maxSpaces) { stopReason = "space-limit"; break outer; }
      if (placements.length % 32 === 0) yield { type: "progress", loaded: placements.length, strategy: strategy.name };
    }
    if (remaining.every(quantity => quantity === 0)) break;
  }
  if (stopReason === "complete" && remaining.some(quantity => quantity > 0)) stopReason = "no-fit";
  return { result: resultFor(input, plan, placements, containers, rejections), stopReason, checks };
}

/**
 * Deterministic prefix of alternatives: longer budgets retain every earlier
 * completed candidate. The caller validates each result before comparison.
 * Yielding every 32 cartons lets the worker process cancellation messages.
 */
export function* searchPlans(input, controls = {}) {
  const now = controls.now ?? (() => performance.now());
  const stopped = () => Boolean(controls.shouldStop?.()) || now() >= (controls.deadline ?? Infinity);
  const settings = { ...controls, stopped, maxSpaces: controls.maxSpaces ?? 5000 };
  const accepted = result => {
    if (!controls.validate) return true;
    const audit = controls.validate(input, result);
    return typeof audit === "boolean" ? audit : audit.valid;
  };
  const baseline = controls.baseline ?? solveBaseline(input, controls);
  if (accepted(baseline)) yield { type: "candidate", result: baseline, strategy: "baseline", attempt: 0 };
  else yield { type: "progress", strategy: "baseline", attempt: 0, rejected: true };
  if (input.mode !== "loose") return;
  const plan = normalizeInput(input);
  for (let attempt = 0; attempt < (controls.maxAttempts ?? 40) && !stopped(); attempt++) {
    const strategy = strategyFor(attempt, plan.products, input);
    const candidate = yield* construct(input, plan, strategy, settings);
    candidate.result.search = { attempt: attempt + 1, strategy: strategy.name, checks: candidate.checks, stopReason: candidate.stopReason };
    if (accepted(candidate.result)) yield { type: "candidate", ...candidate, strategy: strategy.name, attempt: attempt + 1 };
    else yield { type: "progress", strategy: strategy.name, attempt: attempt + 1, rejected: true };
  }
}
