#!/usr/bin/env bash

set -euo pipefail

usage() {
  cat <<'EOF'
Usage: scripts/sync-windows.sh [--watch] [destination]

Mirror the WSL source tree into a native Windows NTFS directory.

Arguments:
  destination  WSL path to the mirror (default: /mnt/c/src/coax-win)
  --watch      Keep watching the WSL source and resync after changes
  --help       Show this help
EOF
}

watch=false
destination=/mnt/c/src/coax-win

for argument in "$@"; do
  case "$argument" in
    --watch)
      watch=true
      ;;
    --help|-h)
      usage
      exit 0
      ;;
    --*)
      echo "Unknown option: $argument" >&2
      usage >&2
      exit 2
      ;;
    *)
      destination=$argument
      ;;
  esac
done

for command in realpath rsync wslpath; do
  if ! command -v "$command" >/dev/null 2>&1; then
    echo "Required command is missing: $command (run this inside 'nix develop')." >&2
    exit 1
  fi
done

script_directory=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
source_root=$(realpath "$script_directory/..")
destination=$(realpath -m "$destination")

if [[ ! "$destination" =~ ^/mnt/[[:alpha:]]/.+ ]]; then
  echo "Refusing destination outside a mounted Windows drive: $destination" >&2
  exit 1
fi

if [[ "$destination" == "$source_root" ]]; then
  echo "Source and destination must be different directories." >&2
  exit 1
fi

marker="$destination/.coax-windows-mirror"

if [[ -d "$destination" && ! -f "$marker" ]]; then
  if find "$destination" -mindepth 1 -maxdepth 1 -print -quit | grep -q .; then
    echo "Refusing non-empty directory not created by this script: $destination" >&2
    exit 1
  fi
fi

mkdir -p "$destination"
printf '%s\n' 'Managed by scripts/sync-windows.sh' >"$marker"

sync_once() {
  rsync \
    --archive \
    --delete \
    --itemize-changes \
    --exclude='/.coax-windows-mirror' \
    --exclude='/.git/' \
    --exclude='/.cache/' \
    --exclude='/.direnv/' \
    --exclude='/node_modules/' \
    --exclude='/out/' \
    --exclude='/dist/' \
    --exclude='/release/' \
    --exclude='/coverage/' \
    --exclude='/artifacts/' \
    --exclude='/logs/' \
    --exclude='*.log' \
    --exclude='*.tsbuildinfo' \
    --exclude='/.env' \
    --exclude='/.env.*' \
    --exclude='*.local' \
    --exclude='/credentials/' \
    --exclude='/secrets/' \
    --exclude='/config/local/' \
    --exclude='/runtime/mpv/bin/' \
    --exclude='/runtime/mpv/downloads/' \
    --exclude='/runtime/mpv/**/*.7z' \
    --exclude='/runtime/mpv/**/*.dll' \
    --exclude='/runtime/mpv/**/*.exe' \
    --exclude='/runtime/mpv/**/*.zip' \
    "$source_root/" \
    "$destination/"

  echo "Windows mirror updated: $(wslpath -w "$destination")"
}

sync_once

if [[ "$watch" == true ]]; then
  if ! command -v watchexec >/dev/null 2>&1; then
    echo "Required command is missing for --watch: watchexec (run this inside 'nix develop')." >&2
    exit 1
  fi

  echo 'Watching WSL source for changes; press Ctrl+C to stop.'
  exec watchexec \
    --watch "$source_root" \
    --debounce 200ms \
    --ignore '.cache/**' \
    --ignore '.git/**' \
    --ignore 'artifacts/**' \
    --ignore 'coverage/**' \
    --ignore 'node_modules/**' \
    --ignore 'out/**' \
    -- \
    bash "$script_directory/sync-windows.sh" "$destination"
fi
