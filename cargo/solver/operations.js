// Operational diagnostics are separate from geometric/result validation.
const EPS = 1e-6;
const finite = value => typeof value === 'number' && Number.isFinite(value);
const intersects = (a, b, axis, end) => Math.min(a[end], b[end]) - Math.max(a[axis], b[axis]) > EPS;
const containsXY = (outer, inner) => inner.x >= outer.x - EPS && inner.x2 <= outer.x2 + EPS && inner.y >= outer.y - EPS && inner.y2 <= outer.y2 + EPS;

function normalize(item, index, kind, input) {
  const p = item.originMm ?? item, d = item.dimensionsMm ?? item.orientation ?? item;
  const l = d.lengthMm ?? d.length ?? item.l, w = d.widthMm ?? d.width ?? item.w, h = d.heightMm ?? d.height ?? item.h;
  const productIndex = item.productIndex ?? item.pi;
  return { ...item, index, id: item.id ?? `${kind}-${index}`, kind, productIndex,
    containerIndex: item.containerIndex ?? item.ci, x: p.x, y: p.y, z: p.z, l, w, h,
    x2: p.x + l, y2: p.y + w, z2: p.z + h,
    weightKg: kind === 'cargo' ? input.products[productIndex]?.kg ?? 0 : (finite(input.pallet?.emptyWeightKg) ? input.pallet.emptyWeightKg : finite(item.emptyWeightG) ? item.emptyWeightG / 1000 : 0),
    priorityGroup: input.products[productIndex]?.group ?? 1 };
}

function allowedSizes(product) {
  const { l, w, h } = product, sizes = [[l, w, h]];
  if (product.rotate) sizes.push([w, l, h]);
  if (product.side) { sizes.push([l, h, w], [w, h, l]); if (product.rotate) sizes.push([h, l, w], [h, w, l]); }
  return sizes;
}

function contactArea(a, b) {
  return Math.max(0, Math.min(a.x2, b.x2) - Math.max(a.x, b.x)) * Math.max(0, Math.min(a.y2, b.y2) - Math.max(a.y, b.y));
}

function transportedUnits(cargo, pallets, input, fail) {
  if (input.mode !== 'pallet') return cargo.map(box => ({ ...box, placementIndices: [box.index], cartonCount: 1 }));
  const units = pallets.map(pallet => ({ ...pallet, placementIndices: [], cartonCount: 0, priorityGroup: 1 }));
  for (const box of cargo) {
    const candidates = units.filter(pallet => containsXY(pallet, box) && box.z >= pallet.z + pallet.h - EPS);
    if (candidates.length !== 1) { fail('PALLET_MEMBERSHIP', '无法确定货物属于哪个整托，装卸步骤无法确认。', box); continue; }
    const unit = candidates[0];
    unit.placementIndices.push(box.index);
    unit.cartonCount++;
    unit.z2 = Math.max(unit.z2, box.z2);
    unit.weightKg += box.weightKg;
  }
  for (const unit of units) {
    unit.h = unit.z2 - unit.z;
    const groups = [...new Set(unit.placementIndices.map(index => cargo.find(box => box.index === index)?.priorityGroup ?? 1))];
    unit.priorityGroup = Math.min(...groups, Infinity);
    if (!finite(unit.priorityGroup)) unit.priorityGroup = 1;
    if (groups.length > 1) fail('PALLET_PRIORITY_GROUPS', '同一托盘混入不同装卸组，无法按组整托卸出。', unit);
  }
  return units;
}

