# M0a Slice 3 — native Windows embedding and lifecycle check

| Field           | Result                                                        |
| --------------- | ------------------------------------------------------------- |
| Date            | 19 July 2026                                                  |
| Status          | Partial — one-monitor environment left monitor/DPI row open   |
| Source revision | `eab91a0` plus uncommitted Slice 3 working-tree changes       |
| Native workflow | WSL source mirrored one-way to the managed native NTFS mirror |

## Environment and runtime

- Native environment: Windows 11, Node.js 24.18.0, pnpm 11.15.0, and Electron 43.1.1
- Available display environment: one monitor at 150% scale; no second monitor or distinct DPI mode was available for the required round trips
- Runtime: the existing ignored, pinned, SHA-verified Windows x64 shinchiro runtime from Slice 2; it was not replaced or upgraded
- mpv source commit: `304426c390901436fb1d4a63efbd582ae80c88f4`
- FFmpeg source commit: `2576e09434d8026aab1769481b7b2fb43aa567c3`

## Native acceptance result

- Independent inspection matched mpv's decimal `--wid` to a live Electron-owned native video-host HWND. mpv rendered as a child of that host rather than as a separate top-level player.
- Repeated move and resize checks kept video parented, clipped, and aligned. The run retained 84 sanitized settled-geometry samples.
- Ten consecutive fullscreen enter/exit cycles completed with ten recorded enter states and ten recorded leave states, with embedded video still present afterward.
- The five required round trips between available monitor/DPI modes were not executable because only one monitor/DPI environment was exposed. This is the sole unexecuted Slice 3 interaction-matrix row and prevents a native pass claim.
- Ten Alt+Tab away/back cycles and ten minimise/restore cycles returned to a controllable player without a manual window reset. All ten restores emitted settled geometry.
- One display power-off/wake round trip returned to a controllable application; a fixed Next intent after wake became the asserted current generation.
- Thirty rapid alternating playlist changes were recorded. The last request was generation 35, and only generation 35 was asserted current after the burst.
- The harness force-killed the owned mpv process. Electron remained responsive, scheduled its single controlled replacement attempt after 257.5 ms, began the replacement after 366.7 ms wall time, used a fresh unpredictable pipe, reconnected, and accepted a post-recovery Next request as generation 36.
- A separate scoped native check force-killed only Coax's Electron GPU child. Main logged the crash, reloaded the renderer, recorded settled `gpu-process-restored` geometry, resynchronized native stacking, and accepted a post-loss Next request as the new current generation. Normal close again left no owned mpv process or pipe.
- The verified bundled executable and native handle boundary passed. Checked private input and credential components were absent from process arguments and the sanitized persisted JSONL log.
- Normal Electron close left no owned mpv process and no reachable owned named pipe; the independent application orphan check passed.

## Open observations

- The monitor/DPI round-trip criterion remains open and must be rerun with every available monitor/DPI mode, including five round trips, before Slice 3 can be called a native pass.
- During the interaction work, one playlist entry repeatedly paused briefly and resumed, with matching sanitized `paused-for-cache` transitions. Changing to another channel cleared the visible symptom while geometry, generation handling, and shell responsiveness remained healthy. This is retained as source-entry-specific test-input behaviour consistent with the Slice 2 observation, not as an open Slice 3 embedding defect.

## Verification boundary

- The native interactive harness completed all available rows and deliberately returned a non-pass result because `monitorDpiRoundTrips` was skipped.
- Raw JSONL, console output, runtime snapshot, and host-only screenshots remain only under the ignored native `artifacts/m0/<run-id>/` tree.
- Final WSL/Nix and post-sync native verification outcomes are recorded in the handoff report for this working tree; this evidence record must not be upgraded to Pass unless the open monitor/DPI row is observed successfully.

No provider name, stream or playlist URL, credentials, headers, cookies, pipe name, process identifier, session identifier, username, machine-identifying native path, screenshot, copyrighted frame, or raw provider output is retained here.
