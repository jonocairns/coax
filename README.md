# Coax

Coax is a Windows-first live-TV player focused on playback resilience. This repository currently contains **M0a Slice 4: the overlay decision gate**: the secure Electron/React foundation, a pinned Windows x64 mpv child embedded into the Electron window and controlled through JSON IPC, and the Path A interactive Electron playback overlay. Path A passed every row available on the current native hardware, but M0a remains incomplete until controller and multi-monitor/DPI coverage are observed. There is no provider integration, GPU tuning, full recovery supervisor, or credential UI yet.

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

## Private M0a playback input

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

Configure one privately configured HTTP(S) playlist URL containing the test channels. Do not paste the real URL into chat, a shell command, an issue, evidence, or any tracked file. `config/local/playback.json` is ignored and read only by Electron main. The renderer receives only fixed development playback and window intents; it never receives the URL or playlist contents. Electron spawns mpv without the URL and sends the playlist only in a `loadfile` JSON IPC command after connecting to a random per-process named pipe.

The fixed Previous and Next development intents issue `playlist-prev` and `playlist-next` commands against mpv's internal playlist. They are available from the native Playback menu and the narrow renderer API, and work only when the configured URL resolves to a playlist mpv recognizes with multiple entries; a direct single-channel media URL has no other entry to select. This is a development-only comparison control, not provider parsing or the M1 rapid-zap supervisor. Slice 3 tags every fixed playlist step with a monotonic generation, ignores stale command results, and asserts the newest successful request against mpv's numeric `playlist-pos` without exposing playlist contents. The fixed 30-change acceptance action alternates Next/Previous and is available from the native menu, renderer intent, or F9. F11 toggles fullscreen for lifecycle testing.

## Native Slice 2 acceptance

After the normal clean checks and runtime fetch, run the interactive native acceptance harness from Windows PowerShell:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\windows-slice2-acceptance.ps1 -SkipInstall
```

The harness waits for `start-file`, `file-loaded`, `playback-restart`, `video-reconfig`, and `audio-reconfig`, allows playlist channels to be compared, asks for visual video/audible audio confirmation, and then asks you to close the Electron window. Shutdown sends `stop` and `quit`, allowing `end-file` and process exit to be captured before bounded forced-termination fallback. The harness verifies that the bundled executable ran, the private URL/credential components were absent from process arguments and the sanitized persisted JSONL log, and neither the owned process nor named pipe remains.

Raw results stay under ignored `artifacts/m0/<run-id>/`. Review and sanitize a small summary into `docs/evidence/m0/`; never copy raw provider output or copyrighted frames there.

## Native Slice 3 acceptance

After normal clean checks and runtime reverification, run the interactive Slice 3 harness from the protected native NTFS mirror:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\windows-slice3-acceptance.ps1 -SkipInstall
```

The harness independently matches mpv's decimal `--wid` value to the live Electron top-level HWND, checks that the verified bundled executable and a fresh unpredictable pipe are used, and guides the exact interaction matrix from `docs/M0_IMPLEMENTATION.md`: move/resize, ten fullscreen cycles, five available-monitor/DPI round trips, ten Alt+Tab cycles, ten minimise/restore cycles, display sleep/resume, and thirty rapid alternating playlist changes. It then kills the owned mpv process, requires a controlled replacement attempt to begin within one second, and verifies bounded shutdown leaves none of the owned processes or pipes reachable.

The automatic checks do not replace visual observation. Type `YES` only after completing and observing each requested matrix row. A pass must not be claimed from WSL checks or unconfirmed prompts. Raw results remain only under the ignored native `artifacts/m0/<run-id>/` tree.

## Native Slice 4 acceptance

At the start of a Slice 4 run, record the exact available controller model and connection mode. When no controller is present, keep the controller row open and run the independent keyboard path; do not substitute an invented controller result.

After normal clean checks, runtime reverification, and WSL-to-NTFS synchronization, run the interactive Path A harness from the protected native mirror:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\windows-slice4-acceptance.ps1 -SkipInstall
```

When a controller is available, pass its exact identity explicitly, for example:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\windows-slice4-acceptance.ps1 -SkipInstall -ControllerModel '<exact model>' -ControllerConnectionMode Bluetooth
```

The harness exercises the quantified Slice 3 matrix with the overlay, ten show/hide and focus-transfer cycles, intentional pointer click-through, independent keyboard navigation, optional recorded-controller navigation, fixed now/next plus immediate zap/recovery feedback, generation-safe rapid changes, controlled mpv replacement, privacy checks, and clean process/pipe shutdown. It records unavailable controller and monitor/DPI hardware as explicit open criteria rather than a pass. Type `YES` only after completing and observing every available requested row. Raw results remain only under ignored `artifacts/m0/<run-id>/`.

## Process boundary

Electron main owns the shell, an opaque non-focusable native video host parented to that shell, a transparent owned overlay window, HWND conversion, mpv lifecycle, private playback input, structured playback log, and typed renderer IPC handlers. mpv receives the video-host HWND and private pipe in process arguments but receives the playlist only through post-connect `loadfile` IPC. Windows child-window parenting supplies clipping; Electron main aligns both native layers and records settled geometry after move, resize, restore, maximise, fullscreen, display-metric, and display-resume events. The overlay is non-resizable, frameless, transparent, absent from the taskbar, and OS-level pointer-click-through outside its intentional control panel. A fixed native helper keeps mpv's child above Electron's own Direct3D child inside the video host without receiving playback input or IPC details. One IPC-heartbeat failure or unexpected process exit can start one controlled replacement attempt for the current generation. Electron GPU-process loss is logged and causes bounded renderer reloads plus geometry and stacking resynchronization.

Both renderers remain sandboxed, context-isolated, Node-disabled, and local-code-only. The preload exposes only runtime versions, fixed Previous/Next and 30-change development intents, fullscreen toggle, fixed overlay show/hide/toggle and pointer-region intents, and sanitized placeholder/feedback state. No renderer receives raw `ipcRenderer`, arbitrary mpv commands, pipe names, HWNDs, URLs, or playlist data. Unit tests lock both BrowserWindow security configurations and cover the manifest, handle conversion, generation decisions, overlay state, standard D-pad/accept/back mapping, geometry/lifecycle decisions, fixed commands, JSON-line parsing, input validation, playlist navigation, and redaction logic.
