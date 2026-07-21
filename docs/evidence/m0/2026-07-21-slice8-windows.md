# M0b Slice 8 — Clean-stream harness and diagnostics baseline

| Field            | Result                                                                                   |
| ---------------- | ---------------------------------------------------------------------------------------- |
| Date             | 21 July 2026                                                                             |
| Status           | Partial — automated native rows passed; human visible-video/audible-audio checks open    |
| Source revision  | `291ef662b4bf9ef7b4fa0bb4eb896b9078d0ef1a` plus uncommitted Slice 8 working-tree changes |
| Native workflow  | WSL source mirrored one-way to the managed native NTFS mirror                            |
| Controlled input | Generated clean fixtures only; no provider/private input was accessed                    |

## Architecture and contract

- The Nix-hosted Node/FFmpeg process bound on all WSL interfaces and was reachable from native Windows through loopback on the configured fixed port. It serves generated H.264/AAC continuous MPEG-TS, live HLS, and standard AES-128 HLS.
- Player-facing paths are fixed at `/v1/stream/ts`, `/v1/stream/hls/index.m3u8`, and `/v1/stream/hls-aes/index.m3u8`. Public hosts, credentials, query strings, fragments, path/fixture mismatches, and unsupported protocols are rejected before playback.
- The fixture and result contracts are version 1, `coax-clean-stream-v1`. Clean results carry `faultSchedule: null`; M1 can add a fault schedule without changing the player paths or baseline result fields.
- Electron main remains the only owner of the mpv child and private IPC connection. Slice 8 adds no retry state machine, buffer policy, fault injection, or renderer access.
- Each playback generation records start, request, first-frame (`playback-restart`), confirmed playback (the first subsequent numeric playback-time sample), shutdown start, and shutdown completion as ISO timestamps plus monotonic elapsed milliseconds.

## Clean native baseline

The final automated run used the unchanged pinned Electron 43.1.1 and SHA-verified shinchiro Windows x64 runtime. It skipped human visual/audio prompts, so each case is recorded as `open` despite the machine playback evidence below. Every case reached `playback-restart`, advanced playback for approximately 18 seconds, recorded zero recovery events, and left no owned mpv process or reachable pipe.

| Case          | Run | Request → first frame | First frame → playback sample | Playback advance | Shutdown | Machine result       |
| ------------- | --: | --------------------: | ----------------------------: | ---------------: | -------: | -------------------- |
| Clean MPEG-TS |   1 |             1124.0 ms |                      590.0 ms |           18.1 s | 961.0 ms | Pass; human A/V open |
| Clean MPEG-TS |   2 |             1195.0 ms |                      516.0 ms |           18.1 s | 978.0 ms | Pass; human A/V open |
| Clean HLS     |   1 |              798.0 ms |                      901.0 ms |           18.1 s | 982.0 ms | Pass; human A/V open |
| Clean HLS     |   2 |              823.0 ms |                      868.0 ms |           18.1 s | 981.0 ms | Pass; human A/V open |
| AES-128 HLS   |   1 |              846.0 ms |                      849.0 ms |           18.0 s | 983.0 ms | Pass; human A/V open |

Repeated request-to-first-frame timings were comparable under the committed harness sanity rule: TS averaged 1159.5 ms with a 71 ms spread; HLS averaged 810.5 ms with a 25 ms spread. This is a clean baseline distribution, not the M2 p95 benchmark or a playback-latency product claim.

## AES-128 and diagnostics confidentiality

- The Nix FFmpeg 8.1.2 HLS muxer exposed `hls_key_info_file`; the generated encrypted playlist used `METHOD=AES-128`, a 16-byte generated key, and an unpredictable key resource path. Native mpv machine playback advanced 18.0 seconds.
- The key bytes, key resource URL, player URL, and request data were absent from persisted Electron diagnostics. Generated key material, playlists, segments, proxy output, and raw results remain only under ignored artifact paths.
- Native focused redaction tests passed all nine checks across the Slice 8 and established mpv-redaction suites. Scenarios cover normal playback, authentication rejection, network failure, and raw mpv output. The retained playback output contained no HTTP(S) URL.
- The application logger rotates before 2 MiB and retains four JSONL files per run (8 MiB maximum). The proxy independently rotates before 1 MiB and retains four files (4 MiB maximum). The rotation test verified byte bounds, oldest-file removal, and redaction before append.

## Pinned networking and reconnect-option probe

The actual pinned binary exposes no `curl-*` option, so its compiled HTTP backend is FFmpeg/libavformat rather than mpv's optional libcurl backend. This matches the pinned build/source configuration and was not changed.

