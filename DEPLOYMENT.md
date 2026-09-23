# OpenIt Deployment

This repository uses `openit` as the canonical production name.

## Production Runtime

- Domain: `openit.cc`, `www.openit.cc`
- Server: `129.121.117.208`
- SSH port: `88`
- Project directory: `/www/wwwroot/openit.cc`
- Runtime manager: PM2
- PM2 process name: `openit`
- Start file: `dist/index.js`
- Node.js: `/www/server/nodejs/v24.18.0/bin/node`
- App port: `3000`
- Health check: `https://www.openit.cc/healthz`
- Nginx proxy: `openit.cc` -> `127.0.0.1:3000`

## Historical Names

- `cloudparts`: previous project and ops script name.
- `openit_cc`: BaoTa/BT Panel project record name.

These names refer to the same application lineage. The active production process is `openit`.

Do not start the old `openit_cc` BT Panel Node project while PM2 `openit` is running. The BT record was configured with a different port and previously failed with an invalid `PORT=3001` startup invocation.

## GitHub Deployment

Production releases should use the `Deploy OpenIt` GitHub Actions workflow.

Required Environment: `production-openit-cc`

Required secrets:

- `OPENIT_DEPLOY_HOST`
- `OPENIT_DEPLOY_PORT`
- `OPENIT_DEPLOY_USER`
- `OPENIT_DEPLOY_SSH_KEY`
- `OPENIT_DEPLOY_KNOWN_HOSTS`
- `OPENIT_WEB_ROOT`

The workflow requires a 40-character `release_sha`, verifies that it is the current `origin/main`, builds on GitHub, and checks main again immediately before installation and acceptance. Conversation approval can authorize a requested release where GitHub reviewer protection is unavailable; the release record must identify that approval channel without claiming that reviewer protection exists.

The current Cargo release uses the existing production root, SSH account and PM2 process. `scripts/cargo-release-install.sh` runs over SSH stdin from the reviewed GitHub revision; it does not install a permanent controller or change server permissions. Its fixed code allowlist is `dist`, `scripts`, `cargo`, and the package/lock/workspace/ecosystem/README/LICENSE/DEPLOYMENT files. It never replaces the project root, `data`, `.env`, uploads, logs, `patches` or `node_modules`.

Before changing production code, the workflow verifies the upload checksum and archive member allowlist, creates a unique backup identified by release SHA plus GitHub run ID/attempt, checks the backup archive and its checksum, and compares its contents with the live code. It captures the previous accepted SHA and hashes every backed-up code file. A failed backup is fatal.

Each fixed code unit is installed with a same-filesystem Linux `renameat2(RENAME_EXCHANGE)` operation. The script first tests Python 3's standard-library `ctypes` access to this operation against disposable staging directories and checks filesystem identity. Missing Python/libc/kernel/filesystem support stops the release before any production code changes; there is no non-atomic copy fallback. Existing deployment-directory and web-root permissions are used. This is a journaled sequence of individually atomic code-unit swaps, **not** a claim that the whole website changes atomically or without interruption. Every swap is durably journaled before execution with old/new inode identities; all units are exchanged before restarting PM2.

This release changes no dependency inputs. The installer verifies identical lock/workspace files, production dependency configuration and install hooks, and leaves the healthy installed dependencies untouched. Each patch included in the release must already exist in production as an identical regular file; missing, changed, symlinked or irregular expected patch paths stop the release before code changes. Additional historical production-only patches are left untouched. The `patches` directory is neither exchanged nor removed during installation or recovery. A future dependency change requires a separately reviewed staged dependency/rollback procedure; it must not silently bypass this check or install into the live `node_modules`.

The artifact includes `cargo/release.json` with the exact revision and SHA-256 hashes of the Cargo index, viewer assets and every solver module, including worker/client/export modules. Acceptance checks local application `/healthz`, both public HTTPS domains (allowing canonical redirects only between those domains), the actual `/cargo/` entry, the manifest, and every listed runtime asset. Only after all downloaded assets match the GitHub artifact does it execute the downloaded modules in an isolated runner temporary directory to verify the six-carton single-container zero-gap example, a plan above 600 cartons with matching scene data, and 11 cartons on one pallet at 1794 mm total height. These acceptance requests only read production; they do not create snapshots or business records.

Only after public acceptance succeeds does a final local hash/health check atomically replace `.deploy-sha`. Installation errors automatically reverse completed exchanges. The workflow also invokes that recovery path if public acceptance or finalization fails. Recovery identifies each completed swap from its inode journal, reverses it in order, verifies the old code hashes, restarts the same PM2 process, checks local health and restores the previous accepted marker. The failed deployment remains failed even if recovery succeeds. Recovery errors retain evidence and require investigation; no new accepted SHA is recorded. Planned rollback after a successful release still uses a reviewed revert PR against current main and this same workflow.

After an accepted release, the workflow removes that run's exact uploaded package, checksum and archive-inspection sidecars. It then retains the three most recent accepted release transactions: the active version and two verified rollback versions. Older accepted backup directories and their matching staged-release directories are removed only after the current `.deploy-sha` and current `accepted` marker agree. Directory names must match the fixed `<40-character-sha>-<run-id>-<attempt>` format, and symlinked or irregular paths stop cleanup rather than broadening its scope. Failed, interrupted or unaccepted run directories remain available for diagnosis and are not counted as accepted versions. Cleanup is best-effort after finalization, so a cleanup error does not roll back an already accepted healthy release; the following inventory step exposes the retained counts and sizes. Do not apply the unrelated database backup's 14-day SQL retention to these artifacts.

## Manual Restart

Manual commands are for emergency recovery or bootstrap only. Run them from the project directory:

```bash
cd /www/wwwroot/openit.cc
pnpm install
pnpm build
/www/server/nodejs/v24.18.0/bin/pm2 restart openit --update-env
/www/server/nodejs/v24.18.0/bin/pm2 save
curl -fsS https://www.openit.cc/healthz
```

The health check should return:

```json
{"ok":true,"service":"openit"}
```

## Ops Scripts

The scripts in `scripts/ops/` use the `openit` name and the `/www/wwwroot/openit.cc` path by default:

- `install-openit-ops.sh`
- `openit-healthcheck.sh`
- `openit-backup-db.sh`
- `openit-disk-monitor.sh`
- `openit-logrotate.conf`
