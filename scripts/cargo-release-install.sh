#!/usr/bin/env bash
# Invoked only by the approved GitHub workflow over SSH stdin; not a daemon or controller.
# Each fixed code unit is exchanged atomically on the same filesystem. The units
# form a journaled transaction; this does not promise one whole-site atomic switch.
set -Eeuo pipefail
umask 077

ACTION="${1:?action required}"
RELEASE_SHA="${2:?release SHA required}"
RUN_KEY="${3:?GitHub run ID and attempt required}"
[[ "$RELEASE_SHA" =~ ^[0-9a-f]{40}$ && "$RUN_KEY" =~ ^[0-9]+-[0-9]+$ ]] || exit 2
case "$ACTION" in apply|rollback|finalize|inventory) ;; *) exit 2 ;; esac

WEB_ROOT="/www/wwwroot/openit.cc"
NODE_DIR="/www/server/nodejs/v24.18.0/bin"
RELEASE_BASE="/www/deploy/openit/releases"
BACKUP_BASE="/www/backup/openit/releases"
RELEASE_DIR="$RELEASE_BASE/$RELEASE_SHA-$RUN_KEY"
BACKUP_DIR="$BACKUP_BASE/$RELEASE_SHA-$RUN_KEY"
PACKAGE="/tmp/openit-$RELEASE_SHA-$RUN_KEY.tar.gz"
CHECKSUM="$PACKAGE.sha256"
PM2="$NODE_DIR/pm2"
export PATH="$NODE_DIR:$PATH"
MANAGED=(dist scripts cargo package.json pnpm-lock.yaml pnpm-workspace.yaml ecosystem.config.cjs README.md LICENSE DEPLOYMENT.md)
[[ -d "$WEB_ROOT" && "$(realpath "$WEB_ROOT")" == "$WEB_ROOT" ]] || { echo 'Unexpected production root' >&2; exit 2; }

