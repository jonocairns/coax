# M1 Implementation Plan

M1 turns the playback foundations proven in M0 into a bounded, observable
recovery engine. The UI remains deliberately minimal: engine correctness takes
priority over EPG, polished source management, and interaction polish. A minimal
source-setup flow is included so M1 can be daily-driven without editing local
JSON files.

| Item                          | Decision                                                                          |
| ----------------------------- | --------------------------------------------------------------------------------- |
| Milestone                     | M1 — Engine                                                                       |
| Primary target                | Native Windows 11 x64                                                             |
| Engine                        | Pinned mpv child supervised by Electron main                                      |
| Supported recovery transports | HTTP MPEG-TS and HLS                                                              |
| Retry budget                  | 0.5, 1, 2, 4, and 5 seconds; at most five attempts and 30 seconds wall clock      |
| State model                   | `idle → loading → zap → steady → recovering → failed`                             |
| Gate                          | Every applicable PRD §7.1 condition has a repeatable case and satisfies its bound |

## 1. Execution principles

- Every playback action, timer, event, and recovery result is scoped to a
  monotonically increasing zap generation.
- Only one layer owns retries for a given failure path. mpv/FFmpeg retry options
  and the supervisor must not create nested unbounded loops.
- Recovery decisions use multiple health signals. A single missing property,
  low input rate, or transient event is not sufficient proof of a stall.
- Authentication rejection is terminal and bypasses the retry schedule.
- Transport policy is explicit. Continuous TS is reopened; HLS is reloaded near
  the current live edge without replaying stale buffered content.
- State transitions and reason codes are structured, bounded, redacted, and
  deterministic under test.
- Linux/WSL exercises the generator and proxy, but recovery conformance is
  recorded against the pinned native Windows runtime.

## 2. Slice 0 — Minimal source setup

**Outcome:** a user can configure, replace, or remove the single active Xtream
source from the app without editing an ignored development file.

Implementation:

- Show a first-run source chooser when no source is configured.
- Accept a user-facing source name, Xtream server URL, username, password, and
  an advanced TS/HLS output preference.
- Validate the account before replacing the active source.
- Send submitted values through one narrowly typed renderer-to-main IPC call.
- Validate and encrypt credentials immediately in Electron main using
  `safeStorage`.
- Never return stored credentials to the renderer or pre-populate password
  fields.
- Provide sanitized loading, validation, authentication, replacement, and
  removal states.
- Retain ignored JSON import as a development bootstrap, not the normal setup
  path.

Acceptance:

- A clean native-Windows user-data directory can reach the channel list using
  only the setup UI.
- Invalid input and rejected authentication do not overwrite a working source.
- Successful replacement atomically changes the encrypted source and refreshes
  normalized channels.
- Removing the source deletes the encrypted credential record and returns to
  first-run setup without exposing the previous values.
- Renderer state, errors, logs, and diagnostics contain no submitted or stored
  credential values.
- An unavailable `safeStorage` backend prevents persistence rather than falling
  back to plaintext.

The renderer necessarily holds values while the user types them. The security
contract is therefore that credentials may travel once from the setup form to
main, but stored or decrypted credentials never travel from main back to a
renderer.

Future multi-source work must evolve this singleton without changing the
credential boundary. Introduce stable opaque source IDs, a registry of safe
renderer-visible summaries, a separate encrypted credential record per source,
and narrow add, update, remove, and activate intents. Only the active source is
loaded into the provider session. M1 continues to enforce one configured active
source; multiple configured sources, activation UI, and migration from the
singleton record belong to the deferred polished source-management work.

## 3. Slice 1 — Supervisor vertical slice

**Outcome:** one injected continuous-TS failure travels through the complete M1
path: fault injection, health detection, recovery decision, stream reopen, and
confirmed restored playback.

Implementation:

- Introduce a pure supervisor state machine with the six M1 states.
- Define typed inputs, transitions, actions, reason codes, and generation rules.
- Inject a clock/scheduler so retry and stale-timer behaviour is deterministic
  in unit tests.
- Define the versioned retry policy and 30-second wall-clock budget.
- Extend the harness contract with a timestamped continuous-TS connection
  reset/stall schedule while preserving the stable player path.
- Feed the minimum required mpv health signals into the supervisor.
- Reopen the current TS stream under the same generation.
- Record fault, detection, decision, recovery-start, first-frame, and
  confirmed-playback timestamps.

Acceptance:

- The clean TS case remains green.
- The injected failure is detected within the bound defined by PRD §7.1.
- Playback resumes without user action and without exceeding the retry budget.
- A newer zap invalidates every older timer, action, and recovery result.
- Failed or stale recovery cannot surface as current playback or UI state.
- Logs contain the generation, transport, transition, attempt, elapsed budget,
  and reason code without private input.

## 4. Slice 2 — M3U source adapter

**Outcome:** the same channel and playback path accepts a remote or local M3U
playlist without adding a second source-specific browser.

Implementation:

- Generalize the internal source/channel model without weakening opaque channel
  IDs or trusted URL resolution.
- Add a bounded parser for `.m3u` and `.m3u8` playlists.
- Normalize `tvg-id`, `tvg-logo`, `group-title`, channel name, and supported
  playback transport.
- Accept a private HTTP(S) playlist URL or a local file chosen through a native
  file dialog.
- Read local files and fetch remote playlists inside the trusted utility/main
  boundary.
- Encrypt remote playlist URLs and scoped HTTP settings when they contain
  credentials or other secret material.
