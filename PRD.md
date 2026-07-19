# PRD — Coax

**A native-quality IPTV player for Windows. Makes bad streams behave.**

| | |
|---|---|
| Status | Draft v0.4 |
| Owner | Jono |
| Type | Personal project, open source candidate |
| Date | 19 July 2026 |

---

## 1. Problem

The Windows IPTV clients tested for this project do not combine the desired resilient streaming engine with a focused live-TV UI. Kodi has a battle-tested engine inside a broad media-center UX; IPTVnator has a pleasant playlist manager but has not matched the required playback behaviour in personal testing; Megacubo has useful resilience with a less suitable UX; the paid Microsoft Store field is difficult to evaluate confidently. TiviMate remains the Android-TV experience benchmark and, as of this PRD date, has no native Windows release. No claim is made about its future platform plans or private implementation.

The product hypothesis is that a pinned Windows mpv build with D3D11 hardware decode and RTX Video Super Resolution can deliver a higher image-quality ceiling on the target PC/display than the current Android setup, particularly for 720p sports feeds. The canonical v1 target is **Windows 11 x64 with an NVIDIA GeForce RTX 5080, playing 720p source video into a 4K viewport/display**. The exact Windows build, NVIDIA driver, display model/refresh rate and audio path are recorded with every benchmark rather than silently treated as constants. This is an M2 A/B benchmark to prove on that rig, not an assumed universal advantage over Android devices.

## 2. Product thesis

Do what TiviMate did to Kodi on Android, on Windows: a purpose-built live TV appliance — channel list, EPG grid, player — with nothing else. No library management, no add-ons, no skin engine. The engine is a pinned mpv child process; the app is a thin, fast shell and recovery supervisor around it.

## 3. Goals

**Primary objective — everything else is subordinate:**

> **Streaming performance and robustness at TiviMate level or above on the defined benchmark corpus.** Survive TS timestamp discontinuities, flaky/malformed HLS segments, mid-stream resolution and codec parameter changes, and dropped connections without user intervention. On the versioned streams and injected faults in §7.4/§11, Coax must recover whenever the pinned TiviMate benchmark does and should degrade more gracefully on marginal inputs. This is a finite, reproducible release gate—not a universal claim about every provider stream. If a feature, UI decision, or dependency ever trades against playback robustness, robustness wins.

Secondary goals, in order:

