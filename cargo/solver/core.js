// Extracted from the shipped solver; browser rendering remains in the existing bundle.
const stopped = controls => Boolean(controls?.shouldStop?.() || (Number.isFinite(controls?.deadline) && performance.now() >= controls.deadline));
const gl = [{
    code: "LWH",
    axes: ["lengthMm", "widthMm", "heightMm"],
    sideLoaded: !1,
    upsideDown: !1,
    horizontallyRotated: !1
}, {
    code: "WLH",
    axes: ["widthMm", "lengthMm", "heightMm"],
    sideLoaded: !1,
    upsideDown: !1,
    horizontallyRotated: !0
}, {
    code: "LHW",
    axes: ["lengthMm", "heightMm", "widthMm"],
    sideLoaded: !0,
    upsideDown: !1,
    horizontallyRotated: !1
}, {
    code: "HLW",
    axes: ["heightMm", "lengthMm", "widthMm"],
    sideLoaded: !0,
    upsideDown: !1,
    horizontallyRotated: !0
}, {
    code: "WHL",
    axes: ["widthMm", "heightMm", "lengthMm"],
    sideLoaded: !0,
    upsideDown: !1,
    horizontallyRotated: !1
}, {
    code: "HWL",
    axes: ["heightMm", "widthMm", "lengthMm"],
    sideLoaded: !0,
    upsideDown: !1,
    horizontallyRotated: !0
}, {
    code: "LWH_INVERTED",
    axes: ["lengthMm", "widthMm", "heightMm"],
    sideLoaded: !1,
    upsideDown: !0,
    horizontallyRotated: !1
}, {
    code: "WLH_INVERTED",
    axes: ["widthMm", "lengthMm", "heightMm"],
    sideLoaded: !1,
    upsideDown: !0,
    horizontallyRotated: !0
}, {
    code: "LHW_INVERTED",
    axes: ["lengthMm", "heightMm", "widthMm"],
    sideLoaded: !0,
    upsideDown: !0,
    horizontallyRotated: !1
}, {
    code: "HLW_INVERTED",
    axes: ["heightMm", "lengthMm", "widthMm"],
    sideLoaded: !0,
    upsideDown: !0,
    horizontallyRotated: !0
}, {
    code: "WHL_INVERTED",
    axes: ["widthMm", "heightMm", "lengthMm"],
    sideLoaded: !0,
    upsideDown: !0,
    horizontallyRotated: !1
}, {
    code: "HWL_INVERTED",
    axes: ["heightMm", "widthMm", "lengthMm"],
    sideLoaded: !0,
    upsideDown: !0,
    horizontallyRotated: !0
}];

function xl(i, t) {
    return !(i.mustStayUpright && (t.sideLoaded || t.upsideDown) || t.sideLoaded && !i.allowSideLoading || t.upsideDown && !i.allowUpsideDown || t.horizontallyRotated && !i.allowHorizontalRotation || i.allowedOrientations !== void 0 && !i.allowedOrientations.includes(t.code))
}

function Po(i) {
    const t = [],
        e = new Set;
    for (const n of gl) {
        if (!xl(i, n)) continue;
        const [s, r, a] = n.axes, o = {
            code: n.code,
            lengthMm: i[s],
            widthMm: i[r],
            heightMm: i[a],
            sideLoaded: n.sideLoaded,
            upsideDown: n.upsideDown
        }, c = `${o.lengthMm}:${o.widthMm}:${o.heightMm}:${o.upsideDown}`;
        e.has(c) || (e.add(c), t.push(o))
    }
    return t
}
function fitsDoor(widthMm, heightMm, container) {
    return (!Number.isFinite(container.doorWidthMm) || widthMm <= container.doorWidthMm + 1e-6) &&
        (!Number.isFinite(container.doorHeightMm) || heightMm <= container.doorHeightMm + 1e-6);
}

// Transport through the door may use another permitted orientation. Turning
// inside the container is reported separately by the operations audit.
function canPassDoor(product, container) {
    return Po(product).some(orientation => fitsDoor(orientation.widthMm, orientation.heightMm, container));
}
const Vt = 1e-6;

function Nn(i, t, e, n, s, r) {
    return {
        x: i,
        y: t,
        z: e,
        x2: i + n,
        y2: t + s,
        z2: e + r,
        length: n,
        width: s,
        height: r
    }
}

function vl(i, t) {
    return i.x < t.x2 - Vt && i.x2 > t.x + Vt && i.y < t.y2 - Vt && i.y2 > t.y + Vt && i.z < t.z2 - Vt && i.z2 > t.z + Vt
}

function Ml(i, t) {
    return i.x >= t.x - Vt && i.x2 <= t.x2 + Vt && i.y >= t.y - Vt && i.y2 <= t.y2 + Vt && i.z >= t.z - Vt && i.z2 <= t.z2 + Vt
}

function Sl(i, t) {
    const e = [];
    if (t.x2 < i.x2 - Vt && e.push(Nn(t.x2, i.y, i.z, i.x2 - t.x2, i.width, i.height)), t.y2 < i.y2 - Vt) {
        const n = i.x,
            s = Math.min(i.x2, t.x2);
        s - n > Vt && e.push(Nn(n, t.y2, i.z, s - n, i.y2 - t.y2, i.height))
    } else t.y2 >= i.y2 - Vt && t.x2 < i.x2 - Vt;
    if (t.z2 < i.z2 - Vt) {
        const n = i.x,
            s = Math.min(i.x2, t.x2),
            r = i.y,
            a = Math.min(i.y2, t.y2);
        s - n > Vt && a - r > Vt && e.push(Nn(n, r, t.z2, s - n, a - r, i.z2 - t.z2))
    }
    return e.filter(n => n.length > Vt && n.width > Vt && n.height > Vt)
}

