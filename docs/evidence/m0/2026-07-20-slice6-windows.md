# M0b Slice 6 — Hardware decode, adapter and 720p→4K VSR

| Field            | Result                                                                                      |
| ---------------- | ------------------------------------------------------------------------------------------- |
| Date             | 20 July 2026                                                                                |
| Status           | Partial — target D3D11VA/default path passed; NVDEC hardware and VSR confirmation rows open |
| Source revision  | `1cf028e5e13f827544af8bf8abdbadf4eee5d9a8` plus uncommitted Slice 6 working-tree changes    |
| Native workflow  | WSL source mirrored one-way to the managed native NTFS mirror                               |
| Controlled input | Locally generated 1280×720 progressive 50 fps H.264/AAC; ignored and not retained here      |

## Benchmark configuration

This configuration was recorded at the start of native work. Changing any value starts a new result series.

| Component                          | Configuration                                                             |
| ---------------------------------- | ------------------------------------------------------------------------- |
| Windows                            | Windows 11 Home, build 26200                                              |
| GPU and driver                     | NVIDIA GeForce RTX 5080, driver 32.0.16.1062                              |
| Display                            | LG ULTRAGEAR+, 3840×2160 at 240 Hz                                        |
| Audio output                       | Headphones (HyperX Cloud Alpha Wireless)                                  |
| Electron / embedded Node           | 43.1.1 / 24.18.0                                                          |
| mpv                                | v0.41.0-744-g304426c39; commit `304426c390901436fb1d4a63efbd582ae80c88f4` |
| FFmpeg                             | N-124930-g2576e0943; commit `2576e09434d8026aab1769481b7b2fb43aa567c3`    |
| Source tree at native series start | Dirty with uncommitted Slice 6 changes; the handoff base had been clean   |

No device serial, display serial, pipe name, process/session identifier, machine username, or provider value is retained.

## Architecture and diagnostics result

- Electron requests the high-performance GPU before readiness and records a sanitized active GPU model, driver, hardware-acceleration state, and video-decode feature state. The native run identified the RTX 5080 as active with hardware acceleration and video decode enabled.
- The verified pinned mpv runtime enumerated three D3D11 configuration adapters: NVIDIA GeForce RTX 5080 as adapter 0 and OS/mpv default, AMD Radeon(TM) Graphics as adapter 1, and Microsoft Basic Render Driver as adapter 2. Coax selects the RTX by description when a different adapter is first; no explicit override was needed on this series.
- All profiles use `gpu-next` with the D3D11 API/context, software fallback enabled, and the vendor-neutral `ewa_lanczossharp` scaler. Profiles differ only in requested decoder and whether the NVIDIA scaling request is eligible.
- Scaling is requested only when both decoded source dimensions are smaller than the actual mpv video viewport. The bounded factor is the smaller viewport/source ratio, capped at 4. A labeled D3D11VPP filter uses the pinned build's tested `scale=<factor>:scaling-mode=nvidia` syntax.
- Source and output sizes, real viewport, requested decoder, actual `hwdec-current`, decoder, VO/context, requested state, labeled-filter attachment, scale factor, and confirmation state are structurally logged. No provider input is used by this harness.
- Diagnostics always separate requested, attached, and confirmed states. The pinned filter exposes attachment and successful option handling but no reliable signal that NVIDIA's enhancement processed a frame. Every native result therefore records `vsrConfirmed: false` and confirmation signal `unavailable`; this evidence does not call VSR active.
- IPC command bursts now treat Node writable backpressure correctly: a `write()` return of false means buffered, not rejected. A native diagnostic burst had previously surfaced an unhandled `mpv-not-ready` dialog despite healthy playback; the corrected built-app rerun completed without that exception, and focused tests cover buffered and synchronously failed writes.

## Adapter and profile comparison

Each profile used the same clean local 720p50 source, 4K display mode, and actual mpv viewport of 3839×2160. mpv's observed viewport was one pixel narrower than the display mode, so the computed factor was 2.999219 rather than an assumed 3.0.

| Profile    | Requested / actual decode | Render path      | Scaling state                              | Warm VO drops | Final VO drops | Decoder-drop delta | Playback advance | Recovery / scaler failure | Result                                                 |
| ---------- | ------------------------- | ---------------- | ------------------------------------------ | ------------: | -------------: | -----------------: | ---------------: | ------------------------- | ------------------------------------------------------ |
| `d3d11va`  | `d3d11va` / `d3d11va`     | `gpu-next/d3d11` | requested, attached, unconfirmed; 2.999219 |             6 |              6 |                  0 |           35.1 s | 0 / 0                     | Hardware path passed                                   |
| `nvdec`    | `nvdec` / `no`            | `gpu-next/d3d11` | requested, attached, unconfirmed; 2.999219 |             7 |              7 |                  0 |           35.1 s | 0 / 0                     | Playable fallback observed; NVDEC hardware unavailable |
| `software` | `no` / `no`               | `gpu-next/d3d11` | VSR disabled; fallback scaler              |             0 |              0 |                  0 |           35.1 s | 0 / 0                     | Software baseline passed                               |

All three runs shut down cleanly. The D3D11VA mpv process moved from 144.7 to 143.6 MiB working set, 256.9 to 291.8 MiB private memory, 833 to 773 handles, and 1.14 to 2.98 CPU seconds over the sampled run. NVDEC requested under D3D11 reported `hwdec-current=no`; an isolated pinned-mpv probe also reported that CUDA hardware decode requires an OpenGL or Vulkan backend, so the required D3D11 render/VSR direction cannot claim NVDEC hardware decode. The software fallback remained playable, but the second supported hardware-path comparison is open.