The bounded verbose native probe supplied a known-unknown sentinel and observed `Could not set AVOption` for that sentinel, proving rejection was observable rather than silently inferred. The following pinned FFmpeg HTTP AVOptions were consumed both through top-level `stream-lavf-o` for continuous TS and propagated `demuxer-lavf-o` for nested HLS requests:

- `reconnect`
- `reconnect_at_eof`
- `reconnect_on_network_error`
- `reconnect_on_http_error`
- `reconnect_streamed`
- `reconnect_delay_max`
- `reconnect_max_retries`
- `reconnect_delay_total_max`
- `respect_retry_after`

The live probes were deliberately terminated at their ten-second diagnostic bound, so their process exit status reflects harness termination. This proves option syntax and runtime consumption only. No reconnect option was enabled in the player, and no reconnect/recovery behavior is claimed before M1 fault cases establish ownership and outcomes.

Primary source checks used the exact pinned revisions: [mpv networking/options documentation](https://github.com/mpv-player/mpv/blob/304426c390901436fb1d4a63efbd582ae80c88f4/DOCS/man/options.rst), [mpv libavformat stream option handling](https://github.com/mpv-player/mpv/blob/304426c390901436fb1d4a63efbd582ae80c88f4/stream/stream_lavf.c), [mpv nested demux option propagation](https://github.com/mpv-player/mpv/blob/304426c390901436fb1d4a63efbd582ae80c88f4/demux/demux_lavf.c), and [FFmpeg HTTP AVOptions](https://github.com/FFmpeg/FFmpeg/blob/2576e09434d8026aab1769481b7b2fb43aa567c3/libavformat/http.c).

## Actual named-pipe DACL

The acceptance process opened the actual live mpv IPC pipe with `READ_CONTROL` and inspected its owner and DACL in memory. The sanitized result was:

- owner class: current user;
- allow ACEs: one;
- write-capable allow ACEs: one;
- write identity classes: current user only; and
- broader authenticated-user, world, or other write access: none.

The required ACL row passes. No SID, pipe name, access-control dump, process/session identifier, or native helper output is retained. The pinned mpv source independently shows a restricted descriptor granting generic read/write to the current user with a mandatory integrity label. A parent-created pipe or helper is not required for this pinned build; any future runtime upgrade must repeat the actual DACL inspection.

## Commands and outcomes

WSL/Nix and source-to-native workflow:

- The live server smoke verified TS, HLS, and AES-128 HLS as H.264/AAC with generated 640×360 video at 25 fps; the AES playlist/key shape passed without printing key material.
- `nix flake check` and the final frozen full verification are recorded at handback.
- `nix develop -c bash -lc './scripts/sync-windows.sh'` passed and preserved native runtime, dependencies, ignored results, and local inputs.

Native Windows:

- The final acceptance invocation ran the two focused redaction files (nine tests), built the production application, reached the Nix/WSL health contract, executed two TS runs, two HLS runs, one AES-128 HLS run, probed the actual pinned networking paths, inspected the actual pipe DACL, and completed without an owned-process/pipe orphan.
- A final clean native bootstrap verification is recorded at handback; it is not inferred from the acceptance build.

## Status, gate, and open criteria

The Slice 8 implementation outcome — **“the first usable player has a reproducible baseline from which M1 fault recovery can be built”** — is implemented. Automated native clean playback, timings, schema stability, AES-128 confidentiality, redaction, option consumption, and pipe ACL rows passed. Slice 8 remains **Partial**, because visible moving video and audible tone were not human-confirmed in the automated run; no full native Slice 8 pass is claimed.

The M0b gate is **not passed**. In addition to the Slice 8 human A/V observation, inherited required rows remain open:

- M0a controller D-pad, accept, and back observation;
- M0a five multi-monitor/DPI round trips;
- Slice 5 native invalid-auth/no-retry and native failure-path redaction;
- Slice 6 NVDEC hardware decode under the required D3D11 path and actual VSR confirmation; and
- Slice 7 progressive/interlaced/wrong-field/fallback visual observations plus the full 30-minute resource/shutdown run.

The interrupted Slice 7 run remains approximately 23.6 minutes, not a 30-minute pass, and its forced software-deinterlace fallback remains measured at 25 fps rather than field-rate 50 fps. No inherited row was rerun or relabeled.

Raw fixtures, generated keys, playlists, segments, proxy output, console output, structured logs, result JSON, ACL data, runtime files, dependencies, and native build output remain only under ignored artifact/native paths. No provider data, URL, credential, token, cookie, header, key, pipe name, SID, unique device identifier, process/session identifier, username, screenshot, copyrighted frame, executable, DLL, archive, or raw evidence is retained here.