function orientationCapacityScore(i, t) {
    return Math.floor(i.length / t.lengthMm + Vt) * Math.floor(i.width / t.widthMm + Vt) * Math.floor(i.height / t.heightMm + Vt)
}
function El(i) {
    return {
        enforceSupport: i?.enforceSupport ?? !0,
        enforceTopLoad: i?.enforceTopLoad ?? !0,
        maxPlacementsPerContainer: i?.maxPlacementsPerContainer ?? 5e4
    }
}
class yl {
    options;
    constructor(t) {
        this.options = El(t)
    }
    solve(t, controls = {}) {
        if (t.products.length === 0) throw new Error("PlanInput 至少需要一个产品。");
        if (t.containerTypes.length === 0) throw new Error("PlanInput 至少需要一种柜型。");
        const e = t.products.map((_, u) => ({
                productIndex: u,
                sku: _.sku,
                weightG: _.weightG,
                quantity: _.quantity,
                priorityGroup: Number.isInteger(_.priorityGroup) ? Math.max(1, _.priorityGroup) : 1
            })),
            n = new Map;
        t.products.forEach((_, u) => n.set(u, Po(_)));
        const s = [];
        let r = 0;
        for (const _ of t.containerTypes)
            for (let u = 0; u < _.quantity; u += 1) s.push({
                containerIndex: r,
                type: _
            }), r += 1;
        const a = s.reduce((_, u) => _ + u.type.innerLengthMm * u.type.innerWidthMm * u.type.innerHeightMm, 0),
            o = s.reduce((_, u) => _ + u.type.maxPayloadG, 0),
            c = [],
            l = e.map(_ => ({
                ..._
            }));
        const looseCargoMaxGapMm = Math.max(0, t.looseCargoMaxGapMm ?? 50);
        for (const {
                containerIndex: _,
                type: u
            }
            of s) {
            if (stopped(controls) || l.every(E => E.quantity <= 0)) break;
            const doorEligible = t.products.map(product => canPassDoor(product, u));
            const h = {
                spaces: [Nn(0, 0, 0, u.innerLengthMm, u.innerWidthMm, u.innerHeightMm)],
                placed: [],
                usedWeightG: 0,
                activePriorityGroup: 0
            };
            let w = 0,
                T = !0;
            for (; T && w < this.options.maxPlacementsPerContainer && !stopped(controls);) {
                T = !1;
                let E = null,
                    P = Number.NEGATIVE_INFINITY;
                for (let R = 0; R < h.spaces.length; R += 1) {
                    const b = h.spaces[R];
                    let I = !1;
                    for (let M = 0; M < l.length; M += 1) {
                        const S = l[M];
                        if (S.quantity <= 0 || !doorEligible[S.productIndex]) continue;
                        const A = n.get(S.productIndex) ?? [];
                        for (const G of A)
                            if (G.lengthMm <= b.length + Vt && G.widthMm <= b.width + Vt && G.heightMm <= b.height + Vt) {
                                I = !0;
                                break
                            } if (I) break
                    }
                    if (I)
                        for (let M = 0; M < l.length; M += 1) {
                            const S = l[M];
                            if (S.quantity <= 0 || !doorEligible[S.productIndex]) continue;
                            const A = t.products[S.productIndex],
                                G = n.get(S.productIndex) ?? [];
                            for (const O of G) {
                                const priorityGroup = S.priorityGroup ?? 1;
                                if (priorityGroup < h.activePriorityGroup) continue;
                                if (O.lengthMm > b.length + Vt || O.widthMm > b.width + Vt) continue;
                                const N = O.heightMm,
                                    q = Math.floor(b.height / N + Vt);
                                if (q < 1) continue;
                                // Place one carton at a time. Fill the deepest longitudinal
                                // section from bottom to top before advancing toward the door,
                                // leaving one continuous empty area for later products.
                                let V = 1;
                                if (this.options.enforceSupport) {
                                    const tt = Nn(b.x, b.y, b.z, O.lengthMm, O.widthMm, O.heightMm);
                                    if (!Tl(tt, h.placed, t.minimumSupportRatio)) continue
                                }
                                const tt = Nn(b.x, b.y, b.z, O.lengthMm, O.widthMm, O.heightMm),
                                    groupMode = t.priorityGroupMode ?? "virtual-wall",
                                    stackSafety = validateStackSafety(tt, A, S.weightG, h.placed, t.products, priorityGroup, groupMode);
                                if (!stackSafety.ok) continue;
                                if (h.usedWeightG + S.weightG > u.maxPayloadG) continue;
                                if (this.options.enforceTopLoad && A.maxTopLoadG !== void 0) {
                                    const tt = A.maxTopLoadG / S.weightG + 1;
                                    V = Math.min(V, Math.max(1, Math.floor(tt)))
                                }
                                if (V < 1) continue;
                                const K = V * N,
                                    z = Nn(b.x, b.y, b.z, O.lengthMm, O.widthMm, K);
                                if (z.x2 > b.x2 + Vt || z.y2 > b.y2 + Vt || z.z2 > b.z2 + Vt) continue;
                                const st = z.length * z.width * z.height,
                                    isBoundedSectionSpace = b.length < u.innerLengthMm - b.x - Vt,
                                    longitudinalRemainder = Math.max(0, b.length - O.lengthMm),
                                    fragmentsCurrentSection = isBoundedSectionSpace && longitudinalRemainder > looseCargoMaxGapMm + Vt;
                                let isEarlierLoadPosition = E === null || priorityGroup < E.priorityGroup;
                                priorityGroup === E?.priorityGroup && (isEarlierLoadPosition =
                                    E.fragmentsCurrentSection && !fragmentsCurrentSection ||
                                    E.fragmentsCurrentSection === fragmentsCurrentSection && (
                                    z.x < E.box.x - Vt ||
                                    Math.abs(z.x - E.box.x) <= Vt && z.z < E.box.z - Vt ||
                                    Math.abs(z.x - E.box.x) <= Vt && Math.abs(z.z - E.box.z) <= Vt && z.y < E.box.y - Vt ||
                                    Math.abs(z.x - E.box.x) <= Vt && Math.abs(z.z - E.box.z) <= Vt && Math.abs(z.y - E.box.y) <= Vt && (st > P || Math.abs(st - P) <= Vt && orientationCapacityScore(b, O) > orientationCapacityScore(b, E.orientation))));
                                isEarlierLoadPosition && (P = st, E = {
                                    box: z,
                                    orientation: O,
                                    height: N,
                                    count: V,
                                    productIndex: S.productIndex,
                                    priorityGroup,
                                    stackLevel: stackSafety.stackLevel,
                                    fragmentsCurrentSection
                                })
                            }
                        }
                }
                if (E !== null) {
                    const R = l[E.productIndex],
                        b = Math.min(E.count, R.quantity);
                    for (let M = 0; M < b; M += 1) {
                        const S = E.box.z + M * E.height,
                            A = Nn(E.box.x, E.box.y, S, E.orientation.lengthMm, E.orientation.widthMm, E.height);
                        applyTopLoad(A, R.weightG, h.placed, t.products);
                        c.push({
                            productIndex: R.productIndex,
                            sku: R.sku,
                            orientation: E.orientation,
                            x: A.x,
                            y: A.y,
                            z: A.z,
                            containerIndex: _,
                            priorityGroup: E.priorityGroup
                        }), h.placed.push({
                            box: A,
                            productIndex: R.productIndex,
                            weightG: R.weightG,
                            priorityGroup: E.priorityGroup,
                            stackLevel: E.stackLevel + M,
                            topLoadG: 0,
                            supports: directSupportItems(A, h.placed)
                        }), h.usedWeightG += R.weightG, h.activePriorityGroup = Math.max(h.activePriorityGroup, E.priorityGroup)
                    }
                    R.quantity -= b, w += b, T = !0;
                    const I = [];
                    for (const M of h.spaces) {
                        if (!vl(M, E.box)) {
                            I.push(M);
                            continue
                        }
                        const S = Sl(M, E.box);
                        for (const A of S) h.placed.some(G => G.box !== E.box && Ml(A, G.box)) || I.push(A)
                    }
                    h.spaces = I
                } else T = !1
            }
        }
        const d = l.filter(_ => _.quantity > 0).map(_ => {
                const u = t.products[_.productIndex],
                    h = n.get(_.productIndex) ?? [],
                    w = h.some(T => s.some(E => T.lengthMm <= E.type.innerLengthMm + Vt && T.widthMm <= E.type.innerWidthMm + Vt && T.heightMm <= E.type.innerHeightMm + Vt));
                let T = "CAPACITY_OR_CONSTRAINT_LIMIT",
                    E = "柜内剩余空间或当前安全约束无法继续放置";
                if (!h.length) { T = "NO_ALLOWED_ORIENTATION"; E = "没有符合旋转、侧装或直立要求的允许朝向"; }
                else if (!w) { T = "DIMENSION_LIMIT"; E = "所有允许朝向都超过所选柜型内部尺寸"; }
                else if (s.every(P => !canPassDoor(u, P.type))) { T = "DOOR_LIMIT"; E = "所有允许运输朝向都无法通过已填写的柜门尺寸"; }
                else if (s.every(P => u.weightG > P.type.maxPayloadG)) { T = "WEIGHT_LIMIT"; E = "单箱重量超过所选柜型载重"; }
                else if (u.stackable === !1 || Number.isFinite(u.maxStackLayers) || Number.isFinite(u.maxTopLoadG)) { T = "STACK_OR_SUPPORT_LIMIT"; E = "堆叠层数、顶部承重或支撑条件限制"; }
                return {
                    sku: _.sku,
                    productIndex: _.productIndex,
                    remaining: _.quantity,
                    priorityGroup: _.priorityGroup,
                    reasonCode: T,
                    reason: E
                }
            }),
            f = c.reduce((_, u) => _ + u.orientation.lengthMm * u.orientation.widthMm * u.orientation.heightMm, 0),
            p = c.reduce((_, u) => _ + (t.products[u.productIndex]?.weightG ?? 0), 0),
            m = new Set(c.map(_ => _.containerIndex)),
            gapStats = computeLooseGapStats(c, looseCargoMaxGapMm),
            containerDiagnostics = computeContainerDiagnostics(c, t.products, s),
            x = [];
        d.length > 0 && x.push("存在未能装入的货物，请增加容器数量或放宽约束。");
        d.slice(0, 10).forEach(_ => x.push(`SKU ${_.sku} 未装 ${_.remaining} 箱：${_.reason}。`));
        gapStats.oversizedGapCount > 0 && x.push(`检测到 ${gapStats.oversizedGapCount} 处纵向内部空隙超过 ${looseCargoMaxGapMm} mm（最大 ${Math.round(gapStats.maxInternalGapMm)} mm），请调整箱型组合或使用衬垫、充气袋、挡木固定。`);
        return {
            placements: c,
            unloaded: d,
            metrics: {
                loadedVolumeMm3: f,
                containerVolumeMm3: a,
                volumeRatio: a > 0 ? f / a : 0,
                loadedWeightG: p,
                containerPayloadG: o,
                weightRatio: o > 0 ? p / o : 0,
                containersUsed: m.size,
                maxInternalGapMm: gapStats.maxInternalGapMm,
                oversizedGapCount: gapStats.oversizedGapCount,
                looseCargoMaxGapMm,
                targetGapMm: 0,
                minimumSupportRatio: t.minimumSupportRatio,
                containerDiagnostics
            },
            warnings: x,
            solverVersion: "safety-baseline/0.6.0"
        }
    }
}