`d3d11va` is the selected default because it is the only compared profile that actually used hardware decode while preserving the required `gpu-next/d3d11` render path and attached scaling request. It also used fewer sampled CPU seconds than either software-decoded run. No Electron or mpv version, runtime artifact, render API, or product boundary was changed to manufacture an NVDEC pass.

## Ten-minute dropped-frame and resource result

After a 30-second warm-up, the selected D3D11VA profile ran the clean local 720p50 source into the 4K display for the full ten-minute measurement. The result recorded:

- `hwdec-current=d3d11va`, decoder `h264`, and render path `gpu-next/d3d11`;
- decoded source 1280×720, D3D11VPP output 3840×2160, actual viewport 3839×2160, and bounded factor 2.999219;
- VSR requested and the labeled D3D11VPP filter attached, but VSR unconfirmed with no confirmation signal;
- playback-time advance 625.9 seconds across the sampled run;
- renderer/VO drop counter 6 after warm-up and 6 at the end: delta 0;
- decoder drop delta 0, recovery events 0, and scaler-command failures 0;
- 126 resource samples; first/last mpv working set 143.6/142.8 MiB, private memory 256.3/291.1 MiB, handles 839/774, and CPU time 1.17/30.98 seconds; and
- clean application shutdown with no live owned mpv process or reachable private pipe.

The six renderer drops preceded the warm-up baseline and did not increase during the measured interval. The source was generated locally, so no network/provider drop attribution was involved.

## Resolution-change and forced-fallback results

- **Resolution and viewport changes: pass.** The observed graph moved from 1280×720/fullscreen factor 2.999219 to 1280×720/windowed factor 1.369444; disabled for 1920×1080 into 1898×986 and 1418×716 viewports; remained disabled when 1280×720 was taller than the 1418×716 viewport; then reattached at a transient fullscreen factor 2.945833 and converged on 2.999219 at 3839×2160. Final diagnostic states matched each stable source/viewport state. There were no scaler-command failures, broken graph, recovery event, or stale final factor.
- **Forced hardware-decode failure: pass.** A local 1280×720 50 fps H.264 yuv444p fixture requested D3D11VA but reported actual `hwdec-current=no`, continued with the H.264 software decoder, advanced playback by 15.0 seconds, retained the D3D11 render path, recorded zero recovery/scaler failures, and shut down cleanly. This is a fallback result, not a hardware-decode claim.

## Commands and outcomes

WSL/Nix:

- `nix develop -c bash -lc './scripts/create-slice6-fixtures.sh'` — passed; generated the three controlled fixtures directly under the ignored native artifact tree and reported the expected codecs, dimensions, pixel formats, and 50 fps rate.
- `nix flake check` — passed.
- `nix develop -c bash -lc 'corepack pnpm install --frozen-lockfile && corepack pnpm verify'` — passed; frozen dependencies remained current and strict type-check, ESLint, 45 tests across 20 files, production build, and formatting passed.
- `nix develop -c bash -lc './scripts/sync-windows.sh'` — passed; preserved ignored native fixtures, runtime, dependencies, and raw artifacts.

Native Windows:

- `scripts/windows-bootstrap-check.ps1 -SkipInstall` — passed strict type-check, ESLint, 45 tests, production build, Electron version validation, and the self-terminating smoke launch.
- `scripts/windows-slice6-acceptance.ps1 -SkipInstall -Mode Compare ...` — passed the available profile rows and recorded NVDEC hardware as unavailable.
- `scripts/windows-slice6-acceptance.ps1 -SkipInstall -Mode Resolution ...` — passed source/viewport recomputation, disable, reattachment, and shutdown rows.
- `scripts/windows-slice6-acceptance.ps1 -SkipInstall -Mode Fallback ...` — passed playable forced software fallback and shutdown rows.
- `scripts/windows-slice6-acceptance.ps1 -SkipInstall -Mode Soak -SoakProfile d3d11va ...` — passed the required warm-up plus ten-minute local 720p50→4K measurement.

The final acceptance runs launched the production build directly rather than retaining development servers between profile legs. Raw output remained only under ignored native artifact directories.

## Gate and open criteria

The Slice 6 outcome — **“the target RTX 5080 path is measured and a safe default is selected”** — is achieved for the D3D11VA default. Every available native acceptance row passed. The Slice 6 result remains **Partial**, not Pass, because the handoff requires unavailable native rows to remain explicit:

- NVDEC was requested and its playable software fallback was observed, but the pinned build cannot expose NVDEC hardware decode through the required D3D11 render path. No NVDEC hardware-path comparison pass is claimed.
- No reliable VSR confirmation signal was available. The scaling request and labeled D3D11VPP attachment are observed, but VSR is not described as active or confirmed.

The inherited open rows remain unchanged:

- M0a controller D-pad, accept, and back are unobserved because no M0 controller was available.
- M0a five round trips across every available monitor/DPI mode are unobserved because only one 150% display was available.
- Slice 5 native invalid-credential rejection/no-retry and its native failure-path redaction scan remain unobserved; focused synthetic coverage passes.

Slices 7 and 8 have not begun. The overall M0b gate remains scheduled after Slice 8 and is not evaluated or claimed here.

Raw console output, adapter output, resource samples, fixture media, native build output, acceptance JSON/JSONL, screenshots, runtime downloads, and dependency/build trees remain only under ignored native paths. No provider data, URL, credential, token, cookie, header, pipe name, unique hardware identifier, process/session identifier, machine username, copyrighted frame, executable, DLL, archive, or raw evidence is retained here.