function loadOrder(units, input, fail) {
  const outgoing = units.map(() => new Set()), degrees = units.map(() => 0);
  const edge = (from, to) => { if (!outgoing[from].has(to)) { outgoing[from].add(to); degrees[to]++; } };
  for (let a = 0; a < units.length; a++) for (let b = a + 1; b < units.length; b++) {
    const first = units[a], second = units[b];
    if (Math.abs(first.z2 - second.z) <= EPS && contactArea(first, second) > EPS) edge(a, b);
    if (Math.abs(second.z2 - first.z) <= EPS && contactArea(first, second) > EPS) edge(b, a);
    if (intersects(first, second, 'y', 'y2') && intersects(first, second, 'z', 'z2')) {
      if (first.x2 <= second.x + EPS) edge(a, b);
      if (second.x2 <= first.x + EPS) edge(b, a);
    }
  }
  const pending = new Set(units.map((_, index) => index)), ordered = [];
  while (pending.size) {
    // Every lower-numbered unloading group must be loaded first. A dependency
    // on a later group makes the sequence infeasible rather than silently reordered.
    const activeGroup = Math.min(...[...pending].map(index => units[index].priorityGroup));
    let next = -1;
    for (const index of pending) {
      if (degrees[index] || units[index].priorityGroup !== activeGroup) continue;
      if (next === -1 || units[index].x < units[next].x - EPS || Math.abs(units[index].x - units[next].x) <= EPS && (units[index].z < units[next].z - EPS || Math.abs(units[index].z - units[next].z) <= EPS && units[index].y < units[next].y)) next = index;
    }
    if (next === -1) {
      fail('LOADING_SEQUENCE', '支撑、柜门方向或装卸组顺序相互阻挡，未找到可执行装载顺序。', units[[...pending][0]]);
      return [];
    }
    pending.delete(next);
    ordered.push(units[next]);
    for (const index of outgoing[next]) degrees[index]--;
  }
  return ordered.map((unit, index) => ({ sequence: index + 1, containerIndex: unit.containerIndex, kind: unit.kind,
    id: unit.id, ...(unit.kind === 'cargo' ? { productIndex: unit.productIndex } : { palletId: unit.id }),
    placementIndices: unit.placementIndices, cartonCount: unit.cartonCount, priorityGroup: unit.priorityGroup,
    x: unit.x, y: unit.y, z: unit.z, lengthMm: unit.l, widthMm: unit.w, heightMm: unit.h,
    instruction: unit.kind === 'pallet' ? `整托装入（${unit.cartonCount} 箱）` : '按此位置装入单箱' }));
}

function floorLoads(boxes) {
  const totalLoads = new Map(boxes.map(box => [box, box.weightKg]));
  for (const box of [...boxes].sort((a, b) => b.z - a.z)) {
    if (Math.abs(box.z) <= EPS) continue;
    const supports = boxes.filter(lower => lower !== box && Math.abs(lower.z2 - box.z) <= EPS)
      .map(lower => ({ lower, area: contactArea(box, lower) })).filter(link => link.area > EPS);
    const totalArea = supports.reduce((sum, link) => sum + link.area, 0);
    for (const { lower, area } of supports) totalLoads.set(lower, totalLoads.get(lower) + totalLoads.get(box) * area / totalArea);
  }
  return boxes.filter(box => Math.abs(box.z) <= EPS).map(box => ({ id: box.id, kind: box.kind,
    loadKg: totalLoads.get(box), footprintM2: box.l * box.w / 1e6,
    loadKgM2: totalLoads.get(box) / (box.l * box.w / 1e6) }));
}

