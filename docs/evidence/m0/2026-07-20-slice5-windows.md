# M0b Slice 5 — Xtream channel-to-video vertical slice

| Field                     | Result                                                               |
| ------------------------- | -------------------------------------------------------------------- |
| Date                      | 20 July 2026                                                         |
| Status                    | Partial — real provider/TS path passed; native invalid-auth row open |
| Source revision           | `231986d` plus uncommitted Slice 5 working-tree changes              |
| Native workflow           | WSL source mirrored one-way to the managed native NTFS mirror        |
| Private Xtream input      | Available for the observed rerun; values were not recorded           |
| Provider TS/HLS samples   | MPEG-TS exposed and passed; HLS not advertised by the account        |
| Existing private playlist | Present but neither read as Xtream input nor copied back to WSL      |

## Scope and architecture result

- Electron main owns a credential service backed by `safeStorage`. The ignored `config/local/xtream.json` development input is strictly validated and imported atomically only when no encrypted credential exists. Unavailable encryption is a configuration failure; there is no plaintext-storage fallback.
- A dedicated Electron utility process receives scoped plaintext only for the three minimum requests: account validation, live categories, and live streams. It normalizes provider data and resolves playback URLs without returning full provider payloads to main or any provider request data to the renderer.
- Category and channel records use deterministic internal IDs. Malformed records are counted and skipped. Renderer state contains only normalized category/channel names, internal IDs, transport labels, counts, and sanitized status.
- Renderer playback intents contain one validated internal channel ID. Asynchronous URL resolution reserves the generation immediately; stale resolved results cannot load after a newer request.
- Authenticated HTTP(S) TS/HLS inputs and scoped User-Agent, Referer, custom headers, and cookies are passed as per-file `loadfile` options over the existing private mpv JSON IPC connection. They are absent from mpv process arguments, renderer state, UI errors, and structured log fields by construction and focused tests.
- The established sandboxed/context-isolated/Node-disabled renderer, native video host, Path A overlay, unpredictable pipe, mpv child ownership, controlled replacement, and legacy M0a development-playlist path remain in place. No Slice 6 or later work was added.

## Sanitized fixture and test evidence

The committed synthetic API-shape fixture contains an authenticated account shape, advertised TS/HLS formats, three category records, and four live-stream records. It contains only reserved invalid hostnames and synthetic values.

| Result                         | Count |
| ------------------------------ | ----: |
| Categories normalized          |     2 |
| Categories skipped             |     1 |
| Live-stream records normalized |     2 |
| Live-stream records skipped    |     2 |
| TS/HLS playback variants       |     4 |

- The malformed category was skipped for its missing name. One malformed stream ID and one stream referencing an unknown category were skipped without aborting the import.
- Stable-ID repetition produced the same category/channel IDs for the same provider origin, raw IDs, and output formats.
- Valid synthetic credentials made exactly the account, category, and stream calls. Invalid authentication made exactly one account-validation call, returned the authentication failure class, and made no category/stream call or transport retry.
- Both `.ts` and `.m3u8` authenticated URL shapes resolved inside the trusted provider module. Provider-only headers did not enter playback settings; playback-only User-Agent, Referer, custom headers, and cookie became per-file mpv options.
- The asynchronous channel race test reserved two generations, resolved the newer request first, loaded only generation 2, and rejected generation 1 as stale. The fixed native-facing action issues 30 internal-channel-ID requests through the same path.
- Redaction tests passed for authenticated URLs, usernames/passwords, authorization values, cookies, custom headers, tokens, and pipe names under structured success/failure shapes. Public catalog serialization contained no credential or `streamUrl` field. UI error text is selected from fixed failure classes and never includes provider error text or payloads.

## Sanitized native provider counts

| Result                         | Count |
| ------------------------------ | ----: |
| Categories normalized          |   194 |
| Categories skipped             |     1 |
| Live-stream records normalized |   989 |
| Live-stream records skipped    |     0 |
| MPEG-TS playback variants      |   989 |
| HLS playback variants          |     0 |

The single unusable category record was skipped without aborting the real import. No provider record, name, ID, URL, or payload was retained.

## Commands and outcomes

WSL/Nix:

- `nix flake check` — passed. The x86-64 development shell, Node-major check, and formatter derivations evaluated successfully.
- `nix develop -c bash -lc 'corepack pnpm install --frozen-lockfile && corepack pnpm verify'` — passed. Frozen install was already current; strict type-check, ESLint, 35 tests across 15 files, production build, and formatting passed.
- The production build emitted separate main, preload, renderer, and provider-utility entries. No dependency version or pinned mpv runtime changed.
- `nix develop -c bash -lc './scripts/sync-windows.sh'` — passed and preserved ignored native inputs/runtime/artifacts while mirroring the Slice 5 source and template.