function computeLooseGapStats(i, t) {
    let e = 0;
    const n = new Set,
        s = new Map;
    for (const r of i) {
        const a = s.get(r.containerIndex) ?? [];
        a.push(r);
        s.set(r.containerIndex, a)
    }
    for (const r of s.values()) r.sort((a, o) => a.x - o.x);
    for (const r of i) {
        const a = r.x + r.orientation.lengthMm,
            o = s.get(r.containerIndex) ?? [];
        let c = Number.POSITIVE_INFINITY;
        for (const d of o) {
            if (d === r || d.x < a - Vt) continue;
            if (Number.isFinite(c) && d.x - a > c + Vt) break;
            const l = Math.min(r.y + r.orientation.widthMm, d.y + d.orientation.widthMm) - Math.max(r.y, d.y),
                h = Math.min(r.z + r.orientation.heightMm, d.z + d.orientation.heightMm) - Math.max(r.z, d.z);
            if (l <= Vt || h <= Vt) continue;
            c = Math.min(c, d.x - a)
        }
        if (Number.isFinite(c) && c > t + Vt) {
            n.add(`${r.containerIndex}:${Math.round(a)}:${Math.round(a+c)}`);
            e = Math.max(e, c)
        }
    }
    return { maxInternalGapMm: e, oversizedGapCount: n.size }
}

function computeContainerDiagnostics(i, t, e) {
    const n = [];
    for (const s of e) {
        const r = i.filter(l => l.containerIndex === s.containerIndex);
        if (r.length === 0) continue;
        const a = r.reduce((l, h) => l + (t[h.productIndex]?.weightG ?? 0), 0),
            o = a > 0 ? r.reduce((l, h) => l + (h.x + h.orientation.lengthMm / 2) * (t[h.productIndex]?.weightG ?? 0), 0) / a : 0,
            c = a > 0 ? r.reduce((l, h) => l + (h.y + h.orientation.widthMm / 2) * (t[h.productIndex]?.weightG ?? 0), 0) / a : 0,
            d = Math.max(0, ...r.map(l => l.x + l.orientation.lengthMm));
        n.push({
            containerIndex: s.containerIndex,
            loadedWeightG: a,
            longitudinalCenterOffsetMm: o - s.type.innerLengthMm / 2,
            lateralCenterOffsetMm: c - s.type.innerWidthMm / 2,
            continuousDoorFreeMm: Math.max(0, s.type.innerLengthMm - d),
            occupiedLengthMm: d
        })
    }
    return n
}

function supportRatio(box, placed) {
    if (box.z <= Vt) return 1;
    const area = box.length * box.width;
    return area > 0 ? Math.min(1, directSupportItems(box, placed).reduce((sum, item) => sum + overlapAreaXY(box, item.box), 0) / area) : 0;
}

function Tl(i, t, e = 1) {
    return supportRatio(i, t) >= e - Vt;
}

function overlapAreaXY(i, t) {
    const e = Math.max(0, Math.min(i.x2, t.x2) - Math.max(i.x, t.x)),
        n = Math.max(0, Math.min(i.y2, t.y2) - Math.max(i.y, t.y));
    return e * n
}

function directSupportItems(i, t) {
    return t.filter(e => Math.abs(e.box.z2 - i.z) <= Vt && overlapAreaXY(i, e.box) > Vt)
}

function supportChain(box, weightG, placed) {
    const loads = new Map(), depths = new Map();
    const links = new Map(), pending = directSupportItems(box, placed);
    const roots = [...pending];
    for (let index = 0; index < pending.length; index++) {
        const base = pending[index];
        if (links.has(base)) continue;
        const beneath = base.supports ?? (base.box.z > Vt ? directSupportItems(base.box, placed) : []);
        links.set(base, beneath);
        pending.push(...beneath);
    }
    const distribute = (current, load, depth, bases) => {
        const area = bases.reduce((sum, item) => sum + overlapAreaXY(current, item.box), 0);
        if (area <= Vt) return;
        for (const base of bases) {
            const share = load * overlapAreaXY(current, base.box) / area;
            loads.set(base, (loads.get(base) ?? 0) + share);
            depths.set(base, Math.max(depths.get(base) ?? 0, depth + 1));
        }
    };
    distribute(box, weightG, 1, roots);
    for (const base of [...links.keys()].sort((a, b) => b.box.z - a.box.z)) {
        distribute(base.box, loads.get(base) ?? 0, depths.get(base) ?? 1, links.get(base));
    }
    return { loads, depths };
}

