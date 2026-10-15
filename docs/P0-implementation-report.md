# P0 implementation report

## Scope and result

Implemented the P0 desktop management flow in `D:\IDE\DevEco Desktop`. The desktop now starts one hidden DevEco Code ACP runtime at launch and shares that runtime's HTTP server for management; users do not need to start a CLI or pre-login. Provider setup works without a Huawei account. The main window owns the user-facing entry points.

| P0 area | Status | Implementation and boundary |
|---|---|---|
| Huawei account center | Implemented; live-account behavior awaits user acceptance | Desktop starts the core OAuth flow, opens the core-provided system browser, supports cancellation and a 10-minute timeout, refreshes metadata after callback, and uses the core `/auth/deveco` DELETE for logout. State distinguishes verified, cached-unverified, unknown, inconsistent, and explicitly expired. A generic CLI “Not logged in” response is not treated as proof of expiry. |
| Real-name and developer capability | Partial by contract | The official Huawei real-name page is available; recheck uses a new core OAuth callback. `/auth` `isRealName` is displayed as cached core metadata. The read-only developer check queries shared DevEco Code auth status and team membership. It does not prove device/project signing readiness and never generates a certificate or signature. |
| Agreements and privacy | Implemented | The current product agreement is read at startup and before every prompt; a `review_required` Huawei service agreement blocks prompts using the built-in DevEco model. Acceptance requires an explicit user checkbox and sends the current version/revision. Account-scoped experience improvement defaults off. Device analytics and crash-upload settings are separate native `kv.json` preferences and retain the core default of on. |
| Provider management | Implemented | Native catalog Provider credentials use a separate API Key form or core OAuth. The custom editor is restricted to unoccupied IDs and `@ai-sdk/openai-compatible`. Global/project scope, model refresh, distinct credential removal, project disable/re-add, masked key status, and legacy-config-key migration are handled. No remote key/model request is made during refresh. |
| Models and thought levels | Implemented and isolated ACP-tested | Uses the actual flat ACP `configOptions` model and `thought_level` contract. Model switches replace the available variants; absent variants disable the slider. `default`/`auto` is not ranked as the strongest effort; `xhigh`/`extra-high`, `max`, and `ultra` are ordered explicitly. Default model can be saved globally or per project. |
| Configuration center | Implemented and real-backend-tested | Validated global and project writes, source labels, redacted Provider summaries, changed-field-only saves, and idle session reload. Project JSONC writes stay inside the selected workspace; merged global settings and secrets are never copied into project files. |
| Environment checks | Implemented | Detects Node, Agent, bundled `devecocli`, Studio, and SDK paths/versions; allows path selection and persists it. The selected Node executable is checked first and its folder is prepended to subprocess `PATH`. Required chat runtime is Node 22+ plus the Agent/CLI runtime; Studio 6.1+ and a matching SDK are displayed for signing/build workflows. |
| Diagnostics and recovery | Implemented for P0 | Captures bounded stderr with cross-chunk redaction, classifies common failures, clears permission/request timers, closes ACP stdin before waiting, then kills only the spawned process tree on timeout. A saved ACP session ID is loaded only when `loadSession === true`; prompts are never replayed after reconnect. User message chunks and assistant chunks are rendered as separate turns. Full session history management remains P1. |
| First-use flow | Implemented | Environment, Provider/Huawei entry, agreement/privacy, default model, and workspace steps are connected. Completion is refused until runtime, product agreement, workspace, and the configured model are ready. A third-party path does not require Huawei login; a built-in-model path checks Huawei login, cached real-name status, and agreement state. |

## Architecture and verified contracts

