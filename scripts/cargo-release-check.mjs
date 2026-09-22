import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { lstat, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const sha256 = body => createHash('sha256').update(body).digest('hex');
const requiredModules = ['client', 'core', 'engine', 'export', 'operations', 'search', 'validation', 'worker'].map(name => `solver/${name}.js`);
const isPublicPath = name => name === 'index.html' || /^(?:assets|solver)\/[A-Za-z0-9_./-]+\.(?:js|css|wasm)$/.test(name) && !name.split('/').includes('..');

async function publicFiles(root, prefix = '') {
  const files = [];
  for (const entry of await readdir(path.join(root, prefix), { withFileTypes: true })) {
    const name = prefix + entry.name;
    assert.ok(!entry.isSymbolicLink(), `Symbolic links are not release assets: ${name}`);
    if (entry.isDirectory()) files.push(...await publicFiles(root, `${name}/`));
    else if (isPublicPath(name)) files.push(name);
  }
  return files.sort();
}

export async function createManifest(releaseRoot, releaseSha) {
  assert.match(releaseSha, /^[0-9a-f]{40}$/);
  const cargoRoot = path.join(releaseRoot, 'cargo'), files = {};
  for (const name of await publicFiles(cargoRoot)) files[name] = sha256(await readFile(path.join(cargoRoot, name)));
  for (const name of ['index.html', ...requiredModules]) assert.ok(files[name], `Missing Cargo runtime asset: ${name}`);
  assert.ok(Object.keys(files).some(name => name.startsWith('assets/')), 'Missing viewer bundle');
  const manifest = { version: 1, releaseSha, files };
  await writeFile(path.join(cargoRoot, 'release.json'), JSON.stringify(manifest, null, 2) + '\n');
  return manifest;
}

export async function verifyLocalRelease(releaseRoot, releaseSha) {
  const cargoRoot = path.join(releaseRoot, 'cargo');
  const manifest = JSON.parse(await readFile(path.join(cargoRoot, 'release.json'), 'utf8'));
  assert.equal(manifest.version, 1);
  assert.equal(manifest.releaseSha, releaseSha);
  for (const name of ['index.html', ...requiredModules]) assert.ok(manifest.files[name], `Manifest missing ${name}`);
  assert.ok(Object.keys(manifest.files).some(name => name.startsWith('assets/')), 'Manifest missing viewer bundle');
  for (const [name, hash] of Object.entries(manifest.files)) {
    assert.ok(isPublicPath(name), `Unapproved public asset path: ${name}`);
    assert.match(hash, /^[0-9a-f]{64}$/);
    assert.ok((await lstat(path.join(cargoRoot, name))).isFile(), `Not a regular asset: ${name}`);
    assert.equal(sha256(await readFile(path.join(cargoRoot, name))), hash, `Local asset mismatch: ${name}`);
  }
  return manifest;
}

export async function verifyBehavior(moduleRoot) {
  const { solvePlan, assessPlan } = await import(pathToFileURL(path.join(moduleRoot, 'engine.js')).href);
  const { solveBaseline } = await import(pathToFileURL(path.join(moduleRoot, 'core.js')).href);
  const product = (sku, l, w, h, q, extra = {}) => ({ sku, name: sku, l, w, h, q, kg: 1,
    rotate: true, side: false, stackable: true, group: 1, ...extra });
  const sixInput = { mode: 'loose', optimizationGoal: 'complete-order', looseCargoMaxGapMm: 50,
    products: [product('A', 200, 200, 100, 3, { stackable: false }), product('B', 100, 300, 100, 3, { stackable: false })],
    container: { l: 600, w: 400, h: 100, kg: 1000, quantity: 1 } };
  const six = await solvePlan(sixInput, { budgetMs: 5000, maxAttempts: 6 });
  assert.deepEqual(six.loadedByProduct, [3, 3], 'Mixed six-carton plan did not fit');
  assert.equal(six.metrics.containersUsed, 1);
  assert.equal(six.metrics.maxInternalGapMm, 0);
  assert.equal(six.audit.valid, true);
  const manyInput = { mode: 'loose', products: [product('BX', 520, 380, 310, 2000, { kg: 8.5, side: true })],
    container: { l: 12032, w: 2352, h: 2698, kg: 28800, quantity: 1 } };
  const many = assessPlan(manyInput, solveBaseline(manyInput));
  const visibleCargo = many.sceneItems.filter(item => item.kind === 'cargo');
  assert.ok(many.placements.length > 600, 'Large plan did not exercise the former render limit');
  assert.equal(visibleCargo.length, many.placements.length, 'Scene omitted loaded cartons');
  assert.equal(many.audit.valid, true);
  const palletInput = { mode: 'pallet', products: [product('P', 100, 100, 150, 11)],
    container: { l: 1000, w: 500, h: 2000, kg: 1000, quantity: 1 },
    pallet: { l: 100, w: 100, qty: 1, heightMm: 144, maxH: 1800, gap: 200, maxLoadKg: 1000, emptyWeightKg: 0 } };
  const pallet = assessPlan(palletInput, solveBaseline(palletInput));
  assert.deepEqual(pallet.loadedByProduct, [11]);
  assert.equal(pallet.palletPlacements.length, 1);
  assert.equal(Math.max(...pallet.placements.map(box => box.z + box.orientation.heightMm)), 1794);
  assert.equal(pallet.audit.minimumSupportRatio, 1);
  assert.equal(pallet.audit.valid, true);
  return { mixedCartons: 6, mixedContainers: 1, mixedGapMm: 0, loadedLargePlan: many.placements.length,
    renderedLargePlan: visibleCargo.length, palletCartons: 11, palletHeightMm: 1794 };
}

export async function verifyPublicRelease(releaseRoot, releaseSha, baseUrl, fetchImpl = fetch) {
  assert.ok(['https://openit.cc', 'https://www.openit.cc'].includes(baseUrl), 'Only approved production HTTPS origins are accepted');
  const manifest = await verifyLocalRelease(releaseRoot, releaseSha);
  const get = async pathname => {
    let url = new URL(`${baseUrl}${pathname}${pathname.includes('?') ? '&' : '?'}release=${releaseSha}`);
    for (let redirects = 0; redirects <= 4; redirects++) {
      assert.ok(['https://openit.cc', 'https://www.openit.cc'].includes(url.origin), 'Redirect left the approved HTTPS origins');
      const response = await fetchImpl(url.href, { redirect: 'manual', headers: { 'Cache-Control': 'no-cache' }, signal: AbortSignal.timeout(20000) });
      if ([301, 302, 303, 307, 308].includes(response.status)) {
        assert.ok(response.headers.get('location'), 'Redirect has no Location');
        url = new URL(response.headers.get('location'), url);
        continue;
      }
      assert.ok(response.ok, `Production request failed: ${pathname} (${response.status})`);
      return Buffer.from(await response.arrayBuffer());
    }
    assert.fail('Too many production redirects');
  };
  const health = JSON.parse((await get('/healthz')).toString());
  assert.equal(health.ok, true);
  assert.equal(health.service, 'openit');
  const publicManifest = JSON.parse((await get('/cargo/release.json')).toString());
  assert.deepEqual(publicManifest, manifest, 'Production manifest does not match the exact release');
  assert.equal(sha256(await get('/cargo/')), manifest.files['index.html'], 'Production Cargo entry is not the release index');
  const verified = new Map();
  // Nothing downloaded is executed until every public asset matches the local artifact.
  for (const [name, expectedHash] of Object.entries(manifest.files)) {
    const body = await get(`/cargo/${name}`);
    assert.equal(sha256(body), expectedHash, `Production asset mismatch: ${name}`);
    verified.set(name, body);
  }
  const temporary = await mkdtemp(path.join(tmpdir(), 'openit-cargo-acceptance-'));
  try {
    await writeFile(path.join(temporary, 'package.json'), '{"type":"module"}\n');
    await mkdir(path.join(temporary, 'solver'));
    for (const [name, body] of verified) if (name.startsWith('solver/')) await writeFile(path.join(temporary, name), body);
    const behavior = await verifyBehavior(path.join(temporary, 'solver'));
    return { origin: baseUrl, releaseSha, verifiedAssets: verified.size, behavior };
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  const [action, releaseRoot, releaseSha, baseUrl] = process.argv.slice(2);
  assert.ok(releaseRoot && /^[0-9a-f]{40}$/.test(releaseSha ?? ''), 'Usage: cargo-release-check.mjs manifest|verify-local|verify-public RELEASE_ROOT SHA [HTTPS_ORIGIN]');
  const report = action === 'manifest' ? await createManifest(releaseRoot, releaseSha)
    : action === 'verify-local' ? await verifyLocalRelease(releaseRoot, releaseSha)
    : action === 'verify-public' ? await verifyPublicRelease(releaseRoot, releaseSha, baseUrl)
    : assert.fail('Unknown release verification action');
  console.log(JSON.stringify(report));
}