function validateStackSafety(box, product, weightG, placed, products, group = 1, groupMode = "virtual-wall") {
    const supports = directSupportItems(box, placed);
    const stackLevel = box.z > Vt ? 1 + supports.reduce((max, base) => Math.max(max, base.stackLevel ?? 1), 0) : 1;
    const reject = reasonCode => ({ ok: false, stackLevel, reasonCode });
    if (supports.some(base => products[base.productIndex]?.stackable === false)) return reject("NOT_STACKABLE");
    if (groupMode === "no-cross-stacking" && supports.some(base => (base.priorityGroup ?? 1) !== group)) return reject("PRIORITY_GROUP_STACKING");
    if (groupMode === "virtual-wall" && group > 1 && placed.some(base => (base.priorityGroup ?? 1) < group && box.x < base.box.x2 - Vt)) return reject("PRIORITY_GROUP_BOUNDARY");
    const chain = supportChain(box, weightG, placed);
    for (const [base, depth] of chain.depths) {
        const limit = products[base.productIndex]?.maxStackLayers;
        if (Number.isFinite(limit) && depth > limit) return reject("MAX_STACK_LAYERS");
    }
    for (const [base, load] of chain.loads) {
        const limit = products[base.productIndex]?.maxTopLoadG;
        if (Number.isFinite(limit) && (base.topLoadG ?? 0) + load > limit + Vt) return reject("MAX_TOP_LOAD");
    }
    return { ok: true, stackLevel };
}

function applyTopLoad(box, weightG, placed) {
    for (const [base, load] of supportChain(box, weightG, placed).loads) base.topLoadG = (base.topLoadG ?? 0) + load;
}

function bl(i, t, controls) {
    return new yl(t).solve(i, controls)
}
const se = 1e-6;

function Al(i, t, e, n, s, r) {
    return {
        x: i,
        y: t,
        z: e,
        length: n,
        width: s,
        height: r,
        x2: i + n,
        y2: t + s,
        z2: e + r
    }
}

