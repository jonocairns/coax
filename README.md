# Coax

Coax is a Windows-first live-TV player focused on playback resilience. This repository currently contains **M0b Slice 8: clean-stream harness and diagnostics baseline** on top of the secure Electron/React foundation, pinned Windows x64 mpv child, selected Path A overlay, safeStorage-backed Xtream path, D3D11VA/viewport-aware scaling baseline, and sports-motion graph. A Nix-hosted generated proxy exposes stable continuous TS, HLS, and standard AES-128 HLS paths to native Windows; results use a versioned schema with no fault schedule yet. Playback logs now have bounded rotation/retention, explicit baseline-stage timestamps, and structural redaction coverage. Automated native playback/timing, AES confidentiality, reconnect-option consumption, and the actual named-pipe DACL were observed; human visible-video/audible-audio confirmation remains open. Slice 7 visual and 30-minute rows, NVDEC under D3D11, actual VSR confirmation, inherited controller and multi-monitor/DPI rows, and Slice 5 native invalid-auth also remain open. EPG/SQLite, the M1 recovery supervisor/fault schedules, and production credential UX have not begun.

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

## Private Slice 5 Xtream input

No production login form exists in Slice 5. On the protected native NTFS mirror, copy the tracked template to the ignored local path and edit it locally:

```powershell
Copy-Item .\config\local\xtream.example.json .\config\local\xtream.json
notepad .\config\local\xtream.json
```

Set the provider base URL, username, password, and only the TS/HLS formats and HTTP settings the provider requires. `providerRequest` applies only to account/category/stream API calls; `playbackRequest` applies only to the selected mpv file. Remove unused User-Agent, Referer, header, and cookie fields rather than populating placeholders. Never paste the values into chat, shell arguments, evidence, or tracked files, and do not reinterpret `playback.json` as Xtream input.

On the first normal native launch, Electron main validates the ignored input, encrypts it with `safeStorage`/Windows DPAPI, and atomically stores only the encrypted value in Electron's user-data directory. Later launches prefer that encrypted value and do not re-import a changed plaintext file. After confirming a successful import, the ignored plaintext file may be removed. An unavailable `safeStorage` backend is a configuration failure; Coax does not fall back to plaintext persistence.

The provider utility process makes only account validation, `get_live_categories`, and `get_live_streams` requests. It returns normalized records to main, not provider payloads. The renderer receives category/channel names, stable internal IDs, transport labels, counts, and sanitized status only. Selecting a channel sends one internal ID to main; the authenticated stream URL and per-file HTTP options are resolved in the trusted utility/main boundary and sent to the already-running mpv process through its private JSON IPC pipe.

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

## Native Slice 5 acceptance

At the start of a Slice 5 run, the harness records only whether an ignored Xtream input and provider-exposed TS/HLS variants are available. It never records their values. From native Windows PowerShell in `C:\src\coax-win`, run:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\windows-slice5-acceptance.ps1 -SkipInstall
```

With no Xtream input, the harness writes an ignored `unobserved` result and leaves provider/TS/HLS rows open. With suitable input, it waits for sanitized normalized/skipped counts, guides visible-video/audible-audio checks for each available transport, measures channel-intent-to-`playback-restart`, runs 30 asynchronous channel-ID requests, requires the newest generation to become current, scans actual mpv arguments and persisted structured logs for private values, and requires clean application shutdown. Raw output remains under ignored `artifacts/m0/<run-id>/`; only reviewed sanitized summaries belong in `docs/evidence/m0/`.

## Native Slice 6 acceptance

Create the controlled fixtures directly under the protected native mirror's ignored artifact tree from WSL/Nix:

```bash
nix develop -c bash -lc './scripts/create-slice6-fixtures.sh'
```

At the start of a result series, record the Windows build, NVIDIA GPU and driver, display model, 4K resolution/refresh mode, audio output, Electron/mpv/FFmpeg revisions, and source dirty state. A configuration change starts a new series. Run the modes from native Windows PowerShell, substituting the actual non-unique configuration values:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\windows-slice6-acceptance.ps1 `
  -SkipInstall -Mode Compare -DisplayModel '<display model>' -AudioOutput '<audio output>' `
  -SourceRevision '<git revision>' -SourceDirty $true

powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\windows-slice6-acceptance.ps1 `
  -SkipInstall -Mode Resolution -DisplayModel '<display model>' -AudioOutput '<audio output>' `
  -SourceRevision '<git revision>' -SourceDirty $true

powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\windows-slice6-acceptance.ps1 `
  -SkipInstall -Mode Fallback -DisplayModel '<display model>' -AudioOutput '<audio output>' `
  -SourceRevision '<git revision>' -SourceDirty $true

powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\windows-slice6-acceptance.ps1 `
  -SkipInstall -Mode Soak -SoakProfile d3d11va -DisplayModel '<display model>' `
  -AudioOutput '<audio output>' -SourceRevision '<git revision>' -SourceDirty $true
```

