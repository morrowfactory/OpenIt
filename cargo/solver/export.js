// Plain text cells are prefixed when spreadsheet software could treat them as
// formulas. Numeric coordinates remain numbers and all text is CSV-escaped.
const cell = value => {
  const text = String(value ?? '');
  const safe = typeof value === 'string' && /^[=+@\-\t\r]/.test(text) ? "'" + text : text;
  return '"' + safe.replaceAll('"', '""') + '"';
};

export function sceneAtLoadingStep(result, containerIndex, count) {
  const steps = result.loadingSteps.filter(step => step.containerIndex === containerIndex).slice(0, Math.max(0, count));
  const indices = new Set(steps.flatMap(step => step.placementIndices));
  const pallets = new Set(steps.filter(step => step.kind === 'pallet').map(step => step.palletId));
  let index = 0;
  return result.sceneItems.filter(item => {
    // Placement indices are global, including cartons in other containers.
    if (item.kind === 'cargo') {
      const placementIndex = index++;
      return item.containerIndex !== containerIndex || indices.has(placementIndex);
    }
    return item.containerIndex !== containerIndex || pallets.has(item.id);
  });
}

export function loadingStepsCsv(input, result) {
  if (!result.audit?.valid || !result.operations?.valid) throw new Error('没有通过校验的装载步骤可导出。');
  const rows = [['货柜', '装载步骤', '类型', '产品/托盘', '箱数', '装卸组', 'X(mm)', 'Y(mm)', 'Z(mm)', '长(mm)', '宽(mm)', '高(mm)']];
  for (const step of result.loadingSteps) rows.push([step.containerIndex + 1, step.sequence,
    step.kind === 'pallet' ? '整托' : '单箱', step.kind === 'pallet' ? step.palletId : input.products[step.productIndex].sku,
    step.cartonCount, step.priorityGroup, step.x, step.y, step.z, step.lengthMm, step.widthMm, step.heightMm]);
  rows.push([], ['未装明细', '数量', '原因']);
  for (const item of result.unloaded) rows.push([input.products[item.productIndex].sku, item.remaining, item.reason]);
  rows.push([], ['求解器', result.solverVersion], ['布局指纹', result.layoutFingerprint],
    ['说明', '卸货按每柜步骤逆序；本清单不是运输安全认证。']);
  for (const warning of new Set([...result.warnings, ...result.audit.warnings, ...result.operations.warnings])) rows.push(['警告', warning]);
  return '\ufeff' + rows.map(row => row.map(cell).join(',')).join('\r\n');
}