function wl(i) {
    const t = i?.stabilityLevel ?? "balanced";
    let e;
    return t === "strict" ? e = .8 : t === "relaxed" ? e = .4 : e = .6, {
        mode: i?.mode ?? "mixed-max",
        allowLooseCargo: i?.allowLooseCargo ?? !0,
        layerInterlock: i?.layerInterlock ?? !0,
        maxItemsPerPallet: i?.maxItemsPerPallet ?? 2e3,
        stabilityLevel: t,
        minSupportRatio: i?.minSupportRatio ?? e
    }
}
class Rl {
    options;
    constructor(t) {
        this.options = wl(t)
    }
    solve(t, controls = {}) {
        const e = [],
            n = new Map;
        t.products.forEach((_, u) => n.set(u, Po(t.products[u])));
        const s = new Map,
            r = [];
        t.products.forEach((_, u) => {
            if (_.quantity <= 0 || _.palletPolicy === "forbidden") return;
            const h = _.eligiblePalletTypeIds ?? t.palletTypes.map(T => T.id),
                w = t.palletTypes.findIndex(T => h.includes(T.id));
            w >= 0 ? (s.set(u, w), r.push(u)) : _.palletPolicy === "required" && e.push(`SKU ${_.sku} 必须打托但没有可用托盘，跳过。`)
        }), r.sort((_, u) => {
            const h = t.products[_],
                w = t.products[u];
            if (h.priorityGroup !== w.priorityGroup) return (h.priorityGroup ?? 1) - (w.priorityGroup ?? 1);
            if (h.palletPolicy === "required" && w.palletPolicy !== "required") return -1;
            if (w.palletPolicy === "required" && h.palletPolicy !== "required") return 1;
            const T = h.lengthMm * h.widthMm * h.heightMm;
            return w.lengthMm * w.widthMm * w.heightMm - T || _ - u
        });
        const a = t.products.map((_, u) => ({
                productIndex: u,
                sku: _.sku,
                weightG: _.weightG,
                quantity: _.quantity
            })),
            o = [],
            unpackableSeeds = new Set(),
            availablePallets = t.palletTypes.map(type => type.supplyMode === "limited" ? Math.max(0, type.quantity ?? 0) : Infinity);
        let c = 0;
        const l = 1e5 + t.products.reduce((_, u) => _ + u.quantity, 0);
        for (; c < l && !stopped(controls);) {
            c += 1;
            let _ = -1,
                u = -1;
            for (const T of r)
                if (a[T].quantity > 0 && availablePallets[s.get(T)] > 0 && !unpackableSeeds.has(T)) {
                    _ = s.get(T), u = T;
                    break
                } if (_ < 0) break;
            const h = t.palletTypes[_],
                w = this.buildPalletUnit(t, a, _, h, n, e, this.options.mode === "single-sku" ? u : void 0, controls, t.products[u].priorityGroup ?? 1);
            if (w.items.length === 0) {
                unpackableSeeds.add(u);
                continue
            }
            o.push(w);
            availablePallets[_] -= 1;
            for (const T of w.items) {
                const E = a[T.productIndex];
                E && (E.quantity -= 1)
            }
        }
        const d = a.filter(_ => _.quantity > 0).map(_ => ({
                sku: _.sku,
                productIndex: _.productIndex,
                remaining: _.quantity,
                reasonCode: "PALLET_PACKING_LIMIT",
                reason: "托盘数量、组托尺寸或安全约束限制，当前方案未能完成组托"
            })),
            f = o.reduce((_, u) => _ + u.items.reduce((h, w) => h + w.orientation.lengthMm * w.orientation.widthMm * w.orientation.heightMm, 0), 0),
            p = o.reduce((_, u) => _ + u.palletLengthMm * u.palletWidthMm * Math.max(0, u.totalHeightMm - u.palletHeightMm), 0),
            m = o.reduce((_, u) => _ + u.totalWeightG, 0),
            x = new Map;
        for (const _ of o) x.set(_.palletTypeId, (x.get(_.palletTypeId) ?? 0) + 1);
        return {
            pallets: o,
            unloaded: d,
            metrics: {
                palletsUsed: o.length,
                totalVolumeMm3: f,
                volumeRatio: p > 0 ? f / p : 0,
                totalWeightG: m,
                weightRatio: 0,
                palletsByType: [...x.entries()].map(([_, u]) => ({
                    palletTypeId: _,
                    used: u
                }))
            },
            warnings: e,
            solverVersion: "pallet-layer/0.2.0"
        }
    }
    buildPalletUnit(t, e, n, s, r, a, o, controls = {}, priorityGroup = 1) {
        const c = s.heightMm,
            l = Math.min(s.maxLoadedHeightMm, Math.max(...t.containerTypes.filter(type => type.quantity > 0).map(type =>
                Number.isFinite(type.doorHeightMm) ? type.doorHeightMm : Infinity))),
            d = s.maxLoadG,
            f = s.lengthMm,
            p = s.widthMm,
            m = f,
            x = p,
            _ = [],
            u = [],
            supportedItems = [],
            h = new Map;
        let T = 0,
            E = 0,
            P = 0,
            R = 0;
        const b = new Map,
            I = e.filter(O => O.quantity > 0).length,
            M = this.options.layerInterlock && I === 1;
        for (; E < this.options.maxItemsPerPallet && !stopped(controls);) {
            const O = [];
            for (let $ = 0; $ < e.length; $ += 1) {
                if (o !== void 0 && $ !== o) continue;
                // A pallet is loaded/unloaded as one unit, even when SKU mixing
                // is enabled. Different unloading groups need separate pallets.
                if ((t.products[$].priorityGroup ?? 1) !== priorityGroup) continue;
                const Z = e[$];
                if (Z.quantity <= 0) continue;
                const ut = r.get(Z.productIndex) ?? [];
                let dt = null,
                    wt = -1 / 0;
                for (const jt of ut)
                    if (jt.lengthMm <= m + se && jt.widthMm <= x + se) {
                        if (R + jt.heightMm > l - c + se || T + Z.weightG > d + se) continue;
                        const Dt = this.scoreOrientation(jt, m, x);
                        Dt > wt && (wt = Dt, dt = jt)
                    } dt && O.push({
                    pendingIndex: $,
                    orientation: dt,
                    weightG: Z.weightG,
                    score: wt
                })
            }
            if (O.length === 0) break;
            O.sort(($, Z) => {
                const priority = (t.products[$.pendingIndex].priorityGroup ?? 1) - (t.products[Z.pendingIndex].priorityGroup ?? 1);
                if (priority) return priority;
                const ut = $.orientation.lengthMm * $.orientation.widthMm * $.orientation.heightMm;
                return Z.orientation.lengthMm * Z.orientation.widthMm * Z.orientation.heightMm - ut
            });
            let N = null;
            for (const $ of O) {
                const Z = e[$.pendingIndex].quantity - (b.get($.pendingIndex) ?? 0),
                    ut = this.dynamicGap($.orientation),
                    dt = Math.floor((m + se) / $.orientation.lengthMm) * Math.floor((x + ut + se) / ($.orientation.widthMm + ut));
                if (Z > 0 && (this.options.allowLooseCargo || Z >= dt)) {
                    N = $;
                    break
                }
            }
            if (!N) break;
            const q = this.dynamicGap(N.orientation),
                V = N.orientation.lengthMm * N.orientation.widthMm * N.orientation.heightMm,
                K = [];
            if (this.options.mode === "mixed-max" && this.options.allowLooseCargo)
                for (const $ of O) {
                    if ($ === N || $.orientation.lengthMm * $.orientation.widthMm * $.orientation.heightMm > V || Math.abs($.orientation.heightMm - N.orientation.heightMm) > 20) continue;
                    e[$.pendingIndex].quantity - (b.get($.pendingIndex) ?? 0) > 0 && K.push($)
                }
            K.sort(($, Z) => {
                const ut = e[$.pendingIndex].quantity - (b.get($.pendingIndex) ?? 0);
                return e[Z.pendingIndex].quantity - (b.get(Z.pendingIndex) ?? 0) - ut
            });
            const z = [N, ...K],
                st = N.orientation.heightMm,
                tt = N.orientation.widthMm;
            if (R + st > l - c + se) break;
            const ft = [],
                Ut = [...z];
            M && P % 2 === 1 && Ut.reverse();
            let $t = 0,
                Yt = 0,
                X = !0;
            for (; X && $t + se < x && !stopped(controls);) {
                X = !1;
                let $ = 0,
                    Z = !1;
                for (; !Z && !stopped(controls);) {
                    let ut = !1;
                    for (const dt of Ut) {
                        const wt = b.get(dt.pendingIndex) ?? 0,
                            jt = e[dt.pendingIndex].quantity;
                        if (wt >= jt) continue;
                        const Dt = Al($, $t, R, dt.orientation.lengthMm, dt.orientation.widthMm, dt.orientation.heightMm);
                        if ($ + Dt.length > m + se || $t + Dt.width > x + se || u.some(qt => Cl(qt, Dt))) continue;
                        if (T + dt.weightG > d + se) break;
                        if (R > 0 && this.calculateSupportRatio(Dt, u) < this.options.minSupportRatio - se) continue;
                        const product = t.products[dt.pendingIndex];
                        const stack = validateStackSafety(Dt, product, dt.weightG, supportedItems, t.products, product.priorityGroup, t.priorityGroupMode);
                        if (!stack.ok) continue;
                        if (!(dt === N)) {
                            const qt = ft.filter(Gt => Gt.cand === N).length;
                            if (ft.filter(Gt => Gt.cand !== N).length >= qt * .25) continue
                        }
                        applyTopLoad(Dt, dt.weightG, supportedItems);
                        supportedItems.push({box: Dt, productIndex: dt.pendingIndex, weightG: dt.weightG, priorityGroup: product.priorityGroup, stackLevel: stack.stackLevel, topLoadG: 0, supports: directSupportItems(Dt, supportedItems)});
                        ft.push({
                            cand: dt,
                            box: Dt
                        }), b.set(dt.pendingIndex, wt + 1), u.push(Dt), T += dt.weightG, $ += Dt.length + 0, Yt += 1, ut = !0, X = !0, $ + se >= m && (Z = !0);
                        break
                    }
                    if (!ut || Z) {
                        ut || (Z = !0);
                        break
                    }
                }
                $t += tt + q
            }
            if (Yt === 0) break;
            for (const $ of ft) {
                const ut = e[$.cand.pendingIndex].sku;
                _.push({
                    productIndex: $.cand.pendingIndex,
                    sku: ut,
                    x: $.box.x,
                    y: $.box.y,
                    z: $.box.z,
                    orientation: $.cand.orientation,
                    layerIndex: P
                }), h.set($.cand.pendingIndex, (h.get($.cand.pendingIndex) ?? 0) + 1), E += 1
            }
            R += st, P += 1
        }
        const S = [];
        for (let O = 0; O < P; O++) {
            const N = _.filter(tt => tt.layerIndex === O);
            if (N.length === 0) continue;
            const q = N.reduce((tt, ft) => tt + ft.orientation.lengthMm * ft.orientation.widthMm * ft.orientation.heightMm, 0),
                V = Math.max(...N.map(tt => tt.z + tt.orientation.heightMm)) - Math.min(...N.map(tt => tt.z)),
                K = m * x * V,
                z = new Map;
            for (const tt of N) z.set(tt.sku, (z.get(tt.sku) ?? 0) + 1);
            const st = [...z.entries()].reduce((tt, ft) => tt[1] > ft[1] ? tt : ft)[0];
            S.push({
                layerIndex: O,
                utilization: K > 0 ? q / K : 0,
                itemCount: N.length,
                mainSku: st
            })
        }
        const A = _.reduce((O, N) => O + N.orientation.lengthMm * N.orientation.widthMm * N.orientation.heightMm, 0),
            contentHeightMm = _.reduce((height, item) => Math.max(height, item.z + item.orientation.heightMm), 0),
            G = m * x * contentHeightMm;
        return {
            palletTypeIndex: n,
            palletTypeId: s.id,
            palletCode: s.code,
            palletLengthMm: s.lengthMm,
            palletWidthMm: s.widthMm,
            palletHeightMm: s.heightMm,
            skuSummary: [...h.entries()].map(([productIndex, quantity]) => ({
                sku: t.products[productIndex].sku,
                productIndex,
                quantity
            })),
            items: _,
            priorityGroup,
            totalHeightMm: c + contentHeightMm,
            totalWeightG: T + (s.emptyWeightG ?? 0),
            layerCount: P,
            utilization: G > 0 ? A / G : 0,
            layerUtilizations: S
        }
    }
    dynamicGap(t) {
        return Math.max(2, Math.min(5, Math.min(t.lengthMm, t.widthMm) * .01))
    }
    scoreOrientation(t, e, n) {
        let s = 0;
        t.lengthMm >= t.widthMm && (s += 100), s += (1e3 - t.heightMm) * .1;
        const r = e % t.lengthMm,
            a = n % t.widthMm;
        r < 10 && (s += 50), a < 10 && (s += 50);
        const o = Math.floor(e / t.lengthMm),
            c = Math.floor(n / t.widthMm);
        return s += o * c * .5, s
    }
    calculateSupportRatio(t, e) {
        const n = e.filter(a => Math.abs(a.z2 - t.z) < se);
        if (n.length === 0) return t.z <= se ? 1 : 0;
        const s = t.length * t.width;
        let r = 0;
        for (const a of n) {
            const o = Math.max(t.x, a.x),
                c = Math.min(t.x2, a.x2),
                l = Math.max(t.y, a.y),
                d = Math.min(t.y2, a.y2);
            if (c > o + se && d > l + se) {
                const f = (c - o) * (d - l);
                r += f
            }
        }
        return s > se ? Math.min(1, r / s) : 0
    }
}