- `desktop/main.cjs` owns window lifecycle, a single OAuth operation gate, management mutation leases, IPC validation, session recovery, and settings persistence. `desktop/preload.cjs` exposes narrow management methods only.
- `desktop/main.cjs` supplies `desktop/control-plane.cjs` with a launcher for `deveco.exe acp --hostname 127.0.0.1 --port <ephemeral>`. ACP starts its own HTTP server (see `reference/deveco-code/packages/opencode/src/cli/cmd/acp.ts`), so management and conversation share one native process and configuration cache. A random Basic credential stays in the main process. The control-plane class retains its standalone `serve` launcher for independent use.
- Session creation/loading uses RPC on the resident transport, buffers replay until model/mode preferences are applied, and filters events by active session ID. The mode picker reads the core's `mode` config option and uses `session/set_config_option`; unavailable modes are not synthesized. The model popover is placed outside the composer with a constrained independent scroll region.
- Core account, agreement, Provider, configuration, and path routes are grounded in the local 0.2.3 OpenAPI snapshot at [deveco-0.2.3.openapi.json](contracts/deveco-0.2.3.openapi.json). Isolated auth and agreement CRUD evidence is in [management-probe.json](contracts/management-probe.json).
- Core `/config` PATCH was experimentally shown to write an unread `config.json`. The desktop now uses `jsonc-parser` to update a recognized `deveco.jsonc`/`deveco.json` only in the selected workspace and verifies effective readback. The original failure evidence remains in [project-config-probe.json](contracts/project-config-probe.json); the passing regression is `tests/contract-smoke.test.cjs`.
- DevEco Code 0.2.3 OAuth authorize may return an empty URL with method `auto`; the core callback starts the system browser. The app treats the method as authoritative and calls the core callback instead of rejecting an empty URL. Shared `devecocli` auth status uses the verified `DEVECO_CLI_AUTH_SOURCE=deveco-code` and `DEVECO_CODE_AUTH_DIR=<GET /path.config>` adapter. Renderer code never reads token files. The main-process native privacy adapter performs a read-only decryption of the existing core credential solely to identify the owner of an account-scoped preference; it does not return that identity/token or modify credentials.
- `desktop/native-privacy.cjs` implements the native account improvement-consent store and device `kv.json` stores. The account decision is keyed by the authenticated account fingerprint and defaults off; device analytics/crash flags default on and are independent. Both writes use revision checks, native-compatible locks, and atomic replacement. Identity material never reaches the renderer.
- `desktop/oauth-lifecycle.cjs` serializes OAuth across Providers and coordinates cancellation with management mutation leases. A deferred authorization response after cancellation triggers a second core cancel and does not start a callback. Management writes hold their lease through disposal/restart/reload, and prompt submission rechecks the shared gate.

## Verification

Run the complete suite with:

```powershell
npm test
```

The suite includes source-derived ACP option/UI tests, OAuth concurrency and late-cancel tests, a real DevEco Code 0.2.3 isolated project/Provider management smoke test, a real ACP isolated model/effort/session recovery test, and the native privacy fixtures.

The real ACP fixture used a temporary Provider with `https://example.invalid`, an intentionally unusable one-time key, and two local models. It verified `session/new`, model selection, thought-level switching, the no-variants case, and `session/load` (the runtime declared support and returned the same session ID). It did not call `sendPrompt` and made no model request. An earlier full parallel test run had one ACP initialize timeout with empty redacted diagnostics; a standalone rerun passed. The test helper now disables background ModelsDev fetch/autoupdate, supplies a temporary local `{}` catalog, and runs integration tests serially. This removes remote model-catalog dependencies and concurrent serve/ACP startup; it does not establish a single root cause for the earlier timeout.

The real management smoke test used fresh temporary XDG directories, `--pure`, a local model-catalog fixture, and cleared inherited auth/config/cloud-credential overrides. It checked `/path.config` and `/path.state` were within the temporary root and `/auth` started empty before writing any fixture. It verified global/project readback, project Provider add/disable/re-add, fake credential metadata without key exposure, and cleanup; it left user credentials untouched.

