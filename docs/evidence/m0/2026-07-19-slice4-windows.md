# M0a Slice 4 — native Windows overlay decision gate

| Field           | Result                                                                       |
| --------------- | ---------------------------------------------------------------------------- |
| Date            | 19 July 2026                                                                 |
| Status          | Partial — Path A selected; controller and monitor/DPI acceptance remain open |
| Source revision | `766ffbe` plus uncommitted Slice 4 working-tree changes                      |
| Native workflow | WSL source mirrored one-way to the managed native NTFS mirror                |
| Overlay result  | A — interactive Electron overlay; not yet claimable as a complete M0a Pass A |

## Fixed input and environment

- M0 controller at the start of Slice 4: none available; connection mode not applicable. The native present-device inventory exposed no HID or Bluetooth game controller, so controller acceptance was not executed or inferred.
- Available display environment: one monitor at 150% scale. No second monitor or distinct DPI mode was available for the five required round trips.
- Native Electron, Node, pnpm, Windows, GPU, driver, display, and audio environment: unchanged from the sanitized Slice 1–3 records.
- Runtime: the existing ignored, pinned, SHA-verified Windows x64 shinchiro runtime from Slices 2 and 3. It was not replaced or upgraded.
- mpv source commit: `304426c390901436fb1d4a63efbd582ae80c88f4`.
- FFmpeg source commit: `2576e09434d8026aab1769481b7b2fb43aa567c3`.

## Path A native result

- The transparent Electron overlay remained above the separately embedded mpv child while the shell was moved and resized repeatedly. It remained clipped and aligned with the native video host.
- Ten fullscreen enter/exit cycles completed across overlay-shown and overlay-hidden states without orphaning, inaccessible controls, or persistent stacking corruption.
- Ten Alt+Tab away/back cycles returned the owned shell/overlay pair together and controllable. Ten minimise/restore cycles returned both native layers without a manual reset.
- One display power-off/wake round trip returned to a controllable player; a post-wake Next intent became the asserted current generation.
- Ten required overlay show/hide and focus-transfer cycles completed without a manual window reset or application restart. The complete run recorded 14 focused shows, 22 hides, 16 transfers to the overlay, and 18 transfers back to the shell because additional lifecycle and feedback checks also exercised the path.
- Keyboard navigation passed independently. Native focus inspection showed `Next`, an ArrowLeft input moved focus to `Previous`, Enter issued the fixed Previous intent, and Escape returned focus to the shell.
- The explicit panel accepted pointer input. Moving the pointer outside the panel switched to OS-level pass-through and produced a distinct underlying native hit target.
- Fixed now/next placeholders were legible at the available 4K viewport. Immediate zap feedback and buffering/replacement recovery feedback were visible through the same narrow overlay-state path.
- Thirty rapid alternating playlist requests completed with generation 44 as the final requested and asserted current generation. The overlay remained usable afterward.
- Killing the owned mpv process left Electron responsive. The controlled replacement began after 440.7 ms wall time, used the verified executable and a fresh pipe, and accepted a post-replacement playback intent.
- The verified executable and HWND boundary passed. Checked private input and credential components were absent from process arguments and the sanitized persisted JSONL log.
- Normal close left no owned mpv process or reachable named pipe; the application orphan check passed.

An earlier ignored diagnostic run exposed a real focus-state defect: recovery feedback could downgrade an already focused overlay and allow auto-hide during lifecycle work. The focus rule was corrected, regression-tested, resynchronized, and the full available native matrix above was rerun from the beginning. No result from the diagnostic run is counted as acceptance.

## Path decision and rejected-path limitations

Path A is selected because it passed every row executable on the available native hardware, including the independent keyboard path, intentional pointer regions, focus return, lifecycle work, rapid changes, and replacement feedback.

Path B was not implemented or claimed as a native failure because the plan requires it only if Path A is not viable. It is rejected for this gate because its mpv OSD/script-message surface is passive and cannot provide the proven interactive Electron focus path or intentional pointer control regions. Choosing it would constrain the playback UI to minimal now/next and feedback presentation and would require a separate future interaction model for richer controls.

## Open acceptance and gate result

- Five round trips across every available monitor/DPI mode remain unobserved because only one monitor at one scale was available.
- Controller D-pad, accept, and back remain unobserved because no M0 controller was available. The standard mapping is unit-tested, but that does not replace native hardware acceptance.

The selected overlay result is **A**, but `nativeGateComplete` is false. A complete native M0a **Pass A** must not be claimed until both open rows are observed successfully. Results B and C were not selected.

## Verification boundary

- `nix flake check` passed.
- The frozen Nix-shell install and full verification passed: strict type-check, ESLint, 25 tests across 11 files, production build, and formatting.
- The same 25 tests, type-check, lint, build, and formatting passed after synchronization in the native NTFS mirror.
- Raw console output, JSONL, runtime snapshot, acceptance JSON, and host-only screenshots remain only in the ignored native `artifacts/m0/<run-id>/` tree.

No provider name, stream or playlist URL, credentials, headers, cookies, pipe name, process identifier, session identifier, username, machine-identifying native path, screenshot, copyrighted frame, or raw provider output is retained here.
