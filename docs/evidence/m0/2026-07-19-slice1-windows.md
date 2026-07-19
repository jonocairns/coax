# M0a Slice 1 — native Windows foundation check

| Field           | Result                                                            |
| --------------- | ----------------------------------------------------------------- |
| Date            | 19 July 2026                                                      |
| Status          | Pass                                                              |
| Source revision | `ab829b6` (`initial commit`)                                      |
| Source worktree | Dirty; the Electron postinstall repair was not committed          |
| Native workflow | Clean dependency state staged onto NTFS from the WSL working tree |

## Environment

- Windows 11 Home, build 26200, 64-bit
- Windows PowerShell 5.1.26100.8875
- Git 2.51.1.windows.1
- Node.js 24.18.0
- Corepack 0.35.0
- pnpm 11.15.0
- Electron 43.1.1
- Electron embedded Node 24.18.0
- Chromium 150.0.7871.114
- NVIDIA GeForce RTX 5080, driver 32.0.16.1062, reporting 3840×2160 at 240 Hz
- AMD Radeon Graphics, driver 32.0.21030.2001
- Healthy audio devices were enumerated; the default audio route was not determined during this foundation check
- Windows mpv/FFmpeg runtime, decoder, output, adapter, and upscaler: not applicable because runtime selection and playback begin in Slice 2

## Command

The checked-in `scripts/windows-bootstrap-check.ps1` was run from native Windows PowerShell against the clean NTFS staging directory. Because Windows Node was installed after the active WSL session started, `C:\Program Files\nodejs` was prepended to that one child PowerShell process without changing system configuration.

## Results

- Windows, architecture, Git, Node major, Corepack, and pnpm prerequisite checks passed.
- `pnpm install --frozen-lockfile` passed from a clean dependency state.
- The project postinstall downloaded and verified Electron 43.1.1 locally.
- Strict TypeScript checking passed.
- ESLint passed with zero warnings.
- Vitest passed: one test file and one BrowserWindow security test.
- The electron-vite production build passed for main, CommonJS preload, and renderer outputs.
- The native Electron executable reported version 43.1.1.
- The development Electron app reached `ready-to-show`, emitted the sanitized `coax-smoke-ready` event, and exited cleanly with status 0.
- Port 5173 was already occupied by the WSL HMR session, so electron-vite selected port 5174 automatically.

No provider data, stream URLs, credentials, headers, cookies, screenshots, usernames, or machine-identifying filesystem paths are retained in this summary.
