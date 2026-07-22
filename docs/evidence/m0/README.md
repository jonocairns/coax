# Sanitized M0 evidence

Only small, reviewed, sanitized summaries belong here. Raw logs, screenshots, provider data, authenticated URLs, headers, cookies, credentials, copyrighted frames, usernames, and machine-identifying paths remain in the ignored `artifacts/m0/<run-id>/` tree.

Recorded sanitized summaries:

- [`2026-07-19-slice1-windows.md`](2026-07-19-slice1-windows.md) — native Windows clean install, build, and development-window smoke check
- [`2026-07-19-slice2-windows-partial.md`](2026-07-19-slice2-windows-partial.md) — pinned runtime fetch/version and native build pass; first-frame acceptance remains open because no private local input was configured
- [`2026-07-19-slice2-windows.md`](2026-07-19-slice2-windows.md) — native bundled-mpv playback, internal-playlist navigation, event/redaction checks, and clean process/pipe result
- [`2026-07-19-slice3-windows.md`](2026-07-19-slice3-windows.md) — embedded native-host lifecycle matrix, generation/replacement checks, and the explicitly open single-monitor/DPI row
- [`2026-07-19-slice4-windows.md`](2026-07-19-slice4-windows.md) — Path A overlay selection, available native interaction matrix, and the explicitly open controller and monitor/DPI rows
- [`2026-07-20-slice5-windows.md`](2026-07-20-slice5-windows.md) — native safeStorage import, real provider/category/channel and MPEG-TS playback results, HLS not exposed, and native invalid-auth explicitly open
- [`2026-07-20-slice6-windows.md`](2026-07-20-slice6-windows.md) — native RTX/D3D11 adapter and profile comparison, controlled 720p50→4K soak, resolution-change and forced-software-fallback results, with NVDEC hardware and VSR confirmation explicitly open
- [`2026-07-21-slice7-windows.md`](2026-07-21-slice7-windows.md) — controlled progressive/interlaced sports cadence, field-order override and forced-deinterlacing-fallback results; visual rows and the interrupted 30-minute row remain open
- [`2026-07-21-slice8-windows.md`](2026-07-21-slice8-windows.md) — Nix-hosted clean TS/HLS/AES-128 baseline, native machine timings, bounded/redacted diagnostics, pinned networking probe, and actual named-pipe DACL; human A/V confirmation and inherited gates remain open

Slice 4 uses `scripts/windows-slice4-acceptance.ps1` for its ignored raw results. Its sanitized summary must retain unavailable controller and monitor/DPI criteria as open and must not call the native M0a gate complete until every required row has been observed.

Slice 5 uses `scripts/windows-slice5-acceptance.ps1`. When no ignored Xtream input is available, its raw result records the native provider rows as unobserved rather than inferring a pass from synthetic fixtures. A sanitized provider pass requires observed native categories/channels, available TS/HLS playback and timings, structural redaction checks, newest-request-wins behavior, and clean shutdown without retaining private values.

Slice 6 uses `scripts/create-slice6-fixtures.sh` and `scripts/windows-slice6-acceptance.ps1`. Its sanitized summary must retain the benchmark configuration, distinguish requested/attached/confirmed VSR states, and leave unavailable hardware profiles or confirmation signals explicitly open. Raw fixtures, logs, adapter output, resource samples, and result JSON stay only under the ignored native artifact tree.

Slice 7 uses `scripts/create-slice7-fixtures.sh` and `scripts/windows-slice7-acceptance.ps1`. Its sanitized summary must distinguish measured cadence and filter attachment from human-observed smooth motion, combing, judder, and field-order correctness. An interrupted soak is not a 30-minute or clean-shutdown pass. Raw fixtures, logs, resource samples, screenshots, frames, and result JSON stay only under the ignored native artifact tree.

Slice 8 uses `harness/slice8/fixtures.json`, `harness/slice8/server.mjs`, `scripts/start-slice8-harness.sh`, and `scripts/windows-slice8-acceptance.ps1`. Its sanitized summary must retain the stable player paths/result schema, exact machine-readable timing ranges, AES-128 confidentiality result, redaction scenarios, pinned backend/accepted-option boundary, and sanitized actual-pipe ACL conclusion. A machine playback event is not a substitute for skipped human A/V confirmation. Raw media, keys, proxy output, console output, logs, ACL data, and result JSON stay only under ignored artifact paths.

Slice 2 uses `scripts/windows-slice2-acceptance.ps1` to create ignored raw evidence. Add a sanitized Slice 2 summary here only after the native target has confirmed visible video, audible audio, required events, redaction, and clean process/pipe shutdown. Linux or WSL playback is not acceptance evidence.
