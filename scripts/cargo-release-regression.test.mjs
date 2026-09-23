import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { chmod, cp, mkdir, mkdtemp, readFile, rm, symlink, utimes, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { createManifest, verifyLocalRelease, verifyPublicRelease } from './cargo-release-check.mjs';

const repository = fileURLToPath(new URL('..', import.meta.url));
const sha = 'a'.repeat(40), previousSha = 'b'.repeat(40);
const digest = data => createHash('sha256').update(data).digest('hex');

async function fixture() {
  const temporary = await mkdtemp(path.join(tmpdir(), 'cargo-release-test-'));
  const artifact = path.join(temporary, 'artifact');
  await mkdir(artifact);
  await cp(path.join(repository, 'cargo'), path.join(artifact, 'cargo'), { recursive: true });
  await createManifest(artifact, sha);
  return { temporary, artifact };
}

test('public acceptance verifies canonical redirects, actual entry, all hashes and downloaded behavior', async () => {
  const { temporary, artifact } = await fixture();
  try {
    const requested = [];
    const fetchMock = async address => {
      const url = new URL(address);
      requested.push(url.pathname);
      if (url.hostname === 'www.openit.cc') return new Response(null, { status: 301, headers: { location: address.replace('www.openit.cc', 'openit.cc') } });
      if (url.pathname === '/healthz') return new Response('{"ok":true,"service":"openit"}');
      return new Response(await readFile(path.join(artifact, url.pathname === '/cargo/' ? 'cargo/index.html' : url.pathname.slice(1))));
    };
    const report = await verifyPublicRelease(artifact, sha, 'https://www.openit.cc', fetchMock);
    assert.equal(report.releaseSha, sha);
    assert.ok(requested.includes('/cargo/') && requested.includes('/cargo/solver/export.js'));
    assert.equal(report.behavior.mixedCartons, 6);
    assert.equal(report.behavior.mixedGapMm, 0);
    assert.ok(report.behavior.loadedLargePlan > 600);
    assert.equal(report.behavior.loadedLargePlan, report.behavior.renderedLargePlan);
    assert.equal(report.behavior.palletHeightMm, 1794);
    await assert.rejects(verifyPublicRelease(artifact, sha, 'https://openit.cc', async address =>
      new URL(address).pathname === '/cargo/' ? new Response('stale index') : fetchMock(address)), /Cargo entry/);
    await assert.rejects(verifyPublicRelease(artifact, sha, 'https://openit.cc', async address =>
      new URL(address).pathname === '/cargo/solver/core.js' ? new Response('stale module') : fetchMock(address)), /Production asset mismatch/);
    await assert.rejects(verifyPublicRelease(artifact, sha, 'https://openit.cc', async () =>
      new Response(null, { status: 302, headers: { location: 'https://unapproved.example/healthz' } })), /approved HTTPS/);
    await writeFile(path.join(artifact, 'cargo/solver/worker.js'), 'changed');
    await assert.rejects(verifyLocalRelease(artifact, sha), /Local asset mismatch/);
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
});

test('workflow separates installation, public acceptance, final marker and failure recovery', async () => {
  const workflow = await readFile(path.join(repository, '.github/workflows/deploy-openit.yml'), 'utf8');
  assert.ok(workflow.indexOf('id: install') < workflow.indexOf('id: acceptance'));
  assert.ok(workflow.indexOf('id: acceptance') < workflow.indexOf('id: finalize'));
  assert.ok(workflow.indexOf('id: finalize') < workflow.indexOf('id: cleanup'));
  assert.ok(workflow.indexOf('id: cleanup') < workflow.indexOf('Inventory retained release artifacts'));
  assert.match(workflow, /id: cleanup[\s\S]*steps\.finalize\.outcome == 'success'[\s\S]*continue-on-error: true/);
  assert.match(workflow, /always\(\).*steps\.finalize\.outcome != 'success'/);
  assert.ok(workflow.match(/git fetch origin main/g).length >= 3);
  assert.match(workflow, /https:\/\/openit\.cc/);
  assert.match(workflow, /https:\/\/www\.openit\.cc/);
  assert.ok(!workflow.includes('"${{ inputs.release_sha }}"'), 'Dispatch input must enter shell through env, not source interpolation');
  const installer = await readFile(path.join(repository, 'scripts/cargo-release-install.sh'), 'utf8');
  assert.ok(!installer.includes('|| true'));
  assert.ok(!installer.includes('pnpm install'));
  assert.ok(!installer.includes('rm -rf "$WEB_ROOT"'));
  assert.match(installer, /cleanup_accepted_releases\(\)/);
  assert.match(installer, /retained_count < 3/);
  assert.match(installer, /rm -rf --one-file-system -- "\$backup"/);
  assert.match(installer, /rm -f -- "\$artifact"/);
  assert.match(installer, /sync -f "\$BACKUP_DIR\/exchanges.log"/);
  assert.match(installer, /library\.renameat2/);
});

test('Linux atomic exchange, partial failure and public-acceptance rollback preserve business files', { skip: process.platform !== 'linux' }, async () => {
  const { temporary, artifact } = await fixture();
  try {
    const web = path.join(temporary, 'web'), releases = path.join(temporary, 'releases'), backups = path.join(temporary, 'backups');
    const nodeDir = path.join(temporary, 'bin'), incoming = path.join(temporary, 'incoming');
    for (const directory of [web, releases, backups, nodeDir, incoming, path.join(artifact, 'dist'), path.join(artifact, 'scripts')]) await mkdir(directory, { recursive: true });
    await cp(path.join(repository, 'scripts/cargo-release-check.mjs'), path.join(artifact, 'scripts/cargo-release-check.mjs'));
    const files = { 'package.json': '{"type":"module","dependencies":{},"scripts":{}}\n', 'pnpm-lock.yaml': 'fixture-lock\n',
      'pnpm-workspace.yaml': 'packages: ["."]\n', 'ecosystem.config.cjs': 'module.exports = {};\n', 'README.md': 'release documentation\n',
      'LICENSE': 'test\n', 'DEPLOYMENT.md': 'test deployment\n', 'dist/index.js': '// new application\n' };
    for (const [name, body] of Object.entries(files)) {
      await writeFile(path.join(artifact, name), body);
      await mkdir(path.dirname(path.join(web, name)), { recursive: true });
      await writeFile(path.join(web, name), name === 'dist/index.js' ? '// previous application\n' : body);
    }
    for (const directory of ['cargo', 'scripts', 'patches', 'node_modules', 'data', 'uploads', 'logs']) await mkdir(path.join(web, directory), { recursive: true });
    await mkdir(path.join(artifact, 'patches'));
    await writeFile(path.join(artifact, 'patches/expected.patch'), 'preserve patches/expected.patch');
    await writeFile(path.join(web, 'cargo/index.html'), 'previous entry');
    await writeFile(path.join(web, 'cargo/obsolete.js'), 'old code stays in rollback point');
    const protectedFiles = ['.env', 'data/snapshot.json', 'uploads/file.txt', 'logs/application.log', 'node_modules/sentinel',
      'patches/expected.patch', 'patches/legacy.patch'];
    for (const name of protectedFiles) await writeFile(path.join(web, name), `preserve ${name}`);
    await writeFile(path.join(web, '.deploy-sha'), previousSha + '\n');
    const failureFlag = path.join(temporary, 'fail-restart');
    const programs = { node: `#!/usr/bin/env bash\nexec '${process.execPath}' "$@"\n`,
      curl: '#!/usr/bin/env bash\nprintf \'%s\' \'{"ok":true,"service":"openit"}\'\n',
      pm2: `#!/usr/bin/env bash\nif [[ "$1" == restart && -f '${failureFlag}' ]]; then mv '${failureFlag}' '${failureFlag}.consumed'; exit 1; fi\nexit 0\n` };
    for (const [name, body] of Object.entries(programs)) { await writeFile(path.join(nodeDir, name), body); await chmod(path.join(nodeDir, name), 0o755); }
    let installer = await readFile(path.join(repository, 'scripts/cargo-release-install.sh'), 'utf8');
    for (const [original, replacement] of [['/www/wwwroot/openit.cc', web], ['/www/server/nodejs/v24.18.0/bin', nodeDir],
      ['/www/deploy/openit/releases', releases], ['/www/backup/openit/releases', backups], ['/tmp/openit-', `${incoming}/openit-`]]) installer = installer.replaceAll(original, replacement);
    assert.ok(!installer.includes('/www/') && !installer.includes('/tmp/openit-'), 'Fixture must not access production paths');
    const interruptionFlag = path.join(temporary, 'interrupt-before-cargo');
    // Fault injection exists only in the isolated fixture, not in the deployer.
    installer = installer.replace('atomic_exchange "$RELEASE_DIR/$entry" "$WEB_ROOT/$entry"',
      `if [[ "$entry" == cargo && -f '${interruptionFlag}' ]]; then mv '${interruptionFlag}' '${interruptionFlag}.consumed'; exit 73; fi\n      atomic_exchange "$RELEASE_DIR/$entry" "$WEB_ROOT/$entry"`);
    const script = path.join(temporary, 'install-fixture.sh');
    await writeFile(script, installer);
    const run = (action, runKey) => spawnSync('bash', [script, action, sha, runKey], { encoding: 'utf8', timeout: 30000, maxBuffer: 1024 * 1024 });
    const packageFor = async runKey => {
      const archive = path.join(incoming, `openit-${sha}-${runKey}.tar.gz`);
      const result = spawnSync('tar', ['-C', artifact, '-czf', archive, '.'], { encoding: 'utf8' });
      assert.equal(result.status, 0, result.stderr);
      await writeFile(archive + '.sha256', `${digest(await readFile(archive))}  ${path.basename(archive)}\n`);
    };
    const checkProtected = async () => { for (const name of protectedFiles) assert.equal(await readFile(path.join(web, name), 'utf8'), `preserve ${name}`); };
    const success = result => assert.equal(result.status, 0, result.stdout + result.stderr);

    await packageFor('99-1');
    await writeFile(path.join(web, 'patches/expected.patch'), 'changed expected patch');
    const mismatchedPatch = run('apply', '99-1');
    assert.notEqual(mismatchedPatch.status, 0);
    assert.match(mismatchedPatch.stderr, /Expected patch differs/);
    assert.equal(await readFile(path.join(web, 'cargo/index.html'), 'utf8'), 'previous entry');
    await assert.rejects(readFile(path.join(backups, `${sha}-99-1`, 'install-started')), { code: 'ENOENT' });
    await rm(path.join(web, 'patches/expected.patch'));
    await symlink(path.join(web, 'patches/legacy.patch'), path.join(web, 'patches/expected.patch'));
    await packageFor('99-2');
    const symlinkPatch = run('apply', '99-2');
    assert.notEqual(symlinkPatch.status, 0);
    assert.match(symlinkPatch.stderr, /Expected patch path is a symlink/);
    await assert.rejects(readFile(path.join(backups, `${sha}-99-2`, 'install-started')), { code: 'ENOENT' });
    await rm(path.join(web, 'patches/expected.patch'));
    await writeFile(path.join(web, 'patches/expected.patch'), 'preserve patches/expected.patch');
    await checkProtected();

    await packageFor('100-1');
    success(run('apply', '100-1'));
    await checkProtected();
    assert.notEqual(await readFile(path.join(web, 'cargo/index.html'), 'utf8'), 'previous entry');
    assert.equal(await readFile(path.join(web, '.deploy-sha'), 'utf8'), previousSha + '\n', 'Install must not accept its own release');
    const checksum = path.join(backups, `${sha}-100-1`, 'backup.tar.gz.sha256');
    const originalChecksum = await readFile(checksum);
    await writeFile(checksum, `${'0'.repeat(64)}  backup.tar.gz\n`);
    assert.notEqual(run('rollback', '100-1').status, 0, 'Corrupt backup must block recovery before code changes');
    assert.notEqual(await readFile(path.join(web, 'cargo/index.html'), 'utf8'), 'previous entry');
    await writeFile(checksum, originalChecksum);
    success(run('rollback', '100-1')); // Simulate a public HTTP/hash acceptance failure.
    assert.equal(await readFile(path.join(web, 'cargo/index.html'), 'utf8'), 'previous entry');
    assert.equal(await readFile(path.join(web, '.deploy-sha'), 'utf8'), previousSha + '\n');
    await checkProtected();

    await packageFor('100-2');
    await writeFile(failureFlag, 'fail first PM2 restart');
    const failed = run('apply', '100-2');
    assert.notEqual(failed.status, 0, failed.stdout + failed.stderr);
    assert.equal(await readFile(path.join(web, 'cargo/index.html'), 'utf8'), 'previous entry', failed.stdout + failed.stderr);
    assert.equal(await readFile(path.join(web, '.deploy-sha'), 'utf8'), previousSha + '\n');
    await checkProtected();

    await packageFor('100-3');
    await writeFile(interruptionFlag, 'fail after durable journal entry but before cargo swap');
    const interrupted = run('apply', '100-3');
    assert.equal(interrupted.status, 73, interrupted.stdout + interrupted.stderr);
    assert.equal(await readFile(path.join(web, 'cargo/index.html'), 'utf8'), 'previous entry');
    assert.equal(await readFile(path.join(web, 'dist/index.js'), 'utf8'), '// previous application\n');
    assert.equal(await readFile(path.join(web, '.deploy-sha'), 'utf8'), previousSha + '\n');
    await checkProtected();

    await packageFor('100-4');
    success(run('apply', '100-4'));
    const prematureCleanup = run('cleanup', '100-4');
    assert.notEqual(prematureCleanup.status, 0, 'Cleanup must not run before the release is accepted');
    assert.match(prematureCleanup.stderr, /not accepted/);
    assert.ok((await readFile(path.join(incoming, `openit-${sha}-100-4.tar.gz`))).length > 0);
    success(run('finalize', '100-4'));
    assert.equal(await readFile(path.join(web, '.deploy-sha'), 'utf8'), sha + '\n');
    const acceptedHistory = [
      { name: `${'1'.repeat(40)}-90-1`, time: 1_700_000_001 },
      { name: `${'2'.repeat(40)}-90-2`, time: 1_700_000_002 },
      { name: `${'3'.repeat(40)}-90-3`, time: 1_700_000_003 },
    ];
    for (const item of acceptedHistory) {
      const backup = path.join(backups, item.name), release = path.join(releases, item.name);
      await mkdir(backup); await mkdir(release);
      await writeFile(path.join(backup, 'accepted'), 'accepted\n');
      await writeFile(path.join(backup, 'sentinel'), item.name);
      await writeFile(path.join(release, 'sentinel'), item.name);
      await utimes(path.join(backup, 'accepted'), item.time, item.time);
    }
    const unknownDirectory = path.join(backups, 'manual-investigation');
    await mkdir(unknownDirectory); await writeFile(path.join(unknownDirectory, 'accepted'), 'not a managed release name');
    success(run('cleanup', '100-4'));
    await assert.rejects(readFile(path.join(backups, acceptedHistory[0].name, 'accepted')), { code: 'ENOENT' });
    await assert.rejects(readFile(path.join(releases, acceptedHistory[0].name, 'sentinel')), { code: 'ENOENT' });
    for (const item of acceptedHistory.slice(1)) {
      assert.equal(await readFile(path.join(backups, item.name, 'sentinel'), 'utf8'), item.name);
      assert.equal(await readFile(path.join(releases, item.name, 'sentinel'), 'utf8'), item.name);
    }
    assert.equal(await readFile(path.join(unknownDirectory, 'accepted'), 'utf8'), 'not a managed release name');
    await assert.rejects(readFile(path.join(incoming, `openit-${sha}-100-4.tar.gz`)), { code: 'ENOENT' });
    await assert.rejects(readFile(path.join(incoming, `openit-${sha}-100-4.tar.gz.sha256`)), { code: 'ENOENT' });
    assert.ok((await readFile(path.join(backups, `${sha}-100-3`, 'restored'), 'utf8')).trim(),
      'Unaccepted interrupted-run evidence must remain');

    const irregularName = `${'4'.repeat(40)}-90-4`;
    const irregularBackup = path.join(backups, irregularName);
    const irregularRelease = path.join(releases, irregularName);
    await mkdir(irregularBackup);
    await writeFile(path.join(irregularBackup, 'accepted'), 'accepted\n');
    await utimes(path.join(irregularBackup, 'accepted'), 1_699_999_999, 1_699_999_999);
    await symlink(unknownDirectory, irregularRelease);
    const irregularCleanup = run('cleanup', '100-4');
    assert.notEqual(irregularCleanup.status, 0, 'A symlinked managed release path must stop cleanup');
    assert.match(irregularCleanup.stderr, /Irregular release path/);
    assert.equal(await readFile(path.join(unknownDirectory, 'accepted'), 'utf8'), 'not a managed release name');
    assert.equal(await readFile(path.join(irregularBackup, 'accepted'), 'utf8'), 'accepted\n');
    await rm(irregularRelease);
    await mkdir(irregularRelease);
    success(run('cleanup', '100-4')); // Idempotent once the accepted set is within policy.
    await assert.rejects(readFile(path.join(irregularBackup, 'accepted')), { code: 'ENOENT' });
    success(run('inventory', '100-4'));
    await checkProtected();
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
});