1. Channel zapping that feels instant and a UI that feels like a TV appliance, not a media center.
2. Best-in-class image quality on the target NVIDIA hardware: tested D3D11-compatible hardware decode + RTX VSR upscaling, with vendor-neutral fallbacks (mpv's built-in `ewa_lanczossharp` scaler and an optional tested FSRCNNX shader).
3. Zero-friction setup: paste an M3U or Xtream login + XMLTV URL, watching TV inside two minutes.

## 4. Non-goals (v1)

- VOD / movies / series libraries (live TV only)
- Recording / DVR
- Cross-platform builds (Windows first; architecture shouldn't preclude Linux/macOS later, but no effort spent on it)
- Supporting every grotty provider dialect — build for known-good sources, generalise the parsing layer only when something real breaks
- Multi-user profiles, parental controls
- DRM-protected services (Widevine, PlayReady or provider-specific DRM). HLS AES-128 transport encryption is in scope; DRM licence acquisition and protected playback are not.

## 5. Target user

v1 is built for one user: me. Design decisions default to "what do I actually watch and how." Generalisation is earned, not assumed. If v1 holds up, the secondary audience is the desktop IPTV crowd currently settling for Kodi or emulators — but no v1 feature exists solely for them.

## 6. Architecture & technology decisions

```
┌─────────────────────────────────────────────────────┐
│ Electron                                             │
│  · main: windows, supervisor, mpv lifecycle          │
│  · renderer: channel list, EPG grid, settings        │
│  · data utility process: sources, XMLTV, SQLite      │
└──────────────┬───────────────────────┬──────────────┘
               │ JSON IPC             │ typed messages
               │ (named pipe)         ▼
┌──────────────▼────────────────┐  ┌──────────────────┐
│ mpv — isolated child process │  │ SQLite + config  │
│  · --wid child HWND           │  │ data directory   │
│  · own D3D11 swapchain       │  └──────────────────┘
│  · ffmpeg/libcurl demux       │
│  · D3D11 hwdec + VSR/scalers │
└───────────────────────────────┘
```

### 6.1 Video engine: mpv as an isolated child process, not in-process libmpv

The robustness-first objective decides this. Two ways to integrate mpv:

- **In-process libmpv render API:** mpv renders into the app's GL/D3D context. Smooth UI compositing over video, but a user-mode decoder or mpv fault can take the whole app down, and on Windows the render path through Electron's graphics stack makes copies and VSR/HDR behaviour harder to reason about.
- **Child process + `--wid` embed + JSON IPC:** mpv runs as its own process, parented into an app window HWND, controlled over a named pipe (`\\.\pipe\...`). mpv owns its swapchain directly → cleanest path to hardware decode, VSR via d3d11vpp, and HDR later. A user-mode mpv crash is contained and the supervisor can respawn the process without taking down the shell. Process respawn should begin within one second; time to recovered video is measured separately.

Child process wins. This is the same isolation logic as Ripcord's Rust audio sidecar. It does **not** fully isolate display-driver faults: a Windows TDR/device-loss event can reset the shared graphics stack and affect Electron's GPU process as well as mpv, so device loss is an explicit recovery test rather than assumed containment. Note mpv.js (the old in-process Electron plugin) is dead — it depended on Chromium's removed PPAPI. Relevant prior art: IPTVnator shipped an experimental embedded libmpv on macOS (May 2026) via a native Node addon and the render API; useful validation of Electron+mpv integration, but not of the child-process approach.

Trade-off accepted: UI overlays (channel bar, EPG over video) can't composite into mpv's surface, so they're layered transparent windows or mpv OSD script. Electron documents limitations around transparent-window resizing, click-through and Windows maximisation, and child windows do not automatically follow their parent on Windows. **M0a must prove the overlay approach, not just playback**, including focus, move/resize, fullscreen, multi-monitor DPI, rapid zaps, Alt+Tab and sleep/resume.

### 6.2 Shell: Electron

Known path — scaffolding, build pipeline (electron-builder/NSIS), and NZ code-signing research carry over from Ripcord. Tauri's smaller footprint buys little when the heavy process is mpv anyway, and the `--wid`/overlay dance is better-trodden in Electron. Flutter + media_kit was the credible alternative (libmpv underneath) but means a new toolchain for no engine gain.

### 6.3 Control plane & supervisor

mpv JSON IPC over a named pipe drives the §7.3 supervisor. The primary signals are `demuxer-cache-state` (`cache-duration`, `raw-input-rate`, `underrun`), `paused-for-cache`, playback-time progression, process exit, and the `start-file`, `file-loaded`, `playback-restart`, `video-reconfig`, `audio-reconfig` and `end-file` events. `demuxer-cache-duration` is approximate and can be unavailable; `demuxer-cache-time`, `core-idle` and `eof-reached` are supplementary only because their semantics are too ambiguous or transient to identify a stall alone.

The supervisor lives in Electron main in TypeScript and does no database, source parsing or long-running synchronous work. It owns the mpv lifecycle, the recovery state machine, kill-and-respawn, and per-file option injection. Every zap gets a monotonically increasing generation ID; late events, timers and recovery results from an older generation are discarded so rapid channel changes cannot resurrect an old stream.

### 6.4 mpv distribution

Bundle a pinned build inside the installer — never depend on a system mpv. mpv lists **shinchiro/mpv-winbuild-cmake** and **zhongfly/mpv-winbuild** as upstream-recognised but unofficial third-party Windows builds. Shinchiro is the preferred shipping candidate; zhongfly is useful for checking fixes against newer mpv/FFmpeg snapshots. Do not describe either as an official or canonical binary distribution.

The repository contains a machine-readable runtime manifest with the exact artifact URL, SHA-256, mpv commit, FFmpeg commit, architecture and known build configuration. A checked-in fetch/verify script installs the artifact into the development or packaging tree; the binary itself is not silently replaced by "latest". Version upgrades go through the §7.4 Windows harness as a regression gate. Nix pins the development tools but does not pin or substitute the shipping Windows runtime.

Before any binary is published, the exact mpv/FFmpeg build's GPL/LGPL and third-party codec obligations must be reviewed and satisfied: notices, corresponding source/build information, licence texts and redistribution terms ship with the release. App licensing can remain an open question during the personal spike; dependency compliance cannot.

### 6.4.1 Target platform and GPU selection

v1 targets native **Windows 11 x64** on the RTX 5080 rig. Hardware acceleration is preferred whenever the pinned build, stream and driver can sustain it without weakening recovery: M0b compares `d3d11va` and `nvdec`, selects a measured default, and retains automatic software decode as the compatibility/failure fallback. Coax never fails a playable stream merely because hardware decode is unavailable.

On multi-GPU systems, Electron and the mpv child can otherwise select different adapters. Startup diagnostics record Electron's active GPU/driver and mpv's selected D3D11 adapter. The app requests the high-performance GPU for Electron where appropriate and passes an explicit `--d3d11-adapter` to mpv when discovery shows that the default is not the RTX device. M0b verifies that decode, rendering and requested VSR all use a compatible path; adapter choice is observable configuration, not an implicit driver decision.

### 6.5 Data & parsing

- **EPG:** `node:sqlite` (built into the Node runtime shipped by current Electron). It avoids native-module rebuild and packaging friction, but remains experimental in Electron's current Node line and all exposed database operations are synchronous. A dedicated Electron utility process owns SQLite, migrations, source refresh and XMLTV ingestion; Electron main and the renderer access it through typed asynchronous messages. Database integration tests run under the pinned Electron runtime. better-sqlite3 remains a fallback if a demonstrated API or performance gap justifies its rebuild cost.
- **Config/playlists:** versioned JSON plus SQLite inside one self-contained application data directory. Writes are atomic and migrations are forward-versioned. "Portable" means the data directory can be backed up or relocated as a unit, not that credentials are stored in plaintext.
- **M3U:** hand-rolled tolerant parser — dialect differences are the point. Malformed entries are logged and skipped without aborting the import. **XMLTV:** streaming sax-style parse with gzip support; do not materialise the full document. Disable external entities/DTDs, cap compressed and expanded sizes, and import into a transaction/staging schema before atomically replacing the active guide.
- **EPG time model:** store instants in UTC, preserve the source offset for diagnostics, render in the selected display timezone, and include DST/missing-offset fixtures. `tvg-id` matching is exact by default with explicit, persisted manual overrides; fuzzy matching never silently rewires a channel.

### 6.6 UI stack

**React 19 + TypeScript (strict) + electron-vite.** React over Solid/Svelte isn't a performance call, it's a velocity call — deep existing fluency (Tend web/RN, Ripcord). The child-process architecture prevents renderer JavaScript stalls from directly blocking mpv's playback loop, but Chromium can still contend for GPU, memory and compositor resources, particularly through an overlay window. Renderer performance therefore remains part of the Windows soak and overlay tests without deciding the player architecture.

Where the frontend decisions actually matter:

- **The EPG grid is the hard rendering problem.** At 300 channels over 48 hours there are ~28,800 cells at a 30-minute average programme length, or ~57,600 at 15 minutes — not 100k by default, but still enough to require windowing. Two-axis virtualisation with **@tanstack/react-virtual** is the initial choice because its headless vertical/horizontal virtualizers fit a time-proportional, absolutely positioned grid. `react-window` is active again and remains a credible alternative, but its grid abstraction is less natural for variable programme widths. Grid data comes from range queries keyed to the visible channel/time window; React never holds the entire guide in state. If measured speed-scrolling still stutters, fallback is canvas rendering with a DOM focus/interaction layer — decide on evidence in M3.
- **Focus engine / spatial navigation.** TV-appliance feel means the whole app drives with arrows/D-pad, not mouse-first with keyboard bolted on. `@noriginmedia/norigin-spatial-navigation` is the initial directional-focus choice, with focus state as a primary navigation model from day one; delaying spatial-navigation design would make the later EPG and overlay interaction substantially harder.
- **State:** zustand for app state (channels, favourites, settings). **Player state stays out of React churn** — mpv property events land in a subscription store (zustand vanilla store or plain emitter) and only leaf components that display them subscribe. No player tick ever re-renders the tree.
- **IPC:** typed contract between main and renderer (plain typed invoke/handle wrappers are enough; tRPC-over-IPC if the surface grows). Supervisor and mpv lifecycle live entirely in main — renderer sends intents ("zap to channel X"), never talks to mpv directly.
- **Styling:** Tailwind, dark-first, minimal animation (CSS transforms only — this is a TV appliance, not a dribbble shot). Overlay windows share the same renderer build with a different entry route.

### 6.7 Test harness stack

Node proxy in front of ffmpeg-generated live streams for fault injection (segment failures, resets, stalls, throttling); ffmpeg filters and generated fixtures for PTS mangling, corrupt data and codec/parameter changes. Synthetic generators and legally redistributable fixtures are committed. Captured provider streams, playlist URLs and API responses are private local fixtures, sanitized of credentials and never committed or included in public releases without explicit redistribution rights.

### 6.8 Development environment: Nix

The repository uses a flake-based Nix development environment as the canonical way to enter the project and run normal development commands. `flake.nix` and `flake.lock` are committed; optional direnv integration provides automatic shell activation. Nix supplies Node.js, pnpm/Corepack, ffmpeg, mpv for Linux-side development and harness work, and the supporting build/lint/format tooling. The Nix Node major tracks Electron's embedded Node major where practical so standalone tests do not accidentally depend on a newer API. JavaScript dependencies remain declared in `package.json` and pinned by `pnpm-lock.yaml`; no globally installed npm packages are assumed.

Nix does not replace the native Windows environment required to prove the product. HWND embedding, transparent-window composition, D3D11, NVDEC, RTX VSR, fullscreen transitions, and the shipping mpv build must all be exercised under native Windows Electron. The Windows mpv binary is therefore pinned and bundled separately rather than sourced from Nix, with a small checked-in Windows bootstrap/check script covering any irreducibly native prerequisites. The Nix-provided mpv is a development and harness-authoring dependency only, not the release runtime or a valid playback-conformance DUT. Database integration tests also run under the pinned Electron runtime because its embedded Node—not Nix Node—is what ships.

### 6.9 Security, credentials & untrusted input

- Renderers are sandboxed and context-isolated with Node integration disabled. Preload exposes narrow, typed methods per intent; it never exposes raw `ipcRenderer` or arbitrary mpv commands. Only packaged local application code is loaded into app windows.
- Xtream credentials are encrypted/decrypted by a small main-process credential service using Electron `safeStorage` (Windows DPAPI). A data utility receives scoped plaintext only while making the required provider call. Credentials never enter renderer state and are replaced with explicit redaction tokens in structured logs, errors, crash reports and exported diagnostics.
- Stream URLs are sent to an already-running mpv via `loadfile` IPC, not placed in mpv command-line arguments. The renderer requests playback by internal channel ID and cannot submit an arbitrary URL.
- mpv JSON IPC is explicitly unauthenticated and command-capable. Each mpv instance uses an unpredictable per-process pipe name; Coax connects immediately and never exposes the name to the renderer. M0b inspects the actual Windows DACL. A distributable build must ensure only the current logon/user SID (plus required system/administrator identities) can connect with write access, using a parent-created inherited pipe or the smallest native helper if the mpv-created pipe cannot satisfy that requirement.
- Source, playlist, XMLTV and logo URLs are untrusted data. Network fetchers allow only required protocols, bound redirects/timeouts/body sizes, reject local-file execution paths, and never render remote HTML. XML/gzip expansion and image decoding receive explicit resource limits.

### 6.10 Diagnostics & update policy

Playback and recovery logs are structured, bounded and redacted. Every event carries timestamp, session ID, zap generation, channel ID, transport, mpv/runtime versions, state transition and reason code. Raw mpv output is sanitized before persistence rather than written to an intermediate unredacted file. Logs use rotation/retention limits and can be exported as a sanitized diagnostic bundle; raw credentials and full authenticated URLs are prohibited by tests.

Electron is kept on a supported stable line and receives patch/security updates independently of feature work. Electron, mpv and FFmpeg upgrades are pinned changes with changelog review, Windows harness results and rollback metadata. Release artefacts include checksums and a dependency/licence inventory.

## 7. Streaming engine spec (the actual product)

This section is the product. The UI is a shell around it.

### 7.1 Failure taxonomy & required behaviour

| Condition | Required behaviour |
|---|---|
| TS PTS/DTS discontinuity (provider splice, ad insertion) | Resync without visible freeze; brief A/V glitch acceptable, desync or stall is not |
| Mid-stream resolution / SPS change | Seamless decoder reconfigure, no teardown visible to user |
| Interlaced 576i50 / 1080i50 sports or incorrect field-order metadata | Produce stable field-rate motion without combing or persistent judder; select and record the tested D3D11VPP deinterlacing mode, allow an explicit field-order override for broken sources, and fall back safely if the hardware path is unsupported |
| HLS segment unavailable / timeout | Treat as a broken-source recovery policy, not spec-guaranteed behaviour: decide within 2 s of the request failure and resume at the earliest available decodable segment; never enter a permanent stall |
| Continuous HTTP MPEG-TS drop / reset | Reopen the same stream URL; do not claim HLS-style live-edge seeking |
| HLS connection drop / playlist stall | Reload according to the transport policy and resume near the current live edge without replaying stale buffered content |
| Stalled input | Detect zero input/progress within 3 s, but reconnect only when cache and playback health confirm impact; a healthy 5–10 s buffer must be allowed to absorb brief jitter |
| Corrupt/partial segments | Decode what's decodable, skip the rest; no crash, no permanent artefacting |
| Audio codec change between programmes | Reinit audio chain transparently |
| Server sends wrong/absent Content-Type | If the normal fast path fails, retry with MIME-derived format disabled and probe the content; provider headers must not cause a permanent false-negative |
| Rapid repeated zaps / late IPC events | Only the newest generation may reach playing/recovery state; old timers and events are ignored |
| mpv process crash / hang | Shell remains responsive; terminate if needed, respawn begins within 1 s, then reload the current generation under the normal recovery budget |
| GPU device loss / Electron GPU-process restart | Recreate affected windows/processes or surface a controlled recoverable failure; never assume child-process isolation contains a Windows TDR |
| Sleep/resume or network-interface change | Revalidate the current stream and reconnect without requiring an app restart |
| Audio device removal/change | Reinitialise audio while preserving video where possible; otherwise perform a controlled stream reload |
| Expired/rejected provider credentials | Stop retrying on confirmed authentication failure, preserve the channel list, and request updated credentials without logging them |
| Very long sessions (4 h+) | No user-action stall, drift or monotonic memory/resource leak under the §11 soak thresholds |

### 7.2 Buffer & latency model

Two-phase tuning, switched automatically:

- **Zap phase:** explicit, pinned low-readahead options derived from mpv's `low-latency` profile to get first frame within the §11 target. Do not treat the built-in profile as a stable API: inspect it with `--show-profile=low-latency` on every mpv upgrade and store the tested effective option set in diagnostics.
- **Steady state:** after `playback-restart`/first-frame confirmation followed by 5 s with advancing playback and no underrun or recovery event, expand demuxer readahead (initial target 5–10 s buffered, `demuxer-max-bytes` 64–128 MB) to ride out jitter. These are starting values, not product truths; the harness selects the shipped defaults.
- Buffer health exposed to the supervisor and (optionally) on-screen as a debug overlay.
- Falling input rate alone is an observation, not a recovery trigger while buffered playback is healthy. On recovery, stale live buffers are discarded deliberately before returning to the live stream.

### 7.3 Supervisor

A TypeScript state machine in Electron main with explicit `idle → loading → zap → steady → recovering → failed` states. Each transition is generation-scoped, logged and covered by deterministic timer tests. The supervisor chooses reload, process restart or terminal authentication/source failure based on transport and evidence; it does not infer a stall from one mpv property.

There is one retry owner for each failure path. FFmpeg/mpv protocol retries may handle a narrowly defined transient error, or the supervisor may reopen/restart, but both layers do not independently run unbounded loops. The default supervisor schedule is 0.5, 1, 2, 4 and 5 s, with at most five recovery attempts and a 30 s wall-clock budget including network timeouts. Authentication failures bypass this loop. These defaults are versioned configuration and may change only with harness evidence.

mpv's `stream-lavf-o`/`demuxer-lavf-o` reconnect controls are build- and protocol-path-dependent—top-level HTTP may use mpv's libcurl backend while nested HLS requests use libavformat. The pinned Windows build is probed at startup and exercised by the harness; unknown or silently ignored AVOptions do not count as recovery coverage. Structured recovery logs are the primary debugging artefact for hardening.

### 7.4 Robustness test harness

Can't hit "TiviMate or above" without measuring it. A local harness (ffmpeg + a proxy) replays generated or private captured streams and injects a timestamped fault schedule: segment failures, connection resets, PTS jumps, corrupt data, stalls, bandwidth throttling, auth rejection and codec/parameter changes. Its sports corpus includes progressive 720p50/59.94 plus 576i50 and 1080i50 sources, correct and incorrect field-order metadata, and playback into the target 4K viewport at the display refresh rates actually used. Every applicable taxonomy row above gets a repeatable test with machine-readable start, detection, recovery, first-frame and failure timestamps.

The proxy/generator can run from Nix, but playback conformance runs against the pinned mpv inside native Windows Electron. Linux mpv results are diagnostic only. The same proxy and fault schedule feed the pinned TiviMate benchmark device where protocol support allows. Synthetic fixtures are public; real provider captures and sanitized API responses remain private unless redistribution rights are clear. A minimal harness skeleton and clean-stream baseline land in M0b; the full taxonomy is built in M1.

### 7.5 Reference behaviours

Where mpv's defaults fall short, use prior art as input rather than assumed equivalence: ExoPlayer's source-readable LoadControl/error policies, Kodi's inputstream retry logic, and the pinned mpv/FFmpeg/libcurl behaviours demonstrated by the harness. TiviMate is a black-box outcome benchmark; no claim is made about its internal buffering implementation.

## 8. v1 feature set

### 8.1 Sources

- M3U / M3U8 playlist import (URL or file), including `#EXTINF` attributes: tvg-id, tvg-logo, group-title
- Xtream Codes API login (get_live_categories / get_live_streams)
- XMLTV EPG (URL, gzip supported), matched via tvg-id with manual override
- Single provider assumed; data model shouldn't preclude multiple later
- M0b includes only the minimum Xtream vertical slice needed to exercise real channels: credentials seeded from ignored local development input into safe storage, account validation, live categories/streams, normalized internal channel records and stream URL resolution. Polished login, source management and compatibility work remain M3.
- **Required v1 playback transports:** continuous MPEG-TS over HTTP(S), HLS over HTTP(S), and standard HLS AES-128 key delivery. Provider compatibility includes bounded redirects plus scoped User-Agent, Referer and custom HTTP headers/cookies when supplied by the source adapter; these secrets receive the same renderer isolation and log-redaction treatment as stream URLs.
- **Compatibility tier, not a release gate:** RTMP/RTMPS and RTSP entries may be passed through when supported by the pinned mpv/FFmpeg build, but do not inherit the HTTP TS/HLS recovery guarantees until they have transport-specific harness cases. UDP/SRT, proprietary apps and DRM are outside the v1 contract unless a real source promotes them through a written scope change.

### 8.2 Channel experience

- Channel list with groups, favourites, search; recents rail
- Number-key and up/down zapping; previous-channel toggle
- Zap target: video visible within the §11 p95 bound on a healthy stream (explicit tested zap-phase options, then steady-state buffering after the §7.2 stability condition)
- Now/next info bar on switch; full EPG grid (48 h window) with jump-to-now

### 8.3 Playback & image quality

- Resilience per §7 — the engine spec governs; nothing here overrides it
- D3D11 render with hardware decode preferred on the RTX 5080. `d3d11va`, `nvdec` and safe software fallback are benchmarked against the pinned build; M0b selects the hardware default on evidence because VSR compatibility, corrupt-stream recovery and copy cost differ. Software fallback remains automatic and must preserve playback when acceleration is unavailable or demonstrably unstable.
- RTX VSR — available in current mpv through `vo=gpu-next` + `gpu-api=d3d11` + `gpu-context=d3d11` + `vf=d3d11vpp=scale=N:scaling-mode=nvidia`, with a compatible hardware-decoding path selected by M0b evidence. The supervisor computes a clamped upscale factor from decoded source dimensions to the actual video viewport, reapplies the filter on `video-reconfig` and disables it when no upscale is required. The mpv filter only requests the NVIDIA extension; actual operation still depends on RTX hardware, driver and NVIDIA-app settings. Diagnostics therefore report **requested**, filter attached, source/output sizes and hwdec path—not "VSR active" unless a reliable confirmation signal is demonstrated. mpv's built-in `ewa_lanczossharp` scaler and an optional tested FSRCNNX GLSL shader provide the vendor-neutral fallback/A-B paths; bundled shader licences are tracked.
- RTX Video HDR (`nvidia-true-hdr`) exists in the same filter but is explicitly deferred and not part of v1 acceptance, regardless of upstream bug status changing after this PRD date.
- Audio track and subtitle selection where streams carry them

### 8.4 App shell

- Fullscreen-first UX, controller/keyboard friendly, mouse works
- Always-on-top mini-player / PiP mode
- Settings: source management, EPG refresh interval, upscaler choice, buffer tuning presets (Auto / Aggressive / Conservative)
- Self-contained, backup-friendly data directory containing versioned JSON and SQLite; credentials remain OS-encrypted and machine/user-bound rather than falsely "portable"

## 9. Later (explicitly deferred)

Catch-up/archive (provider URL schemes vary wildly — scar-tissue territory), recording, multi-source failover per channel, Stalker portal support, cross-device sync, Linux build, theming.

## 10. Risks

| Risk | Mitigation |
|---|---|
| RTX VSR request succeeds but the driver does not actually engage it; decode-path and resolution-change interactions vary | Report requested/attached state honestly, capture driver/GPU/build metadata, reapply on `video-reconfig`, benchmark d3d11va vs nvdec, and retain the scaler/shader fallbacks |
| Electron, mpv and hardware decode select different adapters on a multi-GPU system | Record both processes' GPU/driver data, enumerate mpv D3D11 adapters, prefer the high-performance RTX path, and verify adapter/decode/VSR compatibility in M0b |
| Interlaced sports look acceptable when paused but fail in motion | Dedicated 576i50/1080i50 corpus, field-rate deinterlacing and field-order cases, dropped-frame/judder measurements, and real sports viewing on the target display |
| `--wid` embed + transparent overlay limitations on Windows (resize, click-through, focus, occlusion, fullscreen, DPI) | This IS the M0a spike, with the explicit A/B/C decision below; test a Windows interaction matrix before other UI work |
| Electron main is delayed by EPG/database work, causing false or late recovery | Dedicated utility process owns SQLite, parsing and refresh; main has no long-running synchronous data work |
| mpv/FFmpeg and supervisor both retry, multiplying outage time | One transport-aware recovery state machine, bounded wall-clock budget, protocol/build probes and deterministic timer tests |
| Credentials leak through Xtream URLs, mpv arguments or logs | `safeStorage`, load URLs over IPC after spawn, channel-ID renderer intents, mandatory URL redaction tests and sanitized diagnostics |
| A GPU driver TDR affects both mpv and Electron despite process isolation | Treat process crash and GPU device loss separately; test Electron GPU-process recovery and controlled window/mpv recreation |
| Pinned third-party mpv binary changes provenance or licence composition | Runtime manifest, SHA-256 verification, recorded commits/build metadata, dependency inventory and pre-publication licence gate |
| Provider weirdness exceeds parser assumptions | Personal-first scoping; log-and-skip malformed entries rather than crash |
| Captured provider fixtures contain credentials or copyrighted content | Synthetic public fixtures by default; encrypted/private sanitized captures, never committed or redistributed without rights |
| Scope creep toward Kodi | Non-goals list is load-bearing; anything not in §8 needs a written case |
| Third side project alongside Ripcord + Vessel | M0a gates continuation: if the mpv embed and either overlay path are not credible in a weekend, park it before building the Xtream slice |

## 11. Success criteria (v1)

Robustness (primary, measured via the §7.4 harness):

1. Every applicable row of §7.1 has a committed or private-indexed repeatable case with explicit detection/recovery bounds, and the pinned release candidate passes the full Windows suite.
2. Head-to-head uses a pinned TiviMate version and named device, the same source corpus, and the same proxy-generated fault schedule. Across that finite corpus there are zero cases where TiviMate resumes usable A/V within its observation window and Coax does not. Ties are acceptable; losses are release blockers. This is a corpus result, not a claim about every stream in existence.
3. A 4-hour native-Windows soak on a real provider has zero stalls requiring user action. After a 30-minute warm-up, combined Coax+mpv private working set remains within 15% of the warm baseline and has a fitted growth slope below 10 MiB/hour over the remaining session; GPU memory shows no sustained monotonic growth. Thresholds may be tightened with baseline evidence but not relaxed silently.
4. Injected connection loss follows the configured attempt and 30 s wall-clock budget; authentication rejection terminates retries immediately. An unavailable HLS segment produces a recovery decision within 2 s of the failed request and playback resumes at the earliest available decodable segment without a permanent stall.
5. A full evening of real viewing completes with zero manual recovery. Naturally occurring provider failures are recorded but are not required for the test to be valid because the injected suite supplies deterministic faults.

Secondary:

6. Replaces whatever I'd otherwise use on the PC for live TV — daily-drivable for a month without dropping back to Kodi/BlueStacks.
7. On the Windows 11 x64 / RTX 5080 / named 4K display and driver configuration, the 720p→4K VSR path wins a recorded side-by-side A/B preference against Kodi/basic scaling without introducing dropped-frame or recovery regressions. The sports subset must also show acceptable field-rate motion for 576i50/1080i50 sources with no persistent combing or avoidable cadence judder. This remains a personal-quality criterion, not an objective universal image-quality claim.
8. On the healthy-stream benchmark corpus, zap latency from renderer intent to mpv `playback-restart` is < 1.5 s at p95 over at least 30 zaps and is cross-checked against visible first frame during M2. Cold start from process launch to the same event is < 5 s at p95 over at least 10 clean starts. Hardware, driver, provider, transport and build versions are stored with results.

## 12. Open questions

- ~~Working name~~ — **Coax**. Collision check clean (dead npm package, niche RL framework only); GitHub handles `coax-app` and `coaxtv` unclaimed as of 19 Jul 2026 if an org is ever wanted (`getcoax` is taken); as a repo under a personal account no global uniqueness needed
- App licence if open-sourced (Ripcord precedent?). This does not defer the dependency-compliance gate in §6.4.
- Which M0a overlay outcome wins: A (interactive transparent window), B (mpv OSD for the minimal playback overlay), or C (neither acceptable → park). A letterboxed/non-overlay layout is a later product-scope decision, not an automatic M0a pass.
- Canonical display model and refresh modes, audio device/path, Windows 11 build and NVIDIA driver version. These must be fixed before comparative M2 runs, although M0 may begin on the current installed versions.

## 13. Milestones

- **M0a — Feasibility spike (1 weekend):** native Windows Electron with mpv embedded via `--wid`; one known-good live stream; D3D11 hardware-decode evidence; JSON IPC; resize/fullscreen/multi-monitor DPI; minimal structured timing logs. Overlay gate: **A)** interactive transparent overlay passes the interaction matrix; **B)** if A fails, mpv OSD proves sufficient for now/next and zap feedback; **C)** neither is acceptable, so park the project. Linux/Nix playback does not count as validation. Slice-level execution and evidence requirements are defined in [`docs/M0_IMPLEMENTATION.md`](docs/M0_IMPLEMENTATION.md).
- **M0b — First usable slice:** minimal Xtream adapter backed by safe storage (optionally seeded from ignored local development input), normalized categories/channels, real HTTP(S) TS and HLS zapping, d3d11va/nvdec/software-fallback and GPU-adapter/VSR-path comparison on the RTX 5080, progressive/interlaced sports baselines, clean-stream harness baseline, URL/header/cookie-redaction tests and the selected M0a overlay path. No polished login, EPG or broad provider compatibility.
- **M1 — Engine (the long pole):** generation-safe supervisor, bounded transport-aware recovery, two-phase buffer model, full fault-injection harness, data utility-process boundary, and full §7.1 taxonomy green. UI is a bare Xtream-backed channel list — deliberately ugly. Daily-drivable for favourites on engine merit alone.
- **M2 — Benchmark gate:** Head-to-head vs TiviMate per §11 criterion 2. No M3 work until this passes — UI polish on a losing engine is wasted effort.
- **M3 — TiviMate parity (personal):** EPG grid, polished Xtream login/source management, favourites/groups, VSR toggle, settings and first-run credential flow.
- **M4 — Polish:** PiP, search, buffer presets and interaction polish. Decide on publishing.