The harness builds once, launches the built pinned Electron application without a development server, records sanitized GPU/adapter/profile/decoder/render/size/scaler states, samples mpv resources and dropped-frame properties, and cleans up the owned process tree. `Compare` uses the same clean local 720p50 fixture for D3D11VA, NVDEC, and software. `Soak` includes a 30-second warm-up followed by the required ten-minute measurement. `Resolution` changes both source and viewport sizes. `Fallback` uses a locally generated H.264 format unsupported by the hardware decoder and requires continuing software playback. Raw fixture media, logs, adapter output, and result JSON remain only under ignored native `artifacts/m0/`; do not copy them back to WSL or commit them.

Diagnostics deliberately separate `vsrRequested`, `vsrFilterAttached`, and `vsrConfirmed`. Successful D3D11VPP attachment or NVIDIA presence is not confirmation that RTX VSR processed the video. Unless a reliable external confirmation signal is observed, `vsrConfirmed` remains false and `vsrConfirmationSignal` remains `unavailable`.

## Native Slice 7 acceptance

Generate and verify the controlled sports fixtures directly in the ignored artifact tree of the protected native mirror:

```bash
nix develop -c bash -lc './scripts/create-slice7-fixtures.sh'
```

At the start of native work, record the exact benchmark configuration and available inputs before running the acceptance modes. A changed Windows/GPU driver/display/audio/Electron/mpv/FFmpeg/source configuration starts a new result series. From native Windows PowerShell:

```powershell
$common = @{
  SkipInstall = $true
  DisplayModel = '<display model>'
  AudioOutput = '<audio output>'
  SourceRevision = '<git revision>'
  SourceDirty = $true
}

& .\scripts\windows-slice7-acceptance.ps1 @common -Mode Record
& .\scripts\windows-slice7-acceptance.ps1 @common -Mode Progressive
& .\scripts\windows-slice7-acceptance.ps1 @common -Mode Interlaced
& .\scripts\windows-slice7-acceptance.ps1 @common -Mode WrongFieldOrder
& .\scripts\windows-slice7-acceptance.ps1 @common -Mode Fallback
& .\scripts\windows-slice7-acceptance.ps1 @common -Mode Soak
```

The harness uses local 720p50/59.94, 576i50, 1080i50, TFF/BFF, deliberately wrong-metadata, and long-run fixtures. It records actual decode/render/deinterlace state, field metadata and override, atomic graph reconfiguration, duplicate owned filters, output cadence, dropped/delayed/repeated frames, A/V drift, recovery, resources, and clean shutdown. `-SkipVisualChecks` is useful for automated diagnostics, but it explicitly leaves smooth motion, combing, judder, wrong-order diagnosis, and recovered field order unobserved; filter attachment or a 50 fps property is not a visual pass. Raw media, console output, logs, resource samples, and result JSON remain only under ignored native `artifacts/m0/<run-id>/` paths.

## Native Slice 8 acceptance

Start the clean generator/proxy from Nix, writing its generated media, AES key, and raw proxy output directly into the ignored native artifact tree:

```bash
nix develop -c bash -lc './scripts/start-slice8-harness.sh \
  --artifact-dir /mnt/c/src/coax-win/artifacts/m0/slice8-proxy \
  --bind 0.0.0.0 --port 48180'
```

The observed Windows 11/WSL configuration reached this service through `127.0.0.1`. If loopback forwarding is unavailable on a later machine, pass an RFC1918 WSL address as `-ProxyHost`; the player rejects public, authenticated, queried, or non-contract harness URLs. Keep the proxy running, then use native Windows PowerShell in `C:\src\coax-win`:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\windows-slice8-acceptance.ps1 `
  -SkipInstall -ProxyHost 127.0.0.1 -ProxyPort 48180 `
  -DisplayModel '<display model>' -AudioOutput '<audio output>' `
  -SourceRevision '<git revision>' -SourceDirty $true
```

The stable player paths are `/v1/stream/ts`, `/v1/stream/hls/index.m3u8`, and `/v1/stream/hls-aes/index.m3u8`. [`harness/slice8/fixtures.json`](harness/slice8/fixtures.json) and [`harness/slice8/result.schema.json`](harness/slice8/result.schema.json) version the clean contract; `faultSchedule` is deliberately `null` so M1 can add schedules without changing the player-facing paths or result shape. The app records start, request, first-frame, confirmed-playback, shutdown-start, and shutdown-complete stages. App logs retain at most four 2 MiB JSONL files per run; proxy logs retain at most four 1 MiB files. Both sanitize before persistence.

The harness probes the pinned binary rather than enabling reconnect settings in the player. It reports the compiled networking backend, verifies rejected-option observability with a sentinel, and lists only AVOptions actually consumed through top-level `stream-lavf-o` and nested-HLS `demuxer-lavf-o`. This is syntax/backend evidence, not a recovery-behavior claim. It also inspects the actual live mpv IPC pipe DACL in memory and retains only identity classes, never the pipe name or user SID. Use `-SkipVisualChecks` only for automated diagnostics; it leaves visible-video and audible-audio confirmation explicitly open.

## Process boundary

Electron main owns the shell, an opaque non-focusable native video host parented to that shell, a transparent owned overlay window, HWND conversion, mpv lifecycle, safeStorage credential service, structured playback log, and typed renderer IPC handlers. A dedicated Electron utility process owns Xtream network calls, normalization, and authenticated URL resolution for this slice; it receives scoped plaintext only for a request and never sends full provider payloads to main. mpv receives the video-host HWND and private pipe in process arguments but receives playback inputs and scoped HTTP options only through post-connect per-file `loadfile` IPC. Windows child-window parenting supplies clipping; Electron main aligns both native layers and records settled geometry after move, resize, restore, maximise, fullscreen, display-metric, and display-resume events. The overlay is non-resizable, frameless, transparent, absent from the taskbar, and OS-level pointer-click-through outside its intentional control panel. A fixed native helper keeps mpv's child above Electron's own Direct3D child inside the video host without receiving playback input or IPC details. One IPC-heartbeat failure or unexpected process exit can start one controlled replacement attempt for the current generation. Electron GPU-process loss is logged and causes bounded renderer reloads plus geometry and stacking resynchronization.

Both renderers remain sandboxed, context-isolated, Node-disabled, and local-code-only. The preload exposes runtime versions, fixed M0a development controls, fullscreen and overlay intents, sanitized provider view state, internal-channel-ID playback, and a fixed 30-change channel-ID acceptance action. No renderer receives raw `ipcRenderer`, arbitrary mpv commands, pipe names, HWNDs, credentials, authenticated URLs, HTTP options, provider payloads, or playlist data. Unit tests lock both BrowserWindow security configurations and cover the established M0a regressions plus one-time encryption, scoped input validation, minimum-call/authentication behavior, normalization/skipping, stable IDs, TS/HLS resolution, per-file mpv options, renderer isolation, asynchronous newest-request-wins behavior, and structural redaction.