function Cl(i, t) {
    return i.x < t.x2 - se && i.x2 > t.x + se && i.y < t.y2 - se && i.y2 > t.y + se && i.z < t.z2 - se && i.z2 > t.z + se
}

function Pl(i, t, controls) {
    return new Rl(t).solve(i, controls)
}
const re = 1e-6;

function bi(i, t, e, n, s, r) {
    return {
        x: i,
        y: t,
        z: e,
        x2: i + n,
        y2: t + s,
        z2: e + r,
        length: n,
        width: s,
        height: r
    }
}

function xa(i, t) {
    return i.x < t.x2 - re && i.x2 > t.x + re && i.y < t.y2 - re && i.y2 > t.y + re && i.z < t.z2 - re && i.z2 > t.z + re
}

function Dl(i, t) {
    return i.x >= t.x - re && i.x2 <= t.x2 + re && i.y >= t.y - re && i.y2 <= t.y2 + re && i.z >= t.z - re && i.z2 <= t.z2 + re
}

function Ll(i, t) {
    const e = [];
    if (t.x2 < i.x2 - re && e.push(bi(t.x2, i.y, i.z, i.x2 - t.x2, i.width, i.height)), t.y2 < i.y2 - re) {
        const n = i.x,
            s = Math.min(i.x2, t.x2);
        s - n > re && e.push(bi(n, t.y2, i.z, s - n, i.y2 - t.y2, i.height))
    }
    if (t.z2 < i.z2 - re) {
        const n = i.x,
            s = Math.min(i.x2, t.x2),
            r = i.y,
            a = Math.min(i.y2, t.y2);
        s - n > re && a - r > re && e.push(bi(n, r, t.z2, s - n, a - r, i.z2 - t.z2))
    }
    return e.filter(n => n.length > re && n.width > re && n.height > re)
}

