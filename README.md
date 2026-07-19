# Coax

Coax is a Windows-first live-TV player focused on playback resilience. This repository currently contains **M0a Slice 2: first native frame**: the secure Electron/React foundation plus a pinned Windows x64 mpv child controlled through JSON IPC. mpv remains a separate window. There is no embedding, overlay, provider integration, GPU tuning, recovery supervisor, or credential UI yet.

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

## Pinned Windows mpv runtime

[`runtime/mpv/windows-x64.json`](runtime/mpv/windows-x64.json) pins the baseline x64 standalone artifact from shinchiro/mpv-winbuild-cmake's `20260610` release. mpv's installation page recognizes shinchiro as an unofficial third-party Windows builder; this is not an official mpv binary distribution.

The selected archive is `mpv-x86_64-20260610-git-304426c.7z`, SHA-256 `facac536baa73c7b925771af5e39a3c9cb16b8d75b59a6e9800de89799dffca7`. It contains mpv commit `304426c390901436fb1d4a63efbd582ae80c88f4` and FFmpeg commit `2576e09434d8026aab1769481b7b2fb43aa567c3`. The manifest also records the exact build-project commit, successful workflow, source repositories, baseline x86-64 architecture, Clang/MinGW cross-toolchain, LTO flags, and known mpv/FFmpeg configuration. The x86-64-v3, dev, FFmpeg-only, and mutable latest artifacts are deliberately not selected.

On native Windows, fetch and verify it with:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\fetch-mpv-runtime.ps1
```

The script downloads only the manifest URL, verifies SHA-256 and size before extraction, then records hashes tying the extracted `mpv.exe` and manifest to that verified archive. Electron recomputes those hashes before every spawn. The ignored archive and runtime tree live under `runtime/mpv/downloads/` and `runtime/mpv/bin/`; never commit either. Dependency and redistribution-license review remains required before publication.

## Private Slice 2 playback input

Copy the safe template to the exact ignored path below on the native NTFS mirror, then edit that local file only:

```powershell
Copy-Item .\config\local\playback.example.json .\config\local\playback.json
notepad .\config\local\playback.json
```

The schema is:

```json
{
  "streamUrl": "https://private.example/live/playlist"
}
```

Configure one privately configured HTTP(S) playlist URL containing the test channels. Do not paste the real URL into chat, a shell command, an issue, evidence, or any tracked file. `config/local/playback.json` is ignored and read only by Electron main. The renderer receives only Previous/Next intent; it never receives the URL or playlist contents. Electron spawns mpv without the URL and sends the playlist only in a `loadfile` JSON IPC command after connecting to a random per-process named pipe.

The Previous and Next buttons in the Coax window issue fixed `playlist-prev` and `playlist-next` commands against mpv's internal playlist. They work only when the configured URL resolves to a playlist mpv recognizes with multiple entries; a direct single-channel media URL has no other entry to select. This is a development-only comparison control, not provider parsing or rapid-zap supervision. Sanitized events include the generation and fixed `paused-for-cache` property so brief play/freeze cycles can be distinguished from process or IPC failure.

## Native Slice 2 acceptance

After the normal clean checks and runtime fetch, run the interactive native acceptance harness from Windows PowerShell:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\windows-slice2-acceptance.ps1 -SkipInstall
```

The harness waits for `start-file`, `file-loaded`, `playback-restart`, `video-reconfig`, and `audio-reconfig`, allows playlist channels to be compared, asks for visual video/audible audio confirmation, and then asks you to close the Electron window. Shutdown sends `stop` and `quit`, allowing `end-file` and process exit to be captured before bounded forced-termination fallback. The harness verifies that the bundled executable ran, the private URL/credential components were absent from process arguments and the sanitized persisted JSONL log, and neither the owned process nor named pipe remains.

Raw results stay under ignored `artifacts/m0/<run-id>/`. Review and sanitize a small summary into `docs/evidence/m0/`; never copy raw provider output or copyrighted frames there.

## Process boundary

Electron main owns the window, mpv lifecycle, private playback input, structured playback log, and typed renderer IPC handlers. The sandboxed, context-isolated preload exposes only `getRuntimeVersions()` and the narrow `cycleTestChannel()` intent; the renderer has no Node integration and never receives raw `ipcRenderer`, arbitrary mpv commands, pipe names, or stream data. Unit tests lock the BrowserWindow security preferences and the manifest, command, JSON-line, input, playlist-navigation, and redaction logic.