## 14. Research references (checked 19 July 2026)

- mpv current manual: <https://mpv.io/manual/master/>
- mpv Windows installation/build sources and status: <https://mpv.io/installation/>
- mpv source, release policy and licensing: <https://github.com/mpv-player/mpv>
- Electron transparent-window limitations: <https://www.electronjs.org/docs/latest/tutorial/custom-window-styles>
- Electron performance/process guidance: <https://www.electronjs.org/docs/latest/tutorial/performance> and <https://www.electronjs.org/docs/latest/api/utility-process>
- Electron security, context isolation and safe storage: <https://www.electronjs.org/docs/latest/tutorial/security>, <https://www.electronjs.org/docs/latest/tutorial/context-isolation> and <https://www.electronjs.org/docs/latest/api/safe-storage>
- Electron runtime versions: <https://releases.electronjs.org/>
- Electron GPU diagnostics and high-performance GPU selection: <https://www.electronjs.org/docs/latest/api/app> and <https://www.electronjs.org/docs/latest/api/command-line-switches>
- Node SQLite API/status: <https://nodejs.org/download/release/latest-v24.x/docs/api/sqlite.html>
- FFmpeg protocols, HLS formats/encryption and legal guidance: <https://ffmpeg.org/ffmpeg-protocols.html>, <https://ffmpeg.org/ffmpeg-formats.html> and <https://ffmpeg.org/legal.html>
- HTTP Live Streaming specification: <https://www.rfc-editor.org/rfc/rfc8216.html>
- Windows GPU timeout/device-loss behaviour: <https://learn.microsoft.com/en-us/windows-hardware/drivers/display/timeout-detection-and-recovery>
- TanStack Virtual and react-window project status: <https://tanstack.com/virtual/latest/docs/introduction> and <https://github.com/bvaughn/react-window>
- NVIDIA RTX Video SDK requirements: <https://developer.nvidia.com/rtx-video-sdk/getting-started>
- Current TiviMate Android-TV positioning: <https://play.google.com/store/apps/details?id=ar.tvplayer.tv>