export function diagnoseOperations(input, result) {
  const errors = [], warnings = new Set(), container = input.container;
  let errorCount = 0;
  const fail = (code, message, item) => {
    errorCount++;
    if (errors.length < 100) errors.push({ code, message, ...(item ? { containerIndex: item.containerIndex,
      ...(item.kind === 'cargo' ? { productIndex: item.productIndex, placementIndex: item.index } : {}) } : {}) });
  };
  const cargo = (result.placements ?? (result.sceneItems ?? []).filter(item => item.kind === 'cargo')).map((item, index) => normalize(item, index, 'cargo', input));
  const pallets = (result.palletPlacements ?? (result.sceneItems ?? []).filter(item => item.kind === 'pallet')).map((item, index) => normalize(item, index, 'pallet', input));
  if (finite(input.pallet?.emptyWeightKg)) for (const pallet of pallets) {
    if (finite(pallet.emptyWeightG) && Math.abs(input.pallet.emptyWeightKg - pallet.emptyWeightG / 1000) > EPS) fail('PALLET_TARE_MISMATCH', '结果中的托盘自重与输入自重不一致，载荷按输入自重复算。', pallet);
  }
  const doorChecked = finite(container.doorWidthMm) && container.doorWidthMm > 0 && finite(container.doorHeightMm) && container.doorHeightMm > 0;
  if (!doorChecked) warnings.add('未提供实际柜门净宽和净高，柜门通过性未校验。');
  const floorChecked = finite(container.maxFloorLoadKgM2) && container.maxFloorLoadKgM2 > 0;
  if (!floorChecked) warnings.add('未提供地板承载限制，地板载荷未校验。');
  else warnings.add('地板载荷按底层货物或托盘外轮廓面积估算；托盘脚、轮子等实际接触点的局部载荷未校验。');
  const longitudinalChecked = finite(container.maxLongitudinalOffsetMm) && container.maxLongitudinalOffsetMm >= 0;
  const lateralChecked = finite(container.maxLateralOffsetMm) && container.maxLateralOffsetMm >= 0;
  if (!longitudinalChecked || !lateralChecked) warnings.add('未提供完整的纵向、横向重心偏移限制，未提供方向的重心安全范围未校验。');
  if (pallets.length && !finite(input.pallet?.emptyWeightKg)) warnings.add('托盘自重未提供；重心与地板载荷仅计入已知重量。');
  warnings.add('装卸顺序按轴向平移和支撑依赖检查；人员、叉车、绑扎操作及转向所需空间未校验。');
  const containerDiagnostics = [], loadingSteps = [];
  for (let containerIndex = 0; containerIndex < (container.quantity ?? 1); containerIndex++) {
    const cargoBoxes = cargo.filter(box => box.containerIndex === containerIndex), palletBoxes = pallets.filter(box => box.containerIndex === containerIndex);
    const boxes = [...cargoBoxes, ...palletBoxes], units = transportedUnits(cargoBoxes, palletBoxes, input, fail);
    if (doorChecked) for (const unit of units) {
      if (unit.kind === 'pallet') {
        if (unit.w > container.doorWidthMm + EPS || unit.h > container.doorHeightMm + EPS) fail('PALLET_DOOR', '整托按当前运输朝向无法通过柜门净宽或净高。', unit);
      } else {
        const product = input.products[unit.productIndex];
        const canPass = allowedSizes(product).some(([, w, h]) => w <= container.doorWidthMm + EPS && h <= container.doorHeightMm + EPS);
        if (!canPass) fail('CARGO_DOOR', '单箱所有允许朝向均无法通过柜门。', unit);
        else if (unit.w > container.doorWidthMm + EPS || unit.h > container.doorHeightMm + EPS) warnings.add(`产品 ${product.sku ?? unit.productIndex + 1} 需换向通过柜门，柜内转向空间未校验。`);
      }
    }
    const totalWeightKg = boxes.reduce((sum, box) => sum + box.weightKg, 0);
    const centerOfGravityMm = totalWeightKg ? Object.fromEntries(['x', 'y', 'z'].map((axis, i) => [axis,
      boxes.reduce((sum, box) => sum + (box[axis] + [box.l, box.w, box.h][i] / 2) * box.weightKg, 0) / totalWeightKg])) : null;
    const longitudinalOffsetMm = centerOfGravityMm ? Math.abs(centerOfGravityMm.x - container.l / 2) : null;
    const lateralOffsetMm = centerOfGravityMm ? Math.abs(centerOfGravityMm.y - container.w / 2) : null;
    if (centerOfGravityMm && longitudinalChecked && longitudinalOffsetMm > container.maxLongitudinalOffsetMm + EPS) fail('LONGITUDINAL_CENTER', '纵向重心偏移超过输入限制。', { containerIndex });
    if (centerOfGravityMm && lateralChecked && lateralOffsetMm > container.maxLateralOffsetMm + EPS) fail('LATERAL_CENTER', '横向重心偏移超过输入限制。', { containerIndex });
    const floorContacts = floorLoads(boxes), peakFloorLoadKgM2 = floorContacts.length ? Math.max(...floorContacts.map(contact => contact.loadKgM2)) : 0;
    if (floorChecked && peakFloorLoadKgM2 > container.maxFloorLoadKgM2 + EPS) fail('FLOOR_LOAD', '底层承载区域的估算地板载荷超过输入限制。', { containerIndex });
    const steps = loadOrder(units, input, fail);
    loadingSteps.push(...steps);
    containerDiagnostics.push({ containerIndex, centerOfGravityMm, longitudinalOffsetMm, lateralOffsetMm, peakFloorLoadKgM2,
      floorContacts, doorChecked, floorLoadStatus: floorChecked ? 'footprint-estimate' : 'not-checked',
      longitudinalCenterChecked: longitudinalChecked, lateralCenterChecked: lateralChecked,
      loadingSequenceAvailable: steps.length === units.length });
  }
  return { valid: errorCount === 0, errors, errorCount, errorsTruncated: errorCount > errors.length,
    warnings: [...warnings], containerDiagnostics, loadingSteps, doorChecked,
    sequenceModel: '散箱先装支撑箱；同高度与宽度投影重叠时，深处先装；装卸组号较小者先装。托盘先完成码托，再按整托装入。卸货按每柜步骤逆序。' };
}