function Il(i) {
    return {
        allowPalletRotation: i?.allowPalletRotation ?? !0,
        maxPalletsPerContainer: i?.maxPalletsPerContainer ?? 1e3
    }
}
class Ul {
    options;
    constructor(t) {
        this.options = Il(t)
    }
    solve(t, e, controls = {}) {
        if (t.length === 0) return {
            placements: [],
            palletPlacements: [],
            unloaded: [],
            metrics: {
                loadedVolumeMm3: 0,
                containerVolumeMm3: 0,
                volumeRatio: 0,
                loadedWeightG: 0,
                containerPayloadG: 0,
                weightRatio: 0,
                containersUsed: 0
            },
            warnings: [],
            solverVersion: "pallet-loading/0.2.0"
        };
        if (e.containerTypes.length === 0) throw new Error("PlanInput 至少需要一种柜型。");
        const n = t.map((_, u) => ({
            unit: _,
            index: u
        }));
        n.sort((_, u) => {
            const group = (_.unit.priorityGroup ?? 1) - (u.unit.priorityGroup ?? 1);
            if (group) return group;
            const h = _.unit.palletLengthMm * _.unit.palletWidthMm * _.unit.totalHeightMm;
            return u.unit.palletLengthMm * u.unit.palletWidthMm * u.unit.totalHeightMm - h
        });
        const s = [];
        let r = 0;
        for (const _ of e.containerTypes)
            for (let u = 0; u < _.quantity; u += 1) s.push({
                containerIndex: r,
                type: _
            }), r += 1;
        const a = s.reduce((_, u) => _ + u.type.innerLengthMm * u.type.innerWidthMm * u.type.innerHeightMm, 0),
            o = s.reduce((_, u) => _ + u.type.maxPayloadG, 0),
            c = [],
            palletPlacements = [],
            l = n.map(_ => ({
                ..._
            })),
            d = [];
        for (const {
                containerIndex: _,
                type: u
            }
            of s) {
            if (stopped(controls) || l.every(E => E.unit === null)) break;
            const h = {
                spaces: [bi(0, 0, 0, u.innerLengthMm, u.innerWidthMm, u.innerHeightMm)],
                placed: [],
                usedWeightG: 0,
                activePriorityGroup: 0
            };
            let w = 0,
                T = !0;
            for (; T && w < this.options.maxPalletsPerContainer && !stopped(controls);) {
                T = !1;
                let E = null,
                    P = Number.NEGATIVE_INFINITY;
                for (const R of h.spaces)
                    for (let b = 0; b < l.length; b += 1) {
                        const I = l[b];
                        if (!I || I.unit === null) continue;
                        const M = I.unit,
                            S = M.totalWeightG;
                        const priorityGroup = M.priorityGroup ?? 1;
                        if (priorityGroup < h.activePriorityGroup) continue;
                        if ((e.priorityGroupMode ?? "virtual-wall") === "virtual-wall" && h.placed.some(item =>
                            (item.unit.priorityGroup ?? 1) < priorityGroup && R.x < item.box.x2 - re)) continue;
                        if (R.z > re) continue;
                        if (h.usedWeightG + S > u.maxPayloadG) continue;
                        const A = [{
                            length: M.palletLengthMm,
                            width: M.palletWidthMm,
                            height: M.totalHeightMm,
                            rotated: !1
                        }];
                        this.options.allowPalletRotation && A.push({
                            length: M.palletWidthMm,
                            width: M.palletLengthMm,
                            height: M.totalHeightMm,
                            rotated: !0
                        });
                        for (const G of A) {
                            if (!fitsDoor(G.width, G.height, u)) continue;
                            if (G.rotated && M.items.some(item => !Po(e.products[item.productIndex]).some(orientation => orientation.lengthMm === item.orientation.widthMm && orientation.widthMm === item.orientation.lengthMm && orientation.heightMm === item.orientation.heightMm))) continue;
                            const gap = e.palletTypes[M.palletTypeIndex]?.minimumGapMm ?? 0,
                                O = Math.min(G.length + gap, R.length),
                                N = Math.min(G.width + gap, R.width),
                                q = G.height;
                            if (G.length > R.length + re || G.width > R.width + re || q > R.height + re) continue;
                            const V = bi(R.x, R.y, R.z, O, N, q);
                            let K = !1;
                            for (const st of h.placed)
                                if (xa(V, st.box)) {
                                    K = !0;
                                    break
                                } if (K) continue;
                            const z = G.length * G.width * G.height;
                            const earlier = !E || priorityGroup < E.priorityGroup || priorityGroup === E.priorityGroup && (
                                V.x < E.box.x - re || Math.abs(V.x - E.box.x) <= re && (
                                V.y < E.box.y - re || Math.abs(V.y - E.box.y) <= re && z > P));
                            earlier && (P = z, E = {
                                space: R,
                                unit: M,
                                box: V,
                                pendingIndex: b,
                                rotated: G.rotated,
                                priorityGroup
                            })
                        }
                    }
                if (E !== null) {
                    const {
                        unit: R,
                        box: b,
                        pendingIndex: I,
                        rotated: M
                    } = E, S = b.x, A = b.y, G = b.z;
                    const palletId = `pallet-${_}-${palletPlacements.length}`;
                    palletPlacements.push({
                        id: palletId, containerIndex: _, x: S, y: A, z: G,
                        lengthMm: M ? R.palletWidthMm : R.palletLengthMm,
                        widthMm: M ? R.palletLengthMm : R.palletWidthMm,
                        heightMm: R.palletHeightMm,
                        totalHeightMm: R.totalHeightMm, totalWeightG: R.totalWeightG,
                        emptyWeightG: e.palletTypes[R.palletTypeIndex]?.emptyWeightG ?? 0,
                        tareWeightKnown: e.palletTypes[R.palletTypeIndex]?.tareWeightKnown ?? false,
                        priorityGroup: R.priorityGroup ?? 1,
                        palletTypeId: R.palletTypeId, palletTypeIndex: R.palletTypeIndex,
                        minimumGapMm: e.palletTypes[R.palletTypeIndex]?.minimumGapMm ?? 0,
                        rotated: M
                    });
                    h.placed.push({
                        box: b,
                        unit: R,
                        globalX: S,
                        globalY: A,
                        globalZ: G
                    }), h.usedWeightG += R.totalWeightG, h.activePriorityGroup = Math.max(h.activePriorityGroup, R.priorityGroup ?? 1);
                    for (const N of R.items) {
                        let q = N.x,
                            V = N.y,
                            K = N.z,
                            z = N.orientation;
                        if (M) {
                            const st = N.y,
                                tt = R.palletLengthMm - N.x - N.orientation.lengthMm;
                            q = st, V = tt, z = {
                                ...N.orientation,
                                code: N.orientation.code[1] + N.orientation.code[0] + N.orientation.code.slice(2),
                                lengthMm: N.orientation.widthMm,
                                widthMm: N.orientation.lengthMm
                            }
                        }
                        c.push({
                            productIndex: N.productIndex,
                            sku: N.sku,
                            orientation: z,
                            x: S + q,
                            y: A + V,
                            z: G + K + R.palletHeightMm,
                            containerIndex: _,
                            palletId,
                            priorityGroup: e.products[N.productIndex]?.priorityGroup ?? 1
                        })
                    }
                    l[I].unit = null, w += 1, T = !0;
                    const O = [];
                    for (const N of h.spaces) {
                        if (!xa(N, b)) {
                            O.push(N);
                            continue
                        }
                        const q = Ll(N, b);
                        for (const V of q) h.placed.some(K => K.box !== b && Dl(V, K.box)) || O.push(V)
                    }
                    h.spaces = O.filter(space => space.z <= re)
                } else T = !1
            }
            w >= this.options.maxPalletsPerContainer && d.push(`容器 ${_} 达到最大托盘数保护（${this.options.maxPalletsPerContainer}）。`)
        }
        const f = [];
        for (const _ of l)
            if (_.unit !== null)
                for (const u of _.unit.skuSummary) {
                    const h = f.find(w => w.productIndex === u.productIndex);
                    h ? h.remaining += u.quantity : f.push({
                        sku: u.sku,
                        productIndex: u.productIndex,
                        remaining: u.quantity
                    })
                }
        const p = c.reduce((_, u) => _ + u.orientation.lengthMm * u.orientation.widthMm * u.orientation.heightMm, 0),
            m = palletPlacements.reduce((sum, pallet) => sum + pallet.totalWeightG, 0),
            x = new Set(c.map(_ => _.containerIndex));
        return f.length > 0 && d.push("存在未能装入的托盘货物，请增加容器数量。"), {
            placements: c,
            palletPlacements,
            unloaded: f,
            metrics: {
                loadedVolumeMm3: p,
                containerVolumeMm3: a,
                volumeRatio: a > 0 ? p / a : 0,
                loadedWeightG: m,
                containerPayloadG: o,
                weightRatio: o > 0 ? m / o : 0,
                containersUsed: x.size
            },
            warnings: d,
            solverVersion: "pallet-loading/0.2.0"
        }
    }
}

function Nl(i, t, e, controls) {
    return new Ul(e).solve(i, t, controls)
}

function Jr(i, t, e) {
    return {
        ...e,
        dimensionsMm: t,
        originMm: {
            x: i.x,
            y: i.y,
            z: i.z
        },
        centerMm: {
            x: i.x + t.length / 2,
            y: i.y + t.width / 2,
            z: i.z + t.height / 2
        }
    }
}

function Ol(i, t, e) {
    const {
        lengthMm: n,
        widthMm: s,
        heightMm: r,
        code: a
    } = i.orientation;
    return Jr(i, {
        length: n,
        width: s,
        height: r
    }, {
        id: `cargo-${i.containerIndex}-${e}`,
        kind: "cargo",
        sku: i.sku,
        productIndex: i.productIndex,
        containerIndex: i.containerIndex,
        loadSequence: e + 1,
        priorityGroup: i.priorityGroup ?? 1,
        orientation: a,
        color: t
    })
}

