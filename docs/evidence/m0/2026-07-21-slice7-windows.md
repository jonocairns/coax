# M0b Slice 7 — Sports motion baseline

| Field            | Result                                                                                                    |
| ---------------- | --------------------------------------------------------------------------------------------------------- |
| Date             | 21 July 2026                                                                                              |
| Status           | Partial — implementation and automated native rows passed; visual observations and the 30-minute row open |
| Source revision  | `3430681b7826ba36b32d960b21d171f0d14f76ab` plus uncommitted Slice 7 working-tree changes                  |
| Native workflow  | WSL source mirrored one-way to the managed native NTFS mirror                                             |
| Controlled input | Locally generated legal fixtures; ignored media is not retained here                                      |

## Benchmark configuration and available inputs

Sports fixtures changed the source configuration, so this is a new Slice 7 result series rather than a reuse of Slice 6 results.

| Component                | Configuration                                                             |
| ------------------------ | ------------------------------------------------------------------------- |
| Windows                  | Windows 11 Home, build 26200                                              |
| GPU and driver           | NVIDIA GeForce RTX 5080, driver 32.0.16.1062                              |
| Display                  | LG ULTRAGEAR+, 3840×2160 at 240 Hz                                        |
| Audio output             | Headphones (HyperX Cloud Alpha Wireless)                                  |
| Electron / embedded Node | 43.1.1 / 24.18.0                                                          |
| mpv                      | v0.41.0-744-g304426c39; commit `304426c390901436fb1d4a63efbd582ae80c88f4` |
| FFmpeg                   | N-124930-g2576e0943; commit `2576e09434d8026aab1769481b7b2fb43aa567c3`    |
| Source state             | Dirty with uncommitted Slice 7 changes                                    |

At native-work start, only the inherited controlled Slice 6 720p50 fixture was present. No legally usable real sports source was declared, and no private provider input was accessed. The Slice 7 generator then created ignored 720p50, 720p59.94, 576i50 TFF/BFF, 1080i50 TFF/BFF, intentionally wrong-metadata, and long-run fixtures directly in the native artifact tree. No real-viewing notes are claimed.

## Deinterlacing and diagnostics decisions

- The selected hardware path remains Slice 6's `d3d11va` decode with `gpu-next/d3d11`; adapter selection, software decode fallback, generation handling, and viewport-aware scaling remain intact.
- The pinned runtime's tested D3D11VPP syntax uses `deint=yes:mode=adaptive:parity=auto|tff|bff`. Adaptive mode is selected because the pinned implementation produces field-rate output. Explicit parity also disables `interlaced-only` so bad metadata cannot prevent the override from being applied.
- Scaling and deinterlacing share one owned, labeled graph. `vf set` atomically replaces that graph; generation and graph-revision checks reject stale results. Source, viewport, field-policy, or eligibility changes cannot accumulate duplicate owned filters. Every final native result reported zero duplicate owned filters.
- A failed D3D11VPP graph transitions to a labeled software `bwdif=mode=send_field:parity=...:deint=...` graph. If that graph also fails, Coax clears its owned graph and preserves playback instead of making the filter error terminal.
- Samples cover output/container/display rates, renderer and decoder drops, mistimed and delayed frames, repeat flags, A/V sync and cumulative correction, playback time, frame field metadata, graph command outcomes, and source/filter reconfiguration. Mistimed-frame counts were unavailable because these runs did not use display-sync; they are not reported as zero.
- VSR remains requested/attached/unconfirmed where eligible. This evidence does not relabel it active or confirmed.

## Controlled fixture results

All short runs used the pinned production build, D3D11VA hardware decode, `gpu-next/d3d11`, the attached adaptive D3D11VPP graph, a 10-second warm-up, 22 post-warm-up samples, no recovery or manual recovery, and clean process/pipe shutdown.

| Fixture     | Metadata observed | Override | Median output | VO / decoder / delayed delta | Repeat samples | Max absolute A/V sync | Result                                                  |
| ----------- | ----------------- | -------- | ------------- | ---------------------------- | -------------- | --------------------- | ------------------------------------------------------- |
| 720p50      | n/a (progressive) | auto     | 50 fps        | 0 / 0 / 0                    | 0              | 0.010 ms              | Expected measured cadence; visual smoothness unobserved |
| 720p59.94   | n/a (progressive) | auto     | 59.94 fps     | 0 / 0 / 0                    | 0              | 0.008 ms              | Expected measured cadence; visual smoothness unobserved |
| 576i50 TFF  | TFF               | auto     | 50 fps        | 0 / 0 / 0                    | 0              | 0.011 ms              | Measured field rate; combing/judder unobserved          |
| 576i50 BFF  | BFF               | auto     | 50 fps        | 0 / 0 / 0                    | 0              | 0.011 ms              | Measured field rate; combing/judder unobserved          |
| 1080i50 TFF | TFF               | auto     | 50 fps        | 0 / 0 / 0                    | 0              | 0.007 ms              | Measured field rate; combing/judder unobserved          |
| 1080i50 BFF | BFF               | auto     | 50 fps        | 0 / 0 / 0                    | 0              | 0.007 ms              | Measured field rate; combing/judder unobserved          |

