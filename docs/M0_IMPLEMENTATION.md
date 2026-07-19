# M0 Implementation Plan

**Purpose:** prove the risky native-video path and deliver the smallest usable Xtream-backed player before investing in the full engine or polished UI.

| | |
|---|---|
| Status | Draft |
| Parent | [PRD — Coax](../PRD.md) |
| Target | Windows 11 x64, NVIDIA GeForce RTX 5080, 720p sports into a 4K viewport/display |
| Gates | M0a after Slice 4; M0b after Slice 8 |

## 1. How M0 is sliced

Each slice ends in an observable, native-Windows result. A slice is complete only when its acceptance checks pass and its evidence is retained. Linux or Nix-based playback is useful for development, but it does not satisfy a Windows playback check.

Implementation should stay vertical: add only enough abstraction, UI and configuration to demonstrate the slice. Work that is not needed by the current slice or an already-proven boundary remains deferred.

### Evidence convention

Each native run records:

- Git revision and dirty-worktree state
- Windows build, GPU, NVIDIA driver, display resolution/refresh rate and audio device
- Electron, embedded Node, mpv and FFmpeg versions
- mpv adapter, decoder, output format and requested upscaler path
- Structured timestamps and the acceptance result

Raw run artefacts live under an ignored `artifacts/m0/<run-id>/` directory because logs and screenshots may contain provider information or copyrighted video. Small sanitized summaries and synthetic-fixture results may be committed. Credentials, authenticated URLs, headers and cookies must never appear in either form.

### Inputs that must be fixed during M0

These are scheduled decisions, not reasons to delay Slice 1:

| Input | Required by | Record |
|---|---|---|
| Native Windows workflow | End of Slice 1 | Whether Windows uses the same WSL-mounted checkout, a native Windows clone or another machine; exact bootstrap, build and evidence-transfer commands |
| Playback inputs | Start of Slice 2 | Two privately configured channels for alternating loads whose URLs are never committed; at least one progressive sports source; TS and HLS examples where the provider exposes them |
| Sports inputs | Start of Slice 7 | Legally usable 720p50/59.94, 576i50 and 1080i50 cases; synthetic fixtures fill any gaps in the real provider set |
| Benchmark configuration | Start of Slice 6 | Windows build, NVIDIA driver, display model, 4K refresh mode and audio output; changes create a new result series |
| Controller | Start of Slice 4 | Exact controller model and connection mode used for the input/focus matrix; keyboard remains required independently |

The exact Windows mpv artifact is intentionally selected in Slice 2 because its build provenance and feature set are part of that slice's evidence.

## 2. M0a — native playback feasibility

### Slice 1 — Repository foundation

**Outcome:** the project can be entered reproducibly on Linux/WSL and built and tested without global JavaScript tooling; native Windows prerequisites have a checked-in bootstrap/check path.

Build:

- Flake-based Nix development shell with Node aligned to Electron's embedded Node major where practical, pnpm/Corepack, ffmpeg and development mpv
- Electron + React + strict TypeScript shell using electron-vite
- Package lockfile and scripts for development, build, type-check, lint and test
- Initial main, preload and renderer boundaries with renderer sandboxing, context isolation and Node integration disabled
- Windows bootstrap/check script for irreducibly native prerequisites
- Documented native Windows checkout/build/run workflow and how sanitized evidence returns to the repository
- Schema and placeholder for the pinned Windows mpv runtime manifest
- `.gitignore` entries for local credentials, runtime artefacts, logs and M0 evidence

Acceptance:

- `nix develop` exposes the documented toolchain on Linux/WSL
- A clean dependency install succeeds from the lockfile
- Type-check, lint and unit-test commands pass
- A development Electron window opens on Windows 11
- The documented Windows workflow succeeds from a clean checkout or clean dependency state
- The packaged-development build contains no credentials or local stream configuration

Evidence: command summary, tool versions and a sanitized Windows launch record.

### Slice 2 — First native frame

**Outcome:** Electron owns a pinned mpv child process and can display one known-good live stream through JSON IPC.

Build:

- Choose and pin the Windows x64 mpv artifact, SHA-256, mpv/FFmpeg commits and source/build references
- Fetch/verify script; no unverified `latest` download
- Spawn mpv with an unpredictable per-process named-pipe name
- Connect JSON IPC, observe lifecycle events and send the stream using `loadfile` rather than process arguments
- Minimal generation ID and structured event/timing log
- Clean shutdown, forced termination timeout and orphan-process check
- Ignored local development input for the known-good stream