Native Windows:

- The first direct bootstrap invocation stopped at prerequisites because the WSL-launched child PowerShell did not inherit the installed Node/Corepack path. It performed no install, build, test, or launch work.
- A second child PowerShell prepended the existing `C:\Program Files\nodejs` directory for that process only and ran `scripts/windows-bootstrap-check.ps1`. Frozen install, strict type-check, ESLint, 35 tests, production build, Electron 43.1.1 version check, and the self-terminating development smoke window all passed. No system configuration changed.
- After the final source synchronization, the Slice 5 PowerShell script parsed without errors and `scripts/windows-bootstrap-check.ps1 -SkipInstall` repeated the native type-check, lint, 35 tests, build, Electron version check, and smoke launch successfully against the already-clean frozen dependency state.
- An initial `scripts/windows-slice5-acceptance.ps1 -SkipInstall` run recorded that no ignored Xtream input was available. After a private input was configured locally, the observed rerun passed every provider/playback row exposed by the account and retained raw results only under the ignored native artifact directory.

## Native provider and playback observations

- Valid native provider authentication and real category/channel load: **pass**. The account loaded the sanitized counts above through the minimum account/category/stream request sequence.
- Native invalid-credential classification/no-retry behavior: **unobserved**; the deterministic synthetic integration test passed.
- Native `safeStorage`/Windows DPAPI import with the private input: **pass**. The sanitized event recorded `imported: true` and later launches prefer the encrypted value.
- Provider MPEG-TS playback: **pass** with visible video and audible audio confirmed. Six sanitized intent-to-`playback-restart` samples were 5525.7, 4671.6, 4028.8, 4302.5, 5032.4, and 4155.0 ms (range 4.03–5.53 s). Slice 5 has no latency threshold; benchmark/tuning decisions remain later work.
- Provider HLS playback: **not applicable for this account/run**. Account validation advertised zero HLS variants, so no HLS playback or timing pass is claimed.
- Actual mpv process arguments and the persisted success-path structured log contained none of the locally known credential, authenticated URL, header, or cookie values. Native provider failure-path scanning remains tied to the open invalid-auth row; synthetic structural failure redaction passed.
- The correct native 30-change channel-ID action issued generations 66–95. Exactly one resolved input reached mpv, generation 95 was asserted current, and `playback-restart` occurred only for generation 95; the user observed a brief pause followed by playing video.
- A diagnostic interaction first selected the similarly named legacy playlist 30-change control. That command stepped a single-entry provider load and produced a black frame; it is not counted as provider-channel acceptance. The provider action was moved into the visible Live Channels panel/overlay, the stream was reselected, and the full channel-ID run above passed without restarting the acceptance process.
- Normal close left no owned mpv process or reachable named pipe.

The existing pinned, SHA-verified shinchiro Windows x64 runtime, mpv commit `304426c390901436fb1d4a63efbd582ae80c88f4`, and FFmpeg commit `2576e09434d8026aab1769481b7b2fb43aa567c3` were preserved and not replaced or upgraded. No provider playback claim is made from the smoke window or synthetic tests.

## Gate and open criteria

The Slice 5 outcome — **“local credentials lead to a real channel list and selecting a channel produces video”** — is now natively observed for the provider's MPEG-TS path. HLS is conditional in the Slice 5 acceptance language and was not exposed by this account. The Slice 5 result remains **Partial**, not Pass, solely because a native invalid-credential rejection/no-retry run and its actual failure-path redaction scan remain unobserved. Synthetic Windows and WSL tests for that row pass.

The inherited M0a rows remain open and unchanged:

- Controller D-pad, accept, and back are unobserved because no M0 controller was available.
- Five round trips across every available monitor/DPI mode are unobserved because only one 150% display was available.

The overall M0b gate is not evaluated at Slice 5 and remains scheduled after Slice 8. No M0b gate pass is claimed.

Raw console output, native build output, acceptance JSON, logs, runtime downloads, and any future provider-derived data remain only under ignored native paths. No provider name, payload, stream URL, credentials, token, header, cookie, pipe name, process/session identifier, username, screenshot, copyrighted frame, executable, DLL, runtime archive, dependency tree, or raw evidence is retained here.