Full test suite: 30/30 passed in the latest `npm test`, including 12 native privacy cases using temporary fixture credentials and native-format lock tests. The managed Codex runner's default sandbox denies Windows atomic rename in its temp container, so the agent ran the suite with the authorized unsandboxed test invocation; this is a runner restriction and does not imply that ordinary local PowerShell needs administrator privileges. Static JavaScript syntax checks pass. The parent also checked that all HTML IDs are unique and referenced selectors exist.

## Not verified with a real user account or full GUI

- No real Huawei login/logout, real-name completion, agreement acceptance, or real API key was used. The system-browser round trip, user cancellation/timeout, and later recheck are listed in [P0-review-checklist.md](P0-review-checklist.md) for the user to exercise from `npm start`.
- `/auth` exposes cached account metadata, not a fresh remote real-name query. A newly authorized callback refreshes core metadata, but the real Huawei account and real-name result still need user acceptance.
- Provider refresh does not test remote credentials or pricing. A deliberate model prompt is the only user-side check that a real Provider key works; do not use the disposable test fixture for that.
- Signing readiness stops at shared account and team prerequisites. It does not inspect/produce signing materials or validate an actual product/device combination.
- P1 remains out of scope: session-history fork/export, attachments and file diffs, remote MCP/Skill/Plugin management, usage/quota screens, child-agent monitoring, and Studio/device/emulator panels.

## Resident-runtime follow-up, 2026-10-13

The startup/session lifecycle, actual mode selector, and model-menu scrolling were changed after the P0 test run described above. That historical run does not verify these changes. This follow-up uses syntax and static structure checks only; no tests, real account actions, model prompts, or rendered desktop interaction were run. Restart with `start-dev.cmd`, inspect advertised modes and scrolling, and compare the runtime PID in diagnostics before/after switching sessions to review the changes manually.

## Session management and slider follow-up, 2026-10-13

- Enabled thought-level tracks use a solid theme accent only for the reached portion and a pale background for the remaining portion. The fill layer has no right border or minimum width, so the lowest level has no stray edge; particles remain limited to the strongest advertised level.
- `desktop/session-library.cjs` reads the native session index and confirms a stored `role: user` message before returning a sidebar row. Reads use message pagination, verified parent-message lookup, bounded concurrency, and short-lived caches. Empty drafts do not consume the sidebar's 50 visible session slots. Failure to read a session's messages hides that row and reports a partial-read notice.
- Archive and restore use `PATCH /session/{sessionID}` with `time.archived` set to a timestamp or `0`; deletion uses the native DELETE route after a main-process confirmation dialog. All mutations validate session ownership and share the existing idle/OAuth mutation gate. Removing the current conversation detaches its desktop reference and creates a hidden blank session on the same resident process.
- Compatibility detail: the 0.2.3 ordinary session list excludes non-null archive columns, including `0`. Desktop therefore uses `/experimental/session?archived=true` and separates active/archive entries by the returned archive timestamp. Restored records remain available in Desktop, while other clients using the ordinary list may continue to hide those records. The desktop does not directly edit the native database.
- This follow-up was checked with syntax and static HTML/IPC structure inspection only. No real sessions were deleted/archived by the implementation tools, and no UI interaction or model request was run.

## Account settings follow-up, 2026-10-13

The account view now follows the supplied reference: a profile card, developer certification rows, and a model-channel card. It reuses existing Huawei OAuth, logout, cached real-name metadata, account refresh, and official certification-page actions. Account identifiers are masked; certification type and live request quota remain unavailable instead of using the reference's sample values. Model-channel availability describes known login/certification/agreement conditions, not remaining quota or remote service health.

The environment/diagnostics page, navigation entry, renderer handlers, and its automatic page refreshes were removed. Native runtime discovery and management APIs remain available internally. Legal/privacy navigation is pinned to the bottom on desktop and appears last in the compact navigation. The backend still checks required agreements before any prompt.

Syntax and static markup/asset checks cover this change. Live Huawei authorization, logout, account switching, and rendered comparison with the reference were not run. `design-qa.md` records the pending visual acceptance.
