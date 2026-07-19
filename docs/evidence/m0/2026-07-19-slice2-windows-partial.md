# M0a Slice 2 — native Windows partial check

| Field           | Result                                                        |
| --------------- | ------------------------------------------------------------- |
| Date            | 19 July 2026                                                  |
| Status          | Partial — runtime/build pass; first-frame acceptance not run  |
| Source revision | `625db0b` plus uncommitted Slice 2 working-tree changes       |
| Native workflow | WSL source mirrored one-way to the managed native NTFS mirror |

## Environment

- Windows 11 Home, build 26200, 64-bit
- Windows PowerShell 5.1.26100.8875
- Git 2.51.1.windows.1
- Node.js 24.18.0, Corepack 0.35.0, pnpm 11.15.0
- Electron 43.1.1 with embedded Node 24.18.0 and Chromium 150.0.7871.114
- GPU, driver, display, and audio environment remain as recorded in the sanitized Slice 1 evidence; playback was not started in this partial check

## Pinned runtime

- Upstream-recognized but unofficial builder: `shinchiro/mpv-winbuild-cmake`
- Artifact: baseline Windows x64 standalone archive `mpv-x86_64-20260610-git-304426c.7z`
- Immutable release asset: `20260610`, not a `latest` alias
- Size: 32,691,385 bytes
- SHA-256: `facac536baa73c7b925771af5e39a3c9cb16b8d75b59a6e9800de89799dffca7`
- Build-project commit: `5efd298cb51513c2410e4e9029b5e56b83c2aaac`
- Successful build workflow: `27243718577`, Clang/MinGW-w64, baseline x86-64 with package LTO
- mpv: `v0.41.0-744-g304426c39`, full source commit `304426c390901436fb1d4a63efbd582ae80c88f4`, built 10 June 2026
- FFmpeg: `N-124930-g2576e0943`, full source commit `2576e09434d8026aab1769481b7b2fb43aa567c3`
- Reported FFmpeg libraries: libavcodec 62.36.101, libavformat 62.19.101, libavfilter 11.17.100, libavutil 60.33.100, libswresample 6.4.100, libswscale 9.8.100

## Results

- The checked-in PowerShell fetcher downloaded the exact manifest URL, verified SHA-256 and size before extraction, and extracted with native Windows `tar.exe`.
- The runtime was installed only into the ignored native `runtime/mpv/bin/windows-x64` tree. Invoking that exact bundled `mpv.com --version` produced the versions above; no system mpv was used.
- The native bootstrap passed frozen install, strict TypeScript checking, ESLint, all 11 tests across six files, production build, Electron executable version, and the self-terminating development-window smoke launch.
- The acceptance harness correctly stopped before launch with exit status 2 because the ignored `config/local/playback.json` did not exist. It printed the exact local path and safe one-field schema without asking for a URL in chat.

## Open Slice 2 acceptance

No stream was supplied, so this document does **not** claim visible video, audible audio, lifecycle/reconfiguration/end-event capture during playback, process-argument/log redaction against a real private URL, or post-playback process/pipe cleanup. Run the checked-in interactive acceptance harness after populating the ignored local input, then replace or supplement this partial record with a reviewed sanitized pass/fail summary. Raw output remains ignored under `artifacts/m0/<run-id>/`.

No provider data, stream URL, credentials, headers, cookies, screenshots, usernames, machine-identifying filesystem paths, or copyrighted frames are retained here.