Acceptance on the target Windows machine:

- The verified bundled mpv artifact starts without relying on a system mpv
- One known-good stream reaches visible video and audible audio
- `start-file`, `file-loaded`, `playback-restart`, reconfiguration and end/exit events are captured
- The stream URL and credentials are absent from process arguments and persisted logs
- Closing Electron leaves no mpv process or named pipe behind

Evidence: runtime-manifest snapshot, structured first-frame timings and sanitized process/log inspection.

### Slice 3 — Embedding and lifecycle

**Outcome:** mpv behaves like part of the application window rather than a separately managed player.

Build:

- Embed mpv using the Electron native window handle and `--wid`
- Keep video geometry synchronized during resize, restore, maximise and fullscreen transitions
- Generation-safe load commands sufficient to prevent stale results during rapid manual zaps
- Minimal handling for mpv exit/hang and Electron GPU-process loss

Acceptance on the target Windows machine:

- Video remains correctly parented and clipped during move and resize
- Ten consecutive fullscreen enter/exit cycles complete without an orphaned, inaccessible or incorrectly stacked video window
- Five round trips between the available monitors/DPI modes complete without persistent geometry corruption
- Ten Alt+Tab away/back cycles and ten minimise/restore cycles return to a controllable player without manual window reset
- One display sleep/resume cycle returns to a controllable player without restarting the application
- Thirty rapid alternating loads finish on the newest requested stream
- Killing mpv leaves Electron responsive and starts a controlled replacement attempt

Evidence: interaction-matrix result, final-generation assertion and recovery timing.

### Slice 4 — Overlay decision gate

**Outcome:** choose one viable playback-overlay path or stop M0 before building the product around an unacceptable window model.

Path A — interactive Electron overlay:

- Transparent, always-aligned overlay above embedded video
- Now/next placeholder and zap feedback
- Keyboard plus the recorded M0 controller's focus transfer, and intentional pointer click-through regions
- Resize, fullscreen, DPI, Alt+Tab, sleep/resume and rapid-zap coverage

If A fails, Path B — mpv OSD:

- Minimal now/next and zap feedback rendered through mpv OSD/script messages
- Legible at the target 4K viewport and usable without fragile focus transfer

Acceptance:

- One path passes the quantified Slice 3 interaction matrix, plus ten overlay show/hide and focus-transfer cycles, with zero failures requiring a manual window reset or application restart
- Keyboard navigation passes independently; when a controller has been recorded for M0, its D-pad, accept and back inputs pass the same focus path without becoming trapped in either window
- The chosen path can show now/next and immediate zap/recovery feedback
- The result and rejected-path limitations are documented

**M0a gate:**

- Pass A: continue with the Electron overlay
- Pass B: continue with mpv OSD and record the UI constraint
- Pass neither: outcome C; park the project or explicitly revise the product layout before M0b

## 3. M0b — first usable Xtream slice

### Slice 5 — Xtream channel-to-video vertical slice

**Outcome:** local credentials lead to a real channel list and selecting a channel produces video.

Build:

- One-time ignored development input imported into Electron `safeStorage`
- Account validation and the minimum Xtream live-category/live-stream calls
- Normalized category and channel records with stable internal IDs
- Resolve required HTTP(S) MPEG-TS and HLS URLs inside the trusted process boundary
- Bare category/channel UI and a channel intent that contains only the internal ID
- Scoped User-Agent, Referer, custom-header and cookie support where the provider requires it

Acceptance:

- Valid credentials load categories and channels; invalid credentials stop without retrying as a transport failure
- Selecting TS and HLS examples, when the provider exposes both, reaches playback
- The renderer never receives plaintext credentials or an authenticated stream URL
- Structured logs and UI errors are redacted under success and failure paths
- A malformed provider record is skipped without aborting the full import

Evidence: sanitized API-shape fixture, record counts, TS/HLS timings and redaction-test results.

### Slice 6 — Hardware decode, adapter and 720p→4K VSR

**Outcome:** the target RTX 5080 path is measured and a safe default is selected.

Build:

- Record Electron GPU information and enumerate mpv D3D11 adapters
- Prefer or explicitly select the RTX adapter when the OS default is different
- Comparable profiles for `d3d11va`, `nvdec` and software decode
- Request RTX VSR through the tested D3D11VPP path when the source is below the viewport size
- Reapply or disable scaling after `video-reconfig`
- Vendor-neutral scaler fallback and honest requested/attached diagnostics