The automated observations establish expected output rate, stable counters, bounded sampled A/V sync, graph attachment, and correct metadata reporting. They do not establish visual cadence, absence of combing/judder, or correct field motion.

## Wrong-field-order and fallback results

The 576i fixture contains TFF motion labeled BFF. Auto mode observed BFF; the explicit TFF override attached with `interlaced-only=no`. The 1080i fixture contains BFF motion labeled TFF. Auto mode observed TFF; the explicit BFF override attached with `interlaced-only=no`. All four legs produced 50 fps median output, zero renderer/decoder/delayed-frame deltas, zero repeat samples, no recovery, and clean shutdown. This proves the mismatch is structurally diagnosable and the intended override reaches the graph. The visible wrong-order defect and visually corrected motion were not observed, so that acceptance row remains open.

A forced D3D11VPP command failure was observed and the software `bwdif` fallback attached. Playback advanced 52.2 seconds, renderer/decoder/delayed-frame deltas remained zero, no recovery was needed, and shutdown was clean, so the forced hardware-deinterlacing failure did not become terminal. The fallback reported 25 fps rather than the requested 50 fps field rate, and visual playability was not observed. It is a playable-continuation result, not a field-rate-quality pass.

## Interrupted long-run result

The requested 30-minute sports run was stopped at the user's direction after approximately 23.6 minutes, so the 30-minute acceptance row is **open**. Across the available post-warm-up diagnostic window:

- 689 cadence samples remained exactly 50 fps;
- renderer-drop counter remained 6 to 6, decoder-drop counter 0 to 0, and delayed-frame counter 0 to 0;
- no sampled frame had its repeat flag set;
- A/V sync stayed between 0.001 and 0.030 ms, cumulative correction was effectively unchanged, and playback time advanced 1382.3 seconds;
- the final observed path was D3D11VA, `gpu-next/d3d11`, and D3D11VPP with zero duplicate owned filters; and
- no recovery event occurred.

Because the parent harness was interrupted, it did not serialize its in-memory resource samples or final orphan/pipe check. Six scoped Electron/mpv processes under the managed native mirror remained after interruption; they were explicitly stopped, and a follow-up scoped process query found zero remaining. No 30-minute, resource-growth, or clean-shutdown pass is claimed from this run.

## Commands and outcomes

WSL/Nix and source-to-native workflow:

- `nix develop -c bash -lc './scripts/create-slice7-fixtures.sh'` — generated the controlled native-only fixtures; the corrected verifier accepted the pinned container's 59.94 rational within 0.01 fps and verified all nine fixtures.
- `nix flake check` — passed before native acceptance.
- `nix develop -c bash -lc 'corepack pnpm install --frozen-lockfile && corepack pnpm verify'` — final verification passed strict type-check, ESLint, 53 tests across 23 files including focused Slice 7 structural redaction, production build, and formatting.
- `nix develop -c bash -lc './scripts/sync-windows.sh'` — passed and preserved ignored native fixtures, raw artifacts, runtime, and dependencies.

Native Windows:

- `scripts/windows-bootstrap-check.ps1 -SkipInstall` — final run passed native type-check, lint, all 53 tests, production build, Electron version validation, and self-terminating smoke launch.
- `scripts/windows-slice7-acceptance.ps1 -SkipInstall -SkipVisualChecks -Mode Record ...` — recorded the benchmark and available inputs before fixture generation.
- Modes `Progressive`, `Interlaced`, `WrongFieldOrder`, and `Fallback` — completed the automated rows described above; visual prompts were deliberately recorded as unobserved.
- Mode `Soak` — manually interrupted after approximately 23.6 minutes; partial diagnostics are reported above and the required 30-minute row remains open.

Raw output remained only under ignored native artifact directories. Final verification is recorded at handback rather than inferred here.

## Gate and open criteria

The Slice 7 build is implemented, but the outcome — **“the player is credible for the content that matters most, not merely for progressive test clips”** — remains **Partial** because required observations are open:

- progressive smooth expected cadence was not visually observed;
- 576i50 and 1080i50 stable field-rate motion without persistent combing or judder was not visually observed;
- the intentionally wrong field order and visually recovered explicit override were not observed;
- forced fallback advanced playback, but its visual playability was unobserved and its measured output was 25 fps rather than field rate; and
- the required 30-minute no-recovery/drift/drop/repeat/resource-growth run was interrupted, with resource and final shutdown aggregates unavailable.

Inherited open rows are unchanged: M0a controller D-pad/accept/back; M0a multi-monitor/DPI round trips; Slice 5 native invalid-auth/no-retry and native failure-path redaction; Slice 6 NVDEC hardware decode under D3D11 and actual VSR confirmation. Slice 8 has not begun, and the M0b gate is not evaluated.

No provider data, URL, credential, token, cookie, header, pipe name, unique hardware identifier, process/session identifier, machine username, copyrighted frame, executable, DLL, archive, raw log, raw JSON, or runtime/dependency tree is retained here.
