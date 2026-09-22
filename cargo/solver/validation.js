// Independent result audit. Deliberately does not import packing predicates.
const EPS = 1e-6;
const MAX_ERRORS = 100;
const finite = value => typeof value === 'number' && Number.isFinite(value);
const close = (a, b) => Math.abs(a - b) <= EPS;
const overlap = (a, a2, b, b2) => Math.min(a2, b2) - Math.max(a, b);

function boxOf(item, index, kind) {
  const origin = item.originMm ?? item;
  const size = item.dimensionsMm ?? item.orientation ?? item;
  const l = size.lengthMm ?? size.length ?? item.l;
  const w = size.widthMm ?? size.width ?? item.w;
  const h = size.heightMm ?? size.height ?? item.h;
  return { ...item, index, kind, id: item.id ?? `${kind}-${index}`,
    productIndex: item.productIndex ?? item.pi, containerIndex: item.containerIndex ?? item.ci,
    x: origin.x, y: origin.y, z: origin.z, l, w, h,
    x2: origin.x + l, y2: origin.y + w, z2: origin.z + h,
    supporters: [], topLoadKg: 0, layersAbove: 0, supportRatio: 0 };
}

function normalized(result) {
  const source = result.placements ?? (result.sceneItems ?? []).filter(item => item.kind === 'cargo');
  const pallets = result.palletPlacements ?? (result.sceneItems ?? []).filter(item => item.kind === 'pallet');
  return { cargo: source.map((item, index) => boxOf(item, index, 'cargo')),
    pallets: pallets.map((item, index) => boxOf(item, index, 'pallet')) };
}

function permittedDimensions(product) {
  const { l, w, h } = product;
  const dimensions = [[l, w, h]];
  if (product.rotate) dimensions.push([w, l, h]);
  if (product.side) {
    dimensions.push([l, h, w], [w, h, l]);
    if (product.rotate) dimensions.push([h, l, w], [h, w, l]);
  }
  return dimensions;
}

function contactRectangle(upper, lower) {
  const x = Math.max(upper.x, lower.x), x2 = Math.min(upper.x2, lower.x2);
  const y = Math.max(upper.y, lower.y), y2 = Math.min(upper.y2, lower.y2);
  return x2 - x > EPS && y2 - y > EPS ? { x, x2, y, y2, area: (x2 - x) * (y2 - y) } : null;
}

// Sweep the rectangle union so overlapping supports cannot inflate coverage.
function unionArea(rectangles) {
  const xs = [...new Set(rectangles.flatMap(rect => [rect.x, rect.x2]))].sort((a, b) => a - b);
  let area = 0;
  for (let i = 1; i < xs.length; i++) {
    const intervals = rectangles.filter(rect => rect.x < xs[i] && rect.x2 > xs[i - 1])
      .map(rect => [rect.y, rect.y2]).sort((a, b) => a[0] - b[0]);
    let end = -Infinity, length = 0;
    for (const [a, b] of intervals) { length += Math.max(0, b - Math.max(a, end)); end = Math.max(end, b); }
    area += (xs[i] - xs[i - 1]) * length;
  }
  return area;
}

function eachOverlappingPair(boxes, visit) {
  const sorted = [...boxes].sort((a, b) => a.x - b.x);
  let active = [];
  for (const box of sorted) {
    active = active.filter(other => other.x2 > box.x + EPS);
    for (const other of active) {
      if (overlap(box.y, box.y2, other.y, other.y2) > EPS && overlap(box.z, box.z2, other.z, other.z2) > EPS) visit(other, box);
    }
    active.push(box);
  }
}

function longitudinalGaps(boxes, limitMm) {
  const sorted = [...boxes].sort((a, b) => a.x - b.x), seen = new Set();
  let maxInternalGapMm = 0;
  for (const box of sorted) {
    // First later x with intersecting Y/Z projection is this carton’s neighbour.
    // No later neighbour means door-side free space, not an internal gap.
    for (const later of sorted) {
      if (later.x < box.x2 - EPS || overlap(box.y, box.y2, later.y, later.y2) <= EPS || overlap(box.z, box.z2, later.z, later.z2) <= EPS) continue;
      const gap = Math.max(0, later.x - box.x2);
      maxInternalGapMm = Math.max(maxInternalGapMm, gap);
      if (gap > limitMm + EPS) {
        const key = `${Math.round(box.x2 / EPS)}:${Math.round(later.x / EPS)}`;
        seen.add(key);
      }
      break;
    }
  }
  return { maxInternalGapMm, oversizedGapCount: seen.size };
}