- Feed normalized M3U channels into the same browser, mpv input builder,
  supervisor, and diagnostic redaction paths used by Xtream.

Acceptance:

- A local fixture and remote fixture produce the same normalized channel set.
- Oversized, malformed, unsupported, or unsafe playlist entries are bounded and
  skipped or rejected with sanitized counts.
- The renderer never receives a stored playlist URL, local file contents,
  authenticated playback URL, or scoped HTTP secrets.
- Xtream behaviour and stable channel selection remain unchanged.
- Clean TS and HLS channels from each source type pass the existing native
  playback baseline.

This slice provides one active source, not multi-source aggregation or polished
source management.

## 5. Slice 3 — Transport-aware bounded recovery

**Outcome:** TS and HLS follow distinct, bounded policies and authentication
failure never enters a retry loop.

Implementation:

- Separate continuous-TS reopen policy from HLS playlist/segment recovery.
- Add connection reset, timeout, HLS playlist stall, unavailable segment, and
  authentication-rejection schedules.
- Decide on an unavailable HLS segment within two seconds of request failure and
  resume from the earliest available decodable segment.
- Discard stale live buffers on recovery.
- Probe and record which reconnect options the pinned runtime actually consumes.
- Assign exactly one retry owner to every covered path.

Acceptance:

- Attempt delays, count, and wall-clock time never exceed versioned policy.
- Confirmed authentication rejection becomes terminal immediately.
- TS recovery does not claim HLS-style live-edge seeking.
- HLS recovery does not replay stale buffered content or remain permanently
  stalled.
- Clean TS, HLS, and AES-128 HLS remain green.

## 6. Slice 4 — Two-phase buffer and health model

**Outcome:** healthy playback moves from a low-readahead zap phase to a resilient
steady phase without treating ordinary jitter as failure.

Implementation:

- Pin and record the effective zap-phase mpv options.
- Enter steady state after confirmed first frame followed by five healthy
  seconds with advancing playback and no underrun or recovery event.
- Apply the versioned steady-state cache targets.
- Combine cache duration, paused-for-cache, playback progress, underrun, input
  rate, and process/IPC health into a supervisor observation.
- Expose a sanitized buffer-health snapshot for diagnostics.
- Reset phase and health history on zap or recovery.

Acceptance:

- Healthy playback changes phase exactly once per generation.
- A healthy 5–10 second buffer absorbs a brief input interruption without an
  unnecessary reopen.
- Zero progress with depleted/unhealthy buffering is detected within three
  seconds.
- Missing or approximate cache properties do not independently trigger
  recovery.

## 7. Slice 5 — Media discontinuity and corruption

**Outcome:** recoverable changes inside a live stream do not cause permanent
stall, desynchronization, or process failure.

Harness cases:

- PTS/DTS discontinuity
- mid-stream resolution and SPS change
- corrupt or partial media
- audio codec change
- wrong or absent Content-Type with probe fallback
- bandwidth throttling across the zap and steady phases

Acceptance follows the corresponding rows in PRD §7.1. Each case records fault,
detection, recovery, first-frame, and terminal timestamps, even when the correct
result is decoder reconfiguration rather than a supervisor reopen.

## 8. Slice 6 — Process and operating-system recovery

**Outcome:** process and platform disruptions produce bounded recovery or an
explicit controlled failure while the shell remains responsive.

Harness cases:

- mpv process crash
- unresponsive mpv/IPC hang
- Electron GPU-process restart
- Windows GPU device loss where safely reproducible
- sleep/resume
- network-interface change
- audio-device removal/change

Acceptance:

- mpv respawn begins within one second of confirmed crash/hang.
- The current generation reloads under the normal recovery budget.
- GPU-process loss and Windows device loss are treated separately.
- Window geometry, stacking, overlay state, and current playback are restored
  where the platform permits.
- No orphan process or reachable owned IPC endpoint remains after replacement or
  shutdown.

## 9. Slice 7 — Long-session and taxonomy gate

**Outcome:** the engine is daily-drivable and every applicable failure-taxonomy
row has repeatable evidence.

Implementation:

- Run four-hour-plus generated and real-viewing sessions.
- Track memory, handles, child processes, IPC health, A/V drift, frame drops,
  recovery attempts, and manual intervention.
- Produce a machine-readable taxonomy matrix linking every PRD §7.1 row to its
  fixture, expected bound, result, and sanitized evidence.
- Preserve private provider observations outside the repository while indexing
  their sanitized conclusions.

**M1 gate:**

- Every applicable PRD §7.1 row is green.
- Retry count and wall-clock bounds hold under repeated faults.
- Rapid zaps never allow stale recovery to become current.
- A full evening of real viewing completes without manual recovery.
- Long sessions show no monotonic memory/resource leak beyond PRD thresholds.
- Structured diagnostic output remains bounded and credential-safe.

## 10. Data utility-process boundary

Before EPG ingestion begins, extend the existing provider utility-process
boundary so future SQLite access, parsing, and refresh work cannot block
Electron main or delay playback recovery. M1 establishes and tests this boundary
but does not build the EPG or production source-management UI.

## 11. Explicitly deferred from M1

- EPG ingestion and grid
- polished source management, including multiple configured sources, active
  source selection, and singleton-record migration
- favourites, recents, search, and production navigation
- broad provider-dialect compatibility
- RTMP/RTSP recovery guarantees, UDP/SRT, and DRM
- installer signing, auto-update, and publication
- HDR, recording, catch-up, VOD, multi-source aggregation, and source failover
