#!/usr/bin/env bash

set -euo pipefail

for command in ffmpeg node; do
  if ! command -v "$command" >/dev/null 2>&1; then
    echo "Required command is missing: $command (run inside 'nix develop')." >&2
    exit 1
  fi
done

script_directory=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
repository_root=$(cd -- "$script_directory/.." && pwd)
exec node "$repository_root/harness/slice8/server.mjs" "$@"