validate_archive() {
  local archive="$1" name top
  tar -tzf "$archive" > "$archive.entries" || return
  tar -tvzf "$archive" > "$archive.types" || return
  # Reject symlinks, hard links and special files before extraction.
  if grep -q '^[^d-]' "$archive.types"; then echo 'Nonregular archive member' >&2; return 1; fi
  while IFS= read -r name; do
    name="${name#./}"
    [[ -z "$name" ]] && continue
    [[ "$name" != /* && "$name" != *../* && "$name" != '..' ]] || return 1
    top="${name%%/*}"
    case "$top" in dist|scripts|cargo|patches|package.json|pnpm-lock.yaml|pnpm-workspace.yaml|ecosystem.config.cjs|README.md|LICENSE|DEPLOYMENT.md) ;; *) echo "Unapproved archive member: $top" >&2; return 1 ;; esac
  done < "$archive.entries"
}

check_health() {
  local attempt body
  for attempt in {1..20}; do
    if body="$(curl --connect-timeout 3 --max-time 5 -fsS http://127.0.0.1:3000/healthz)" &&
      printf '%s' "$body" | "$NODE_DIR/node" -e 'let s="";process.stdin.on("data",b=>s+=b);process.stdin.on("end",()=>{const j=JSON.parse(s);if(j.ok!==true||j.service!=="openit")process.exit(1)})'; then return 0; fi
    sleep 2
  done
  echo 'Local application health did not recover' >&2
  return 1
}

verify_backup() {
  (cd "$BACKUP_DIR" && sha256sum -c backup.tar.gz.sha256) || return
  validate_archive "$BACKUP_DIR/backup.tar.gz"
}

atomic_exchange() {
  python3 - "$1" "$2" <<'PYTHON'
import ctypes, os, sys
library = ctypes.CDLL(None, use_errno=True)
exchange = library.renameat2
exchange.argtypes = [ctypes.c_int, ctypes.c_char_p, ctypes.c_int, ctypes.c_char_p, ctypes.c_uint]
exchange.restype = ctypes.c_int
if exchange(-100, os.fsencode(sys.argv[1]), -100, os.fsencode(sys.argv[2]), 2) != 0:
    error = ctypes.get_errno()
    raise OSError(error, os.strerror(error))
PYTHON
}

inode() { stat -c '%d:%i' -- "$1"; }

check_exchange_support() {
  command -v python3 >/dev/null || { echo 'Python3 is required for the standard-library atomic exchange probe.' >&2; return 1; }
  [[ "$(stat -c %d "$WEB_ROOT")" == "$(stat -c %d "$RELEASE_DIR")" ]] || { echo 'Production and release stage are on different filesystems; no code was changed.' >&2; return 1; }
  local first="$RELEASE_DIR/.exchange-probe-a" second="$RELEASE_DIR/.exchange-probe-b"
  mkdir "$first" "$second"
  printf a > "$first/value"; printf b > "$second/value"
  atomic_exchange "$first" "$second"
  [[ "$(cat "$first/value")" == b && "$(cat "$second/value")" == a ]]
  atomic_exchange "$first" "$second"
  echo 'Same-filesystem atomic directory exchange probe passed.'
}

check_expected_patches() {
  local expected="$RELEASE_DIR/patches" live="$WEB_ROOT/patches" item relative
  [[ -e "$expected" || -L "$expected" ]] || return 0
  [[ -d "$expected" && ! -L "$expected" && -d "$live" && ! -L "$live" ]] || { echo 'Expected patches directory is missing or irregular.' >&2; return 1; }
  find "$expected" -mindepth 1 -print0 > "$BACKUP_DIR/expected-patches.list" || return
  while IFS= read -r -d '' item; do
    relative="${item#"$expected/"}"
    [[ ! -L "$item" && ! -L "$live/$relative" ]] || { echo "Expected patch path is a symlink: $relative" >&2; return 1; }
    if [[ -d "$item" ]]; then
      [[ -d "$live/$relative" ]] || { echo "Expected patch directory missing: $relative" >&2; return 1; }
    else
      [[ -f "$item" && -f "$live/$relative" ]] || { echo "Expected patch is missing or irregular: $relative" >&2; return 1; }
      cmp -s -- "$item" "$live/$relative" || { echo "Expected patch differs: $relative" >&2; return 1; }
    fi
  done < "$BACKUP_DIR/expected-patches.list"
  # Historical live-only patches are preserved, not installed, swapped or removed.
}

rollback() {
  [[ -f "$BACKUP_DIR/install-started" ]] || { echo 'No production exchange started; nothing to restore.'; return 0; }
  if [[ -f "$BACKUP_DIR/restored" ]]; then check_health || return; echo 'This run was already restored.'; return 0; fi
  verify_backup || return
  local current='' previous='' entry operation old_inode new_inode live_inode staged_inode
  if [[ -f "$WEB_ROOT/.deploy-sha" ]]; then current="$(cat "$WEB_ROOT/.deploy-sha")" || return; fi
  if [[ -f "$BACKUP_DIR/previous-sha" ]]; then previous="$(cat "$BACKUP_DIR/previous-sha")" || return; fi
  [[ "$current" == "$previous" || "$current" == "$RELEASE_SHA" ]] || { echo 'Release marker changed outside this transaction; refusing restore.' >&2; return 1; }
  # The journal is durable before each exchange. Inodes distinguish an exchange
  # that completed from a process interrupted immediately before its syscall.
  tac "$BACKUP_DIR/exchanges.log" > "$BACKUP_DIR/rollback-order.log" || return
  while IFS='|' read -r entry operation old_inode new_inode; do
    case "$entry" in dist|scripts|cargo|package.json|pnpm-lock.yaml|pnpm-workspace.yaml|ecosystem.config.cjs|README.md|LICENSE|DEPLOYMENT.md) ;; *) return 1 ;; esac
    [[ ! -L "$WEB_ROOT/$entry" && ! -L "$RELEASE_DIR/$entry" ]] || return 1
    live_inode='-'; staged_inode='-'
    [[ ! -e "$WEB_ROOT/$entry" ]] || live_inode="$(inode "$WEB_ROOT/$entry")"
    [[ ! -e "$RELEASE_DIR/$entry" ]] || staged_inode="$(inode "$RELEASE_DIR/$entry")"
    if [[ "$live_inode" == "$old_inode" && "$staged_inode" == "$new_inode" ]]; then continue; fi
    if [[ "$operation" == exchange && "$live_inode" == "$new_inode" && "$staged_inode" == "$old_inode" ]]; then
      atomic_exchange "$WEB_ROOT/$entry" "$RELEASE_DIR/$entry" || return
    elif [[ "$operation" == add && "$live_inode" == "$new_inode" && "$staged_inode" == '-' ]]; then
      mv -T -- "$WEB_ROOT/$entry" "$RELEASE_DIR/$entry" || return
    else
      echo "Unexpected code-unit state during restore: $entry" >&2; return 1
    fi
  done < "$BACKUP_DIR/rollback-order.log"
  (cd "$WEB_ROOT" && sha256sum -c "$BACKUP_DIR/code.sha256" > "$BACKUP_DIR/restore-hashes.log") || return
  "$PM2" restart openit --update-env || return
  "$PM2" save || return
  check_health || return
  if [[ -f "$BACKUP_DIR/previous-sha" ]]; then
    cp "$BACKUP_DIR/previous-sha" "$WEB_ROOT/.deploy-sha.restore-$RUN_KEY" || return
    mv -- "$WEB_ROOT/.deploy-sha.restore-$RUN_KEY" "$WEB_ROOT/.deploy-sha" || return
  elif [[ -f "$WEB_ROOT/.deploy-sha" ]]; then
    mv -- "$WEB_ROOT/.deploy-sha" "$BACKUP_DIR/unaccepted-deploy-sha" || return
  fi
  date -u +%FT%TZ > "$BACKUP_DIR/restored" || return
  printf 'Restored previous code; unaccepted code and diagnostics retained in %s\n' "$RELEASE_DIR"
}

apply_finished() {
  local status=$?
  trap - EXIT HUP INT TERM
  if (( status != 0 )) && [[ -f "$BACKUP_DIR/install-started" && ! -f "$BACKUP_DIR/restored" ]]; then
    echo 'Installation failed; reversing journaled code exchanges.' >&2
    if ! rollback; then echo 'AUTOMATIC RESTORE FAILED; preserve this run and investigate before retrying.' >&2; fi
  fi
  exit "$status"
}

apply_release() {
  local actual expected checksum_file entry
  [[ ! -e "$RELEASE_DIR" && ! -e "$BACKUP_DIR" ]] || { echo 'Run directory already exists; use a new GitHub run attempt.' >&2; return 1; }
  read -r expected checksum_file < "$CHECKSUM"
  [[ "$expected" =~ ^[0-9a-f]{64}$ && "$checksum_file" == "$(basename "$PACKAGE")" ]] || return 1
  actual="$(sha256sum "$PACKAGE")"; [[ "${actual%% *}" == "$expected" ]] || return 1
  validate_archive "$PACKAGE"
  mkdir -p "$RELEASE_BASE" "$BACKUP_BASE"
  mkdir "$RELEASE_DIR" "$BACKUP_DIR"
  tar --no-same-owner --same-permissions -xzf "$PACKAGE" -C "$RELEASE_DIR"
  test -f "$RELEASE_DIR/dist/index.js"
  cp "$RELEASE_DIR/scripts/cargo-release-check.mjs" "$BACKUP_DIR/cargo-release-check.mjs"
  "$NODE_DIR/node" "$RELEASE_DIR/scripts/cargo-release-check.mjs" verify-local "$RELEASE_DIR" "$RELEASE_SHA" > "$BACKUP_DIR/release-hashes.json"
  # Current Cargo release changes no dependency inputs. Preserve healthy installed
  # dependencies so a code restore never needs a network install to work.
  test -d "$WEB_ROOT/node_modules"
  cmp "$WEB_ROOT/pnpm-lock.yaml" "$RELEASE_DIR/pnpm-lock.yaml"
  cmp "$WEB_ROOT/pnpm-workspace.yaml" "$RELEASE_DIR/pnpm-workspace.yaml"
  check_expected_patches
  "$NODE_DIR/node" --input-type=module - "$WEB_ROOT/package.json" "$RELEASE_DIR/package.json" <<'NODE'
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const [before, after] = process.argv.slice(2).map(file => JSON.parse(readFileSync(file, 'utf8')));
for (const field of ['dependencies', 'optionalDependencies', 'peerDependencies', 'pnpm', 'engines', 'packageManager']) assert.deepEqual(after[field], before[field], `Runtime dependency configuration changed: ${field}`);
for (const hook of ['preinstall', 'install', 'postinstall', 'prepare']) assert.equal(after.scripts?.[hook], before.scripts?.[hook], `Install hook changed: ${hook}`);
NODE
  local present=()
  for entry in "${MANAGED[@]}"; do
    [[ ! -L "$WEB_ROOT/$entry" ]] || { echo 'Refusing symlinked production code path' >&2; return 1; }
    if [[ -e "$WEB_ROOT/$entry" ]]; then present+=("$entry"); fi
    if [[ -e "$WEB_ROOT/$entry" && -e "$RELEASE_DIR/$entry" ]]; then
      [[ "$(stat -c %d "$WEB_ROOT/$entry")" == "$(stat -c %d "$RELEASE_DIR/$entry")" ]] || return 1
    fi
  done
  test -f "$WEB_ROOT/dist/index.js"
  if [[ -f "$WEB_ROOT/.deploy-sha" ]]; then
    [[ "$(cat "$WEB_ROOT/.deploy-sha")" =~ ^[0-9a-f]{40}$ ]] || return 1
    cp "$WEB_ROOT/.deploy-sha" "$BACKUP_DIR/previous-sha"
  fi
  (cd "$WEB_ROOT"; find "${present[@]}" -type f -print0 | sort -z | xargs -0 sha256sum) > "$BACKUP_DIR/code.sha256"
  tar -C "$WEB_ROOT" -czf "$BACKUP_DIR/backup.tar.gz" "${present[@]}"
  (cd "$BACKUP_DIR"; sha256sum backup.tar.gz > backup.tar.gz.sha256)
  verify_backup
  # Compare the archive to live code before the first production mutation.
  gzip -dc "$BACKUP_DIR/backup.tar.gz" | tar -C "$WEB_ROOT" -df -
  check_exchange_support
  check_health
  : > "$BACKUP_DIR/exchanges.log"
  date -u +%FT%TZ > "$BACKUP_DIR/install-started"
  for entry in "${MANAGED[@]}"; do
    if [[ ! -e "$RELEASE_DIR/$entry" ]]; then continue; fi
    if [[ -e "$WEB_ROOT/$entry" ]]; then
      printf '%s|exchange|%s|%s\n' "$entry" "$(inode "$WEB_ROOT/$entry")" "$(inode "$RELEASE_DIR/$entry")" >> "$BACKUP_DIR/exchanges.log"
      sync -f "$BACKUP_DIR/exchanges.log"
      atomic_exchange "$RELEASE_DIR/$entry" "$WEB_ROOT/$entry"
    else
      printf '%s|add|-|%s\n' "$entry" "$(inode "$RELEASE_DIR/$entry")" >> "$BACKUP_DIR/exchanges.log"
      sync -f "$BACKUP_DIR/exchanges.log"
      mv -T -- "$RELEASE_DIR/$entry" "$WEB_ROOT/$entry"
    fi
  done
  "$NODE_DIR/node" "$BACKUP_DIR/cargo-release-check.mjs" verify-local "$WEB_ROOT" "$RELEASE_SHA" > "$BACKUP_DIR/installed-hashes.json"
  "$PM2" restart openit --update-env
  "$PM2" save
  check_health
  echo 'All code units exchanged and locally healthy. Accepted release marker is not changed yet.'
}

case "$ACTION" in
  apply)
    trap apply_finished EXIT
    trap 'exit 130' INT
    trap 'exit 143' TERM HUP
    apply_release
    ;;
  rollback) rollback ;;
  finalize)
    test -f "$BACKUP_DIR/install-started"
    test ! -f "$BACKUP_DIR/restored"
    "$NODE_DIR/node" "$BACKUP_DIR/cargo-release-check.mjs" verify-local "$WEB_ROOT" "$RELEASE_SHA" > "$BACKUP_DIR/final-hashes.json"
    check_health
    printf '%s\n' "$RELEASE_SHA" > "$WEB_ROOT/.deploy-sha.pending-$RUN_KEY"
    mv -- "$WEB_ROOT/.deploy-sha.pending-$RUN_KEY" "$WEB_ROOT/.deploy-sha"
    test "$(cat "$WEB_ROOT/.deploy-sha")" = "$RELEASE_SHA"
    date -u +%FT%TZ > "$BACKUP_DIR/accepted"
    printf 'Accepted deployed SHA: %s\n' "$RELEASE_SHA"
    ;;
  inventory)
    for directory in "$RELEASE_BASE" "$BACKUP_BASE"; do
      if [[ -d "$directory" ]]; then
        du -sh "$directory"
        printf 'Top-level artifacts: '; find "$directory" -mindepth 1 -maxdepth 1 -printf '.' | wc -c
      fi
    done
    for artifact in "$PACKAGE" "$CHECKSUM"; do if [[ -f "$artifact" ]]; then du -h "$artifact"; fi; done
    echo 'No release-artifact retention policy is approved; inventory only, nothing deleted.'
    ;;
esac
