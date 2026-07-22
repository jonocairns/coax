# M0a Slice 2 — native Windows first-frame check

| Field           | Result                                                        |
| --------------- | ------------------------------------------------------------- |
| Date            | 19 July 2026                                                  |
| Status          | Pass                                                          |
| Source revision | `625db0b` plus uncommitted Slice 2 working-tree changes       |
| Native workflow | WSL source mirrored one-way to the managed native NTFS mirror |

## Environment and runtime

- Native environment: Windows 11 Home build 26200, Windows PowerShell 5.1.26100.8875, Node.js 24.18.0, pnpm 11.15.0, and Electron 43.1.1
- GPU, driver, display, and audio environment: unchanged from the sanitized Slice 1 record
- Runtime: the ignored bundled baseline Windows x64 shinchiro archive, verified before extraction as 32,691,385 bytes with SHA-256 `facac536baa73c7b925771af5e39a3c9cb16b8d75b59a6e9800de89799dffca7`
- mpv: `v0.41.0-744-g304426c39`, full source commit `304426c390901436fb1d4a63efbd582ae80c88f4`
- FFmpeg: `N-124930-g2576e0943`, full source commit `2576e09434d8026aab1769481b7b2fb43aa567c3`

## Native acceptance result

- The verified bundled `mpv.exe` spawned without relying on system mpv and connected to an unpredictable per-process Windows named pipe.
- Electron sent the private playlist only through a post-connect `loadfile` JSON IPC command. The authenticated URL and checked credential components were absent from the native process command line and sanitized persisted JSONL log.
- Visible video and audible audio were confirmed interactively.
- Captured mpv events included `start-file`, `file-loaded`, `playback-restart`, `video-reconfig`, `audio-reconfig`, and `end-file`, followed by process exit.
- Three generation-incrementing Next requests were sent using the fixed mpv internal-playlist command. Multiple playlist entries played sufficiently to distinguish the original entry's brief play/freeze pattern from the other tested entries.
- The fixed `paused-for-cache` observation reported `false` in the retained samples; no cache-pause transition was observed during the successfully viewed entries.
- mpv exited with status 0. After Electron closed, independent checks found no mpv process and no reachable named pipe.
- One diagnostics-only bookkeeping field initially reported the application orphan check as false because the sanitizer redacted the boolean field named `pipeReachable`. The independent pipe check itself passed. The sanitizer was corrected after the run to preserve non-string booleans while continuing to redact sensitive strings, with automated regression coverage.

## Verification

- Final WSL/Nix install, type-check, lint, 13 focused tests across six files, production build, and formatting passed.
- The same type-check, lint, tests, build, and formatting passed in the final native Windows mirror.
- PowerShell syntax parsing, runtime fetch/reverification, ShellCheck, and whitespace checks passed.

Raw console output and structured logs remain in the ignored native `artifacts/m0/<run-id>/` tree. No provider name, stream or playlist URL, credentials, headers, cookies, pipe name, username, machine-identifying path, screenshot, copyrighted frame, or raw provider output is retained here.