function zl(i) {
    return i.products.map((t, e) => ({
        id: `browser-product-${e}`,
        sku: t.sku,
        name: t.name,
        lengthMm: t.l,
        widthMm: t.w,
        heightMm: t.h,
        weightG: Math.round(t.kg * 1e3),
        quantity: t.q,
        allowHorizontalRotation: t.rotate,
        allowSideLoading: t.side,
        allowUpsideDown: !1,
        mustStayUpright: !t.side,
        stackable: t.stackable !== !1,
        maxStackLayers: Number.isFinite(t.maxLayers) ? Math.max(1, Math.floor(t.maxLayers)) : void 0,
        maxTopLoadG: Number.isFinite(t.maxTopKg) ? Math.max(0, Math.round(t.maxTopKg * 1e3)) : void 0,
        priorityGroup: Number.isInteger(t.group) ? Math.max(1, t.group) : 1,
        palletPolicy: i.mode === "pallet" ? "required" : "auto",
        priority: e
    }))
}

function Hl(i) {
    return {
        id: i.id,
        code: i.code,
        name: i.code,
        innerLengthMm: i.l,
        innerWidthMm: i.w,
        innerHeightMm: i.h,
        doorWidthMm: Number.isFinite(i.doorWidthMm) ? i.doorWidthMm : undefined,
        doorHeightMm: Number.isFinite(i.doorHeightMm) ? i.doorHeightMm : undefined,
        maxFloorLoadKgM2: i.maxFloorLoadKgM2,
        maxLongitudinalOffsetMm: i.maxLongitudinalOffsetMm,
        maxLateralOffsetMm: i.maxLateralOffsetMm,
        maxPayloadG: Math.round(i.kg * 1e3),
        quantity: i.quantity
    }
}

function kl(i) {
    return {
        id: "browser-pallet",
        code: "BROWSER",
        name: "页面输入托盘",
        lengthMm: i.l,
        widthMm: i.w,
        heightMm: Number.isFinite(i.heightMm) ? Math.max(0, i.heightMm) : 144,
        supplyMode: Number.isFinite(i.qty) ? "limited" : "unlimited",
        quantity: Number.isFinite(i.qty) ? Math.max(0, Math.floor(i.qty)) : undefined,
        maxLoadG: Number.isFinite(i.maxLoadKg) ? Math.max(0, i.maxLoadKg * 1000) : 1e6,
        emptyWeightG: Number.isFinite(i.emptyWeightKg) ? Math.max(0, i.emptyWeightKg * 1000) : 0,
        tareWeightKnown: Number.isFinite(i.emptyWeightKg),
        maxLoadedHeightMm: Math.max(1, i.maxH ?? i.h),
        overhangMm: 0,
        allowHorizontalRotation: !0,
        allowDoubleStack: !1,
        minimumGapMm: Math.max(0, i.gap ?? 50)
    }
}

function Gl(i) {
    return {
        id: "browser-plan",
        mode: i.mode,
        allocationStrategy: "LARGE_FIRST",
        products: zl(i),
        palletTypes: i.pallet ? [kl(i.pallet)] : [],
        containerTypes: [Hl(i.container)],
        minimumSupportRatio: Number.isFinite(i.minimumSupportRatio) ? Math.max(0, Math.min(1, i.minimumSupportRatio)) : 1,
        priorityGroupMode: i.priorityGroupMode ?? "virtual-wall",
        looseCargoMaxGapMm: Math.max(0, i.looseCargoMaxGapMm ?? 50)
    }
}

function Vl(i, t) {
    return i.placements.map((e, n) => Ol(e, t[e.productIndex] ?? "#8794a1", n))
}

function Wl(i, t) {
    const e = i.map(() => 0);
    for (const n of t.placements) e[n.productIndex] = (e[n.productIndex] ?? 0) + 1;
    return e
}

function va(i, t, e, n) {
    const palletPlacements = i.palletPlacements ?? [];
    const supports = i.placements.map(item => ({...item, box: Nn(item.x, item.y, item.z, item.orientation.lengthMm, item.orientation.widthMm, item.orientation.heightMm)}));
    let measuredMinimumSupportRatio = 1;
    for (const item of supports) {
        const pallet = palletPlacements.find(base => base.id === item.palletId);
        const bases = supports.filter(base => base.containerIndex === item.containerIndex && base.palletId === item.palletId);
        if (pallet) bases.push({box: Nn(pallet.x, pallet.y, pallet.z, pallet.lengthMm, pallet.widthMm, pallet.heightMm)});
        measuredMinimumSupportRatio = Math.min(measuredMinimumSupportRatio, supportRatio(item.box, bases));
    }
    return {
        sceneItems: [...Vl(i, n), ...palletPlacements.map(pallet => Jr(pallet, {length: pallet.lengthMm, width: pallet.widthMm, height: pallet.heightMm}, {id: pallet.id, kind: "pallet", productIndex: -1, containerIndex: pallet.containerIndex, sku: "托盘", orientation: "托盘", color: "#b78346"}))],
        placements: i.placements,
        palletPlacements,
        loadedByProduct: Wl(t, i),
        unloaded: i.unloaded ?? [],
        warnings: i.warnings,
        metrics: {
            ...i.metrics,
            volumeRatio: i.metrics.volumeRatio,
            weightRatio: i.metrics.weightRatio,
            containersUsed: i.metrics.containersUsed,
            maxInternalGapMm: i.metrics.maxInternalGapMm ?? 0,
            oversizedGapCount: i.metrics.oversizedGapCount ?? 0,
            looseCargoMaxGapMm: i.metrics.looseCargoMaxGapMm ?? 50,
            targetGapMm: i.metrics.targetGapMm ?? 0,
            minimumSupportRatio: measuredMinimumSupportRatio,
            containerDiagnostics: i.metrics.containerDiagnostics ?? []
        },
        solverVersion: i.solverVersion,
        palletsUsed: e
    }
}

function Xl(i, controls = {}) {
    const t = Gl(i),
        e = i.products.map(r => r.color);
    if (i.mode === "loose") {
        const r = bl(t, undefined, controls);
        return va(r, t.products, 0, e)
    }
    const n = Pl(t, {
            mode: i.pallet?.packingMode ?? "mixed-max",
            allowLooseCargo: i.pallet?.allowLooseCargo ?? !0,
            minSupportRatio: t.minimumSupportRatio
        }, controls),
        s = Nl(n.pallets, t, undefined, controls);
    for (const item of n.unloaded) {
        const unloaded = s.unloaded.find(value => value.productIndex === item.productIndex);
        if (unloaded) unloaded.remaining += item.remaining;
        else s.unloaded.push({...item});
    }
    s.warnings.push(...n.warnings);
    if (n.unloaded.length) s.warnings.push("部分货物未能完成组托；请检查托盘数量、尺寸、承重和堆叠约束。");
    return va(s, t.products, s.palletPlacements.length, e)
}

export {
    Xl as solveBaseline,
    Gl as normalizeInput,
    bl as solveLooseCargo,
    va as toBrowserResult,
    Po as allowedOrientations,
    canPassDoor,
    Nn as makeBox,
    vl as boxesOverlap,
    supportRatio,
    directSupportItems,
    validateStackSafety,
    applyTopLoad,
    computeLooseGapStats,
    computeContainerDiagnostics
};
