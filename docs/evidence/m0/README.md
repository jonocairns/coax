# Sanitized M0 evidence

Only small, reviewed, sanitized summaries belong here. Raw logs, screenshots, provider data, authenticated URLs, headers, cookies, credentials, copyrighted frames, usernames, and machine-identifying paths remain in the ignored `artifacts/m0/<run-id>/` tree.

Recorded sanitized summaries:

- [`2026-07-19-slice1-windows.md`](2026-07-19-slice1-windows.md) — native Windows clean install, build, and development-window smoke check
- [`2026-07-19-slice2-windows-partial.md`](2026-07-19-slice2-windows-partial.md) — pinned runtime fetch/version and native build pass; first-frame acceptance remains open because no private local input was configured
- [`2026-07-19-slice2-windows.md`](2026-07-19-slice2-windows.md) — native bundled-mpv playback, internal-playlist navigation, event/redaction checks, and clean process/pipe result

Slice 2 uses `scripts/windows-slice2-acceptance.ps1` to create ignored raw evidence. Add a sanitized Slice 2 summary here only after the native target has confirmed visible video, audible audio, required events, redaction, and clean process/pipe shutdown. Linux or WSL playback is not acceptance evidence.
