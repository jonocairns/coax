# Coax

Coax is a Windows-first live-TV player focused on playback resilience. This repository currently contains only **M0a Slice 1: repository foundation**: a secure Electron/React shell, reproducible development tooling, and native Windows checks. It does not contain mpv playback, embedding, overlays, provider integration, or credentials.

## Versions

- Electron 43.1.1 (embedded Node 24.18.0)
- Node.js 24 in the Nix shell and native-development requirement
- pnpm 11.15.0 through Corepack
- React 19.2.7, electron-vite 5.0.0, TypeScript 6.0.3, Vite 7.3.6, and Vitest 4.1.10
- Node type definitions are held to major 24 so standalone checks cannot compile against a newer Node API than Electron ships
- ffmpeg and mpv from the pinned Nixpkgs revision in `flake.lock` (development use only)

## Linux/WSL development with Nix

Nix with flakes enabled is the only host prerequisite. From the repository root:

```bash
nix develop
corepack pnpm install --frozen-lockfile
pnpm typecheck
pnpm lint
pnpm test
pnpm build
pnpm format:check
pnpm dev
```

The same non-interactive verification can be run without entering a persistent shell:

```bash
nix flake check
nix develop -c bash -lc 'corepack pnpm install --frozen-lockfile && pnpm verify'
```

The Nix mpv is for Linux-side development and future harness work only. It is not the pinned Windows runtime and does not prove Windows playback.

## Native Windows clean-checkout workflow

Use a native Windows checkout on NTFS (for example `C:\src\coax`), not a checkout accessed through `\\wsl$`. Install Git and the current Node.js 24 release by their normal Windows installers, then open Windows PowerShell in the checkout. No global pnpm package is needed.

```powershell
git clone <repository-url> C:\src\coax
Set-Location C:\src\coax
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\windows-bootstrap-check.ps1
```

The checker reports Windows, PowerShell, Git, Node, Corepack, pnpm, and Electron versions. It performs a frozen local dependency install, runs type-check/lint/tests/build, starts the Electron executable, and opens a self-terminating development smoke window. It makes no global package or system changes. Use `-SkipInstall` only when `node_modules` is already current, or `-SkipLaunch` on a non-interactive Windows session.

The individual native commands are:

```powershell
corepack pnpm install --frozen-lockfile
corepack pnpm typecheck
corepack pnpm lint
corepack pnpm test
corepack pnpm build
corepack pnpm dev
```

Native Windows launch is an explicit Slice 1 acceptance check. Linux/WSL success is not a substitute, and project documentation must not claim the Windows check passed until the script has completed on native Windows 11.

### WSL-to-Windows development mirror

Do not symlink Windows tools into the WSL repository. Keep Windows dependencies and generated output in a native NTFS mirror. From `nix develop`, create or refresh the default `C:\src\coax-win` mirror with:

```bash
./scripts/sync-windows.sh
```

For continuous source synchronization while native Windows electron-vite provides HMR:

```bash
./scripts/sync-windows.sh --watch
```

In a separate native Windows PowerShell window, run:

```powershell
Set-Location C:\src\coax-win
corepack pnpm install --frozen-lockfile
corepack pnpm dev
```

The mirror is one-way: edit the WSL source, not `C:\src\coax-win`. The sync deletes stale mirrored source files, but only after the destination has been marked as a Coax-managed mirror. Windows `node_modules`, build output, credentials, raw evidence, and runtime downloads are excluded and protected from synchronization.

## M0 evidence handling

Raw native results, logs, and screenshots stay under the ignored path `artifacts/m0/<run-id>/`. When Windows uses a separate native clone, copy its result directory into the working repository without committing it:

```powershell
Copy-Item -Recurse C:\src\coax\artifacts\m0\<run-id> \\wsl$\<distro>\home\<user>\coax\artifacts\m0\
```

Remove provider names, credentials, authenticated URLs, headers, cookies, copyrighted frames, usernames, and machine-identifying paths before retaining a small summary under `docs/evidence/m0/`. Review `git diff --cached` before any future commit. Never move an unsanitized raw log out of `artifacts/m0/`.

## Windows mpv runtime placeholder

[`runtime/mpv/windows-x64.json`](runtime/mpv/windows-x64.json) is deliberately unselected and validated by [`runtime/mpv/windows-manifest.schema.json`](runtime/mpv/windows-manifest.schema.json). Selecting, fetching, and verifying an exact artifact belongs to Slice 2. There is no binary, download script, or unverified “latest” URL in Slice 1.

## Process boundary

Electron main owns the window and its single typed IPC handler. The sandboxed, context-isolated preload exposes only `getRuntimeVersions()`; the renderer has no Node integration and never receives raw `ipcRenderer`. The unit test locks the BrowserWindow security preferences.