Acceptance on the target Windows machine:

- The selected GPU, decoder and render path are visible in diagnostics
- Both supported hardware paths are compared on the same 720p source; the default is chosen from recorded evidence
- After a 30-second warm-up, a ten-minute clean synthetic 720p50 or 720p59.94 run into the 4K viewport completes with the VSR request attached, no increase in mpv's renderer/VO dropped-frame counter and no recovery event; network- or source-attributed drops invalidate the run rather than count as a GPU pass or failure
- Resolution changes do not leave a stale scale factor or broken filter graph
- Forced hardware-decode failure reaches playable software fallback rather than a terminal error
- No diagnostic claims that VSR is active unless an actual confirmation signal is demonstrated

Evidence: A/B result, dropped-frame/resource sample and chosen profile with rationale.

### Slice 7 — Sports motion baseline

**Outcome:** the player is credible for the content that matters most, not merely for progressive test clips.

Build:

- Synthetic or legally usable 720p50/59.94, 576i50 and 1080i50 cases
- Correct top/bottom field order and intentionally wrong metadata cases
- Tested D3D11VPP deinterlacing mode with explicit field-order override
- Frame/drop/repeat, A/V drift and reconfiguration logging

Acceptance on the target Windows machine:

- Progressive sports sources maintain smooth expected cadence
- 576i50 and 1080i50 produce stable field-rate motion without persistent combing
- A wrong-field-order case is diagnosable and recoverable using the override
- Hardware deinterlacing failure falls back without making the stream unplayable
- A 30-minute sports run has no manual recovery, sustained drift or unexplained monotonic resource growth

Evidence: per-fixture playback summary, chosen deinterlacing settings and short real-viewing notes.

### Slice 8 — Clean-stream harness and diagnostics baseline

**Outcome:** the first usable player has a reproducible baseline from which M1 fault recovery can be built.

Build:

- Nix-hosted proxy/generator skeleton reachable by native Windows playback
- Clean continuous-TS and HLS fixtures; standard AES-128 HLS case when supported by the fixture generator
- Machine-readable start, request, first-frame, playback and shutdown timestamps
- Bounded structured logs with rotation/retention suitable for later fault cases
- Automated credential, URL, header and cookie redaction tests
- Probe report for the pinned build's networking backend and accepted reconnect options
- Windows named-pipe DACL inspection for the actual mpv IPC path; if mpv-created pipes are too permissive, record the parent-created pipe or minimal native-helper work required before distribution

Acceptance:

- Native Windows Electron plays the clean TS and HLS baselines through the proxy
- Repeated runs produce comparable, machine-readable timing results
- AES-128 HLS plays without exposing the key or authenticated request data in diagnostics
- The proxy can later inject faults without changing the player-facing URL or result schema
- Redaction tests cover normal playback, authentication rejection, network failure and raw mpv output
- The IPC pipe grants write access only to the current user SID plus required system/administrator identities; broader authenticated-user or world write access fails M0b

Evidence: committed synthetic-fixture definitions and sanitized baseline summaries; private/provider data remains ignored.

**M0b gate:**

- A real Xtream channel is daily-usable through the selected overlay path
- Hardware decode and software fallback are both proven
- 720p→4K and interlaced sports behaviour are acceptable on the target rig
- Clean TS/HLS harness cases pass and diagnostics are credential-safe
- Any failure blocks M1 unless it is explicitly removed from the product contract in the PRD

## 4. Dependency order

```text
Slice 1: foundation
    ↓
Slice 2: first frame
    ↓
Slice 3: embed/lifecycle
    ↓
Slice 4: overlay gate ── fail A and B ──→ park or revise
    ↓ pass A or B
Slice 5: Xtream vertical slice
    ↓
Slice 6: hardware/VSR
    ↓
Slice 7: sports motion
    ↓
Slice 8: harness baseline
    ↓
M1 engine work
```

Slices are deliberately ordered by existential risk, not UI completeness. Small harness and logging seams may be introduced earlier when required to prove a slice, but the full fault taxonomy remains M1.

## 5. Explicitly deferred from M0

- Full recovery state machine and complete fault-injection taxonomy
- Polished login/source management
- EPG ingestion and grid
- Favourites, search, recents and production navigation
- Broad provider-dialect compatibility
- RTMP/RTSP recovery guarantees, UDP/SRT and DRM
- Installer signing, auto-update and publication work
- HDR, recording, catch-up, VOD and multi-source support