function checkVirtualWalls(cargo, pallets, products, fail) {
  const spans = new Map();
  const add = (group, box) => {
    const span = spans.get(group) ?? { min: Infinity, max: -Infinity, box };
    span.min = Math.min(span.min, box.x); span.max = Math.max(span.max, box.x2);
    spans.set(group, span);
  };
  for (const box of cargo) add(products[box.productIndex].group ?? 1, box);
  for (const pallet of pallets) {
    const groups = new Set(cargo.filter(box => box.x >= pallet.x - EPS && box.x2 <= pallet.x2 + EPS && box.y >= pallet.y - EPS && box.y2 <= pallet.y2 + EPS && box.z >= pallet.z2 - EPS).map(box => products[box.productIndex].group ?? 1));
    for (const group of groups) add(group, pallet);
  }
  const sorted = [...spans].sort((a, b) => a[0] - b[0]);
  let previousEnd = -Infinity;
  for (const [group, span] of sorted) {
    if (span.min < previousEnd - EPS) fail('PRIORITY_VIRTUAL_WALL', `装卸组 ${group} 与更早装载组的纵向区域重叠或前后顺序颠倒。`, span.box);
    previousEnd = Math.max(previousEnd, span.max);
  }
}

export function validateResult(input, result) {
  const errors = [], warningSet = new Set();
  let errorCount = 0;
  const fail = (code, message, item) => {
    errorCount++;
    if (errors.length < MAX_ERRORS) errors.push({ code, message,
      ...(item ? { containerIndex: item.containerIndex, ...(item.kind === 'cargo' ? { productIndex: item.productIndex, placementIndex: item.index } : { palletId: item.id }) } : {}) });
  };
  const warn = message => warningSet.add(message);
  const { cargo, pallets } = normalized(result);
  if (result.placements && result.sceneItems) {
    const sceneCargo = result.sceneItems.filter(item => item.kind === 'cargo').map((item, index) => boxOf(item, index, 'cargo'));
    if (sceneCargo.length !== cargo.length) fail('SCENE_COUNT_MISMATCH', '场景箱数与实际放置箱数不一致。');
    for (let index = 0; index < Math.min(cargo.length, sceneCargo.length); index++) {
      const raw = cargo[index], scene = sceneCargo[index];
      if (raw.productIndex !== scene.productIndex || raw.containerIndex !== scene.containerIndex || !['x', 'y', 'z', 'l', 'w', 'h'].every(key => close(raw[key], scene[key]))) fail('SCENE_PLACEMENT_MISMATCH', '场景中的产品、货柜、位置或尺寸与实际放置结果不一致。', raw);
    }
  }
  const products = input.products ?? [], container = input.container ?? {};
  const quantity = container.quantity ?? 1;
  const loadedByProduct = products.map(() => 0);
  const validBoxes = [];
  if (![container.l, container.w, container.h, container.kg].every(value => finite(value) && value > 0) || !Number.isInteger(quantity) || quantity < 1) {
    fail('INVALID_CONTAINER', '柜体尺寸、载重或数量无效，无法校验。');
  }
  for (const box of [...cargo, ...pallets]) {
    const product = products[box.productIndex];
    if (box.kind === 'cargo') {
      if (!product || !Number.isInteger(box.productIndex)) { fail('UNKNOWN_PRODUCT', '放置结果引用了不存在的产品。', box); continue; }
      loadedByProduct[box.productIndex]++;
      box.weightKg = product.kg;
      if (!finite(box.weightKg) || box.weightKg < 0) { fail('INVALID_WEIGHT', '产品重量无效，无法核对载荷。', box); continue; }
    } else {
      const inputTareKg = input.pallet?.emptyWeightKg;
      box.weightKg = finite(inputTareKg) ? inputTareKg : (finite(box.emptyWeightG) ? box.emptyWeightG / 1000 : 0);
      if (finite(inputTareKg) && finite(box.emptyWeightG) && !close(inputTareKg, box.emptyWeightG / 1000)) fail('PALLET_TARE_MISMATCH', '结果中的托盘自重与输入自重不一致，载荷按输入自重复算。', box);
      if (!finite(box.weightKg) || box.weightKg < 0) { fail('INVALID_WEIGHT', '托盘自重无效，无法核对载荷。', box); continue; }
      if (!finite(input.pallet?.emptyWeightKg)) warn('未提供托盘自重；载重、重心与地板载荷仅计入已知重量，托盘自重未校验。');
    }
    if (![box.x, box.y, box.z, box.l, box.w, box.h].every(finite) || Math.min(box.l, box.w, box.h) <= 0) {
      fail('INVALID_GEOMETRY', '放置坐标或尺寸无效。', box); continue;
    }
    if (!Number.isInteger(box.containerIndex) || box.containerIndex < 0 || box.containerIndex >= quantity) {
      fail('UNKNOWN_CONTAINER', '放置结果超出指定货柜数量。', box); continue;
    }
    if (Math.min(box.x, box.y, box.z) < -EPS || box.x2 > container.l + EPS || box.y2 > container.w + EPS || box.z2 > container.h + EPS) {
      fail('OUT_OF_BOUNDS', '货物或托盘超出柜内边界。', box);
    }
    if (box.kind === 'cargo') {
      if (!permittedDimensions(product).some(([l, w, h]) => close(box.l, l) && close(box.w, w) && close(box.h, h))) fail('ORIENTATION', '箱体尺寸或朝向不符合产品允许的旋转、侧装条件。', box);
      const orientationCode = typeof box.orientation === 'string' ? box.orientation : box.orientation?.code;
      if (box.orientation?.upsideDown || orientationCode?.endsWith('_INVERTED')) fail('ORIENTATION', '当前产品配置不允许倒置。', box);
      if (!finite(product.maxTopKg)) warn(`产品 ${product.sku ?? box.productIndex + 1} 未提供顶部承重，顶部承重未校验。`);
    } else {
      if (!close(box.z, 0)) fail('PALLET_NOT_ON_FLOOR', '托盘必须落地，当前不允许叠托。', box);
      const p = input.pallet;
      if (p && ![[p.l, p.w], [p.w, p.l]].some(([l, w]) => close(l, box.l) && close(w, box.w))) fail('PALLET_DIMENSIONS', '托盘尺寸与输入不符。', box);
      if (p && !close(box.h, p.heightMm ?? 144)) fail('PALLET_HEIGHT', '托盘底板厚度与输入不符。', box);
    }
    validBoxes.push(box);
  }
  products.forEach((product, index) => {
    if (loadedByProduct[index] > product.q) fail('QUANTITY_EXCEEDED', `产品 ${product.sku ?? index + 1} 装载数量超过订单数量。`);
    if (result.loadedByProduct && result.loadedByProduct[index] !== loadedByProduct[index]) fail('LOADED_COUNT_MISMATCH', `产品 ${product.sku ?? index + 1} 汇总数量与实际放置数量不一致。`);
  });
  if (result.unloaded) {
    const remaining = products.map(() => 0);
    for (const entry of result.unloaded) {
      if (!Number.isInteger(entry.productIndex) || !products[entry.productIndex] || !Number.isInteger(entry.remaining) || entry.remaining < 0) fail('INVALID_UNLOADED', '未装货物明细包含无效产品或数量。');
      else remaining[entry.productIndex] += entry.remaining;
    }
    products.forEach((product, index) => {
      if (remaining[index] + loadedByProduct[index] !== product.q) fail('ORDER_COUNT_MISMATCH', `产品 ${product.sku ?? index + 1} 已装与未装数量之和不等于订单数量。`);
    });
  }
  if (input.mode === 'pallet' && cargo.length && !pallets.length) fail('PALLET_MISSING', '托盘装载结果缺少托盘位置，无法确认支撑与数量。');
  if (finite(input.pallet?.qty) && pallets.length > input.pallet.qty) fail('PALLET_QUANTITY', '使用托盘数超过输入的可用托盘数量。');
  if (finite(result.palletsUsed) && result.palletsUsed !== pallets.length) fail('PALLET_COUNT_MISMATCH', '使用托盘汇总数与实际托盘位置不一致。');
  if (pallets.length && !finite(input.pallet?.maxLoadKg)) warn('采用默认托盘承重 1000 kg，未核实实际额定值。');

  let minimumSupportRatio = cargo.length ? 1 : null;
  let maxInternalGapMm = 0, oversizedGapCount = 0;
  const containerDiagnostics = [];
  for (let containerIndex = 0; containerIndex < quantity; containerIndex++) {
    const boxes = validBoxes.filter(box => box.containerIndex === containerIndex);
    const cargoBoxes = boxes.filter(box => box.kind === 'cargo');
    const palletBoxes = boxes.filter(box => box.kind === 'pallet');
    eachOverlappingPair(boxes, (a, b) => fail('COLLISION', `${a.kind === 'pallet' ? '托盘' : '箱子'}与其他箱体发生碰撞。`, b));
    const gapLimitMm = input.looseCargoMaxGapMm ?? 50;
    const gapStats = input.mode === 'pallet' ? { maxInternalGapMm: 0, oversizedGapCount: 0 } : longitudinalGaps(cargoBoxes, gapLimitMm);
    if (gapStats.oversizedGapCount) warn(`柜 ${containerIndex + 1} 有 ${gapStats.oversizedGapCount} 处纵向截面空隙（可能含顶部台阶）超过 ${gapLimitMm} mm，最大 ${Math.round(gapStats.maxInternalGapMm)} mm；不代表均为可再放单箱的封闭空洞，需评估填充与固定，措施尚未校验。`);
    maxInternalGapMm = Math.max(maxInternalGapMm, gapStats.maxInternalGapMm);
    oversizedGapCount += gapStats.oversizedGapCount;
    const groupMode = input.priorityGroupMode ?? 'virtual-wall';
    if (groupMode === 'virtual-wall') checkVirtualWalls(cargoBoxes, palletBoxes, products, fail);
    for (let i = 0; i < palletBoxes.length; i++) for (let j = 0; j < i; j++) {
      const a = palletBoxes[i], b = palletBoxes[j];
      const dx = Math.max(0, a.x - b.x2, b.x - a.x2), dy = Math.max(0, a.y - b.y2, b.y - a.y2);
      if (Math.hypot(dx, dy) + EPS < (input.pallet?.gap ?? 50)) fail('PALLET_GAP', '相邻托盘的最小净间距不足。', a);
    }
    const surfaces = new Map();
    for (const box of boxes) {
      const key = Math.round(box.z2 / EPS);
      if (!surfaces.has(key)) surfaces.set(key, []);
      surfaces.get(key).push(box);
    }
    for (const box of cargoBoxes) {
      if (close(box.z, 0)) box.supportRatio = 1;
      else {
        const key = Math.round(box.z / EPS), rectangles = [];
        for (const zKey of [key - 1, key, key + 1]) for (const lower of surfaces.get(zKey) ?? []) {
          if (lower === box || !close(lower.z2, box.z)) continue;
          const contact = contactRectangle(box, lower);
          if (contact) {
            rectangles.push(contact); box.supporters.push({ box: lower, area: contact.area });
            if (groupMode === 'no-cross-stacking' && lower.kind === 'cargo' && (products[box.productIndex].group ?? 1) !== (products[lower.productIndex].group ?? 1)) fail('PRIORITY_CROSS_STACKING', '当前策略禁止不同装卸组上下接触堆叠。', box);
          }
        }
        box.supportRatio = Math.min(1, unionArea(rectangles) / (box.l * box.w));
      }
      minimumSupportRatio = Math.min(minimumSupportRatio, box.supportRatio);
      if (box.supportRatio < 1 - EPS) fail('INSUFFICIENT_SUPPORT', `实际底面支撑仅 ${(box.supportRatio * 100).toFixed(1)}%，未满足完整支撑。`, box);
      if (input.mode === 'pallet' && close(box.z, 0)) fail('CARGO_OFF_PALLET', '托盘模式中货物直接落在柜底，未装在托盘上。', box);
    }
    // Carry the complete load and longest stack path downward through each contact.
    for (const box of [...cargoBoxes].sort((a, b) => b.z - a.z)) {
      const product = products[box.productIndex];
      if (product.stackable === false && box.layersAbove > 0) fail('NOT_STACKABLE', '不可堆叠产品上方仍有货物。', box);
      if (finite(product.maxLayers) && box.layersAbove + 1 > product.maxLayers) fail('STACK_LAYERS', `以该箱为底的堆叠达 ${box.layersAbove + 1} 层，超过允许层数。`, box);
      if (finite(product.maxTopKg) && box.topLoadKg > product.maxTopKg + EPS) fail('TOP_LOAD', `该箱累计顶载 ${box.topLoadKg.toFixed(2)} kg 超过 ${product.maxTopKg} kg。`, box);
      const contactArea = box.supporters.reduce((sum, link) => sum + link.area, 0);
      for (const link of box.supporters) {
        link.box.topLoadKg += (box.weightKg + box.topLoadKg) * link.area / contactArea;
        link.box.layersAbove = Math.max(link.box.layersAbove, box.layersAbove + 1);
      }
    }
    for (const pallet of palletBoxes) {
      const maxLoadKg = input.pallet?.maxLoadKg ?? 1000;
      if (pallet.topLoadKg > maxLoadKg + EPS) fail('PALLET_LOAD', `托盘货物重量 ${pallet.topLoadKg.toFixed(2)} kg 超过 ${maxLoadKg} kg。`, pallet);
      const members = cargoBoxes.filter(box => box.x >= pallet.x - EPS && box.x2 <= pallet.x2 + EPS && box.y >= pallet.y - EPS && box.y2 <= pallet.y2 + EPS && box.z >= pallet.z2 - EPS);
      pallet.actualTotalHeightMm = Math.max(pallet.h, ...members.map(box => box.z2 - pallet.z));
      if (finite(input.pallet?.maxH) && pallet.actualTotalHeightMm > input.pallet.maxH + EPS) fail('PALLET_TOTAL_HEIGHT', '实测含托高度超过输入上限。', pallet);
      if (finite(pallet.totalHeightMm) && !close(pallet.totalHeightMm, pallet.actualTotalHeightMm)) fail('PALLET_HEIGHT_MISMATCH', '托盘汇总高度与实际箱体顶高不一致。', pallet);
    }
    const usedWeightKg = boxes.reduce((sum, box) => sum + box.weightKg, 0);
    if (usedWeightKg > container.kg + EPS) fail('CONTAINER_PAYLOAD', '柜内总重量超过货柜额定载重。', { containerIndex });
    const centerOfGravityMm = usedWeightKg ? Object.fromEntries(['x', 'y', 'z'].map((axis, index) => [axis, boxes.reduce((sum, box) => sum + (box[axis] + [box.l, box.w, box.h][index] / 2) * box.weightKg, 0) / usedWeightKg])) : null;
    const usedLengthMm = boxes.length ? Math.max(...boxes.map(box => box.x2)) : 0;
    containerDiagnostics.push({ containerIndex, loadedCount: cargoBoxes.length, palletsUsed: palletBoxes.length, usedWeightKg,
      usedLengthMm, doorFreeLengthMm: Math.max(0, container.l - usedLengthMm), centerOfGravityMm,
      ...gapStats,
      minimumSupportRatio: cargoBoxes.length ? Math.min(...cargoBoxes.map(box => box.supportRatio)) : null });
  }
  return { valid: errorCount === 0, errors, errorCount, errorsTruncated: errorCount > errors.length, warnings: [...warningSet],
    minimumSupportRatio, maxInternalGapMm, oversizedGapCount, securingRequired: oversizedGapCount > 0,
    securingStatus: oversizedGapCount > 0 ? 'not-verified' : 'no-oversized-internal-gap', loadedByProduct, containerDiagnostics,
    loadDistributionModel: '箱体重量与累计顶载按接触面积分配并沿支撑链下传；未模拟包装刚度、动态冲击或应力。' };
}
