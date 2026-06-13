# CLAUDE.md

Doya is a mobile app for monitoring and controlling your local AI coding agents from anywhere. Your dev environment, in your pocket. Connects directly to your actual development environment — your code stays on your machine.

**Supported agents:** Claude Code, Codex, GitHub Copilot, OpenCode, and Pi.

## Repository map

This is an npm workspace monorepo:

- `packages/server` — Daemon: agent lifecycle, WebSocket API, MCP server
- `packages/app` — Mobile + web client (Expo)
- `packages/cli` — Docker-style CLI (`doya run/ls/logs/wait`)
- `packages/relay` — E2E encrypted relay for remote access
- `packages/desktop` — Electron desktop wrapper
- `packages/website` — Marketing site (doya.sh)

## Docs

`docs/` is the source of truth for system-level and process-level knowledge. **"The docs", "check the docs", or "check the X docs" always mean this directory — not the web.** Look here before fetching anything online; the docs capture gotchas and conventions you cannot derive from the code or external sources.

At the start of non-trivial work, list `docs/` and skim anything relevant to the task. When you learn something meta worth preserving — a gotcha, a convention, a workflow, a piece of system context that will outlive the current task — update an existing doc or propose a new one. Code-level facts belong in inline comments next to the code; system, process, and gotcha-level facts belong in `docs/`.

| Doc                                                            | What's in it                                                                                                              |
| -------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| [docs/product.md](docs/product.md)                             | What Doya is, who it's for, where it's going                                                                              |
| [docs/brand.md](docs/brand.md)                                 | Brand naming and logo asset rules for 豆芽 / Doya                                                                         |
| [docs/architecture.md](docs/architecture.md)                   | System design, package layering, WebSocket protocol, account workspaces, timeline sync, agent lifecycle, data flow        |
| [docs/agent-lifecycle.md](docs/agent-lifecycle.md)             | Agent states, parent/child relationships, archive semantics, tabs vs archive, subagents track                             |
| [docs/data-model.md](docs/data-model.md)                       | File-based JSON persistence, Zod schemas, account workspace storage, recording storage, atomic writes, no migrations      |
| [docs/glossary.md](docs/glossary.md)                           | Authoritative terminology — UI label wins, no synonyms                                                                    |
| [docs/coding-standards.md](docs/coding-standards.md)           | Type hygiene, error handling, state design, React patterns, file organization                                             |
| [docs/design.md](docs/design.md)                               | UI primitives, copy voice, layout patterns, forbidden visual/code patterns                                                |
| [docs/i18n.md](docs/i18n.md)                                   | App translation rules, `useI18n()` / `translateNow()`, copy migration scans, translation key style                        |
| [docs/hover.md](docs/hover.md)                                 | Hover — the canonical pattern (plain View + pointer enter/leave, separate inner Pressable) and failure modes              |
| [docs/unistyles.md](docs/unistyles.md)                         | Unistyles gotchas — `useUnistyles()` is forbidden, dynamic style escape hatches, web CSS leak traps                       |
| [docs/floating-panels.md](docs/floating-panels.md)             | Anchored popovers — Portal/Modal escape for Android, lifecycle gates, keyboard-shared-value, status-bar offset, the flash |
| [docs/file-icons.md](docs/file-icons.md)                       | Material icon theme integration for the file explorer                                                                     |
| [docs/providers.md](docs/providers.md)                         | Adding a new agent provider end-to-end                                                                                    |
| [docs/custom-providers.md](docs/custom-providers.md)           | Custom provider config: Z.AI, Alibaba/Qwen, ACP agents, profiles, custom binaries                                         |
| [docs/development.md](docs/development.md)                     | Dev server, DOYA_HOME, build sync gotchas, CLI reference, agent state, Playwright MCP                                     |
| [docs/timeline-sync.md](docs/timeline-sync.md)                 | Live stream vs authoritative history, paged catch-up invariants, resume behavior, replay recording boundaries             |
| [docs/doya-message-markup.md](docs/doya-message-markup.md)     | Doya chat UI markup, task handshake, rendered artifact progress/results, prompt-generation skill                          |
| [docs/rpc-namespacing.md](docs/rpc-namespacing.md)             | WebSocket RPC naming convention — dotted namespaces and `.request`/`.response` pairs                                      |
| [docs/testing.md](docs/testing.md)                             | TDD workflow, determinism, real dependencies over mocks, allowed test categories                                          |
| [docs/mobile-testing.md](docs/mobile-testing.md)               | Maestro, mobile self-verification loops, native layout gotchas                                                            |
| [docs/ad-hoc-daemon-testing.md](docs/ad-hoc-daemon-testing.md) | Isolated in-process daemon test harness                                                                                   |
| [docs/android.md](docs/android.md)                             | App variants, local/cloud builds, EAS workflows                                                                           |
| [docs/release.md](docs/release.md)                             | Release playbook, staged rollout behavior, mobile build babysitting, changelog policy, completion checklist               |
| [docs/multi-tenant/README.md](docs/multi-tenant/README.md)     | Local account/workspace model, daemon HTTP account APIs, SMS login                                                        |
| [docs/diagnostics/](docs/diagnostics)                          | Historical debugging writeups; read these before revisiting startup, git snapshot, or OpenCode provider timing bugs       |
| [docs/refactors/](docs/refactors)                              | Planned/refactored architecture slices and invariants                                                                     |
| [docs/investor-demo/](docs/investor-demo)                      | Investor/demo architecture diagrams and narrative                                                                         |
| [SECURITY.md](SECURITY.md)                                     | Relay threat model, E2E encryption, DNS rebinding, daemon password auth, agent auth                                       |

## Quick start

```bash
npm run dev                          # Start daemon + Expo in Tmux
npm run cli -- ls -a -g              # List all agents
npm run cli -- daemon status         # Check daemon status
npm run typecheck                    # Verification only when requested or high-risk
npm run lint                         # Verification only when requested or high-risk
npm run format                       # Auto-format with Biome
npm run format:check                 # Check formatting without writing
```

See [docs/development.md](docs/development.md) for full setup, build sync requirements, and debugging.

## Critical rules

- **NEVER restart the main Doya daemon on port 6767 without permission** — it manages all running agents. If you're an agent, restarting it kills your own process.
- **NEVER assume a timeout means the service needs restarting** — timeouts can be transient.
- **NEVER add auth checks to tests** — agent providers handle their own auth.
- **Before touching app UI, read [docs/design.md](docs/design.md), [docs/glossary.md](docs/glossary.md), and [docs/i18n.md](docs/i18n.md).** Use existing primitives first (`<Button>`, `<StatusBadge>`, `<DropdownMenu>`, `<AdaptiveModalSheet>`, `<SettingsSection>`, headers). New user-visible copy goes through `translations.ts` with flat keys like `domain.surface.intent`; do not add new hardcoded Chinese or English UI strings.
- **Follow [docs/coding-standards.md](docs/coding-standards.md).** Keep changes scoped, avoid "while I'm at it" cleanups, prefer `function` declarations and `interface`, validate at boundaries, trust types internally, and do not add `any`, bypass casts, `@ts-ignore`, nested ternaries, defensive `try/catch`, stale comments, `console.log`, or pass-through/barrel modules.
- **File-backed data must stay forward-compatible.** Doya has no migration framework; persisted Zod schemas use optional fields, defaults, and small normalization shims. Keep writes atomic where the owning store already does atomic temp-file + rename, and update [docs/data-model.md](docs/data-model.md) when adding durable files or fields.
- **Do not run tests by default during agent tasks.** Tests are expensive in this repo. Run them only when explicitly requested, when preparing a release/commit that requires them, or when the change is high-risk enough that targeted verification is worth the machine cost. If you skip tests, say so in the final response.
- **NEVER run the full test suite locally.** The test suites are heavy and will freeze the machine, especially if multiple agents run them in parallel. Rules:
  - When testing is warranted, run only the specific test file you changed: `npx vitest run <file> --bail=1`
  - Never run `npm run test` for an entire workspace unless explicitly asked.
  - If you must run a broad suite, pipe output to a file and read it afterward: `npx vitest run <file> --bail=1 > /tmp/test-output.txt 2>&1` then read the file.
  - Never re-run a test suite that another agent already ran and reported green — trust the result.
  - For full suite verification, push to CI and check GitHub Actions instead.
- **Tests come in only two shapes.** Unit tests use explicit ports/adapters and typed in-memory fakes; real end-to-end tests use a real daemon, browser, network, or isolated server. Do not add `vi.mock`, `vi.hoisted`, `vi.spyOn` of own exports, JSDOM, React Native test renderer, testing-library component mounting, monkey-patched globals, or fake-server fixtures; if you want one, fix the production seam first.
- **Do not run `npm run typecheck` or `npm run lint` by default during agent tasks.** Run them only when explicitly requested, when preparing a release/commit that requires them, or when the change is high-risk enough that targeted verification is worth the machine cost. If you do run them, batch related edits first and report the result.
- **Build workspace packages before diagnosing cross-package type errors.** This repo consumes generated declarations across workspaces. If typecheck fails in a package that depends on another workspace, rebuild the owning stack first so `dist` declarations are current:
  - `npm run build:client` — rebuild protocol and client declarations.
  - `npm run build:server` — rebuild highlight, relay, protocol, client, server, and CLI when server/CLI types may be stale.
  - Do not patch inferred callback parameters or add local duplicate types just to silence stale declaration errors.
- **Run `npm run format` before committing.** This repo uses Biome for formatting. Do not manually fix formatting — let the formatter handle it.
- **Always use npm scripts for linting and formatting.** Do not run tools directly with `npx eslint`, `npx oxfmt`, `npx oxlint`, or package-local binaries. For targeted checks, pass file paths through the npm script:
  - `npm run lint -- packages/app/src/components/message.tsx`
  - `npm run format:files -- CLAUDE.md packages/app/src/components/message.tsx`
- **The protocol stays backward-compatible. Features don't have to.** Two separate contracts:
  - **Protocol contract (always):** schema changes must not break parsing in either direction. An old client must still parse messages from a new daemon; a new daemon must still parse messages from an old client.
    - New fields: `.optional()` with a sensible default or `.transform()` fallback.
    - Never flip optional → required, remove fields, or narrow types (`string` → `enum`, `nullable` → non-null).
    - Removed fields stay accepted (we stop sending them, not stop reading them).
    - Test with: "does a 6-month-old client still parse this?" and "does a 6-month-old daemon still send something this client accepts?"
  - **Feature contract (per-feature):** a new feature may require a new daemon capability. The client detects whether the capability is present and either runs the feature or shows "Update the host to use this." That's it.
    - **No fallback paths.** Don't write a degraded version of a new feature that runs on old daemons. Don't fan out across legacy RPCs to simulate a missing capability. The user upgrades or doesn't get the feature.
    - **No defensive branches scattered through the feature.** Capability detection happens in one place; downstream code reads a clean shape.
    - **Capability flags live in `server_info.features.*`** with a single `// COMPAT(featureName): added in v0.1.X, drop the gate when floor >= v0.1.X` comment marking the cleanup site.
    - Existing functionality keeps working across versions — that's the protocol contract doing its job. New-feature degradation is not the goal.
    - **New RPCs use dotted namespaces with direction suffixes.** Follow [docs/rpc-namespacing.md](docs/rpc-namespacing.md): `domain.provider.operation.request` pairs with `domain.provider.operation.response`. Existing flat RPC names will migrate over time; don't add new ones.
    - Client liveness uses the top-level JSON `ping`/`pong` envelope, not a session RPC and not RFC6455 ping. A session RPC timeout is an operation failure, not proof the socket is dead.
    - Terminal PTY size is last-interacting-client-wins. Only send resize frames when the terminal viewport actually changes size or the user focuses/taps the terminal; passive attach/render/font settling must not claim PTY size.

- **All back-compat shims are tagged and dated for cleanup.** Every shim that exists for old-client/old-daemon support carries a `COMPAT(name)` comment with the version it was added in and a target removal date (typically 6 months out). One grep — `rg "COMPAT\("` — should produce the full list of cleanup work. Don't bury back-compat in untagged `??`-fallbacks or optional-chain tunnels — that's how it stops being deletable.
- **Timeline sync correctness comes from fetch catch-up, not presence.** `agent_stream` is for immediacy; `fetch_agent_timeline_request` is authoritative. Presence heartbeats route notifications and must not gate delivery. When fetching `direction: "after"`, continue from `endCursor` until `hasNewer: false`. Resume with a known cursor catches up after that cursor; resume without a cursor fetches the latest tail page. Replay recordings under `$DOYA_HOME/recordings` are separate playback facts and never rewrite the source timeline.
- **Doya Message Markup is untrusted text.** Use the local `doya-message-markup` skill/spec when creating markup prompts. If a request includes `doya-expected-target`, the assistant must emit exactly one matching leading `doya-target` before work; otherwise never invent one. Preserve request ids through target/result markup and never mention the markup unless asked.
- **Multi-tenant/account work lives in the daemon.** Do not invent a separate account API service. Account/workspace data lives under `$DOYA_HOME/accounts`; app project creation goes through the daemon HTTP account APIs, then opens the created project through the normal project/workspace/agent lifecycle.

## Platform gating

The app runs on iOS, Android, web (browser), and web (Electron desktop). Code is cross-platform by default. Gate only when you must. Import gates from `@/constants/platform`.

### The four gates

| Gate                       | Type      | When to use                                                                                                                 |
| -------------------------- | --------- | --------------------------------------------------------------------------------------------------------------------------- |
| `isWeb`                    | constant  | DOM APIs — `document`, `window`, `<div>`, `addEventListener`, `ResizeObserver`. This is the **exception**, not the default. |
| `isNative`                 | constant  | Native-only APIs — Haptics, `StatusBar.currentHeight`, push tokens, camera/scanner, `expo-av`.                              |
| `getIsElectron()`          | cached fn | Desktop wrapper features — file dialogs, titlebar drag region, daemon management, app updates, dock badges.                 |
| `useIsCompactFormFactor()` | hook      | Layout decisions — sidebar overlay vs pinned, modal vs full screen, single-panel vs split. From `@/constants/layout`.       |

### Decision matrix

| I need to...                                                   | Use                                                                       |
| -------------------------------------------------------------- | ------------------------------------------------------------------------- |
| Access DOM (`document`, `window`, `<div>`, `addEventListener`) | `if (isWeb)`                                                              |
| Use a native-only API (Haptics, push tokens, camera)           | `if (isNative)`                                                           |
| Use an Electron bridge (file dialog, titlebar, updates)        | `if (getIsElectron())`                                                    |
| Switch layout between phone and tablet/desktop                 | `useIsCompactFormFactor()`                                                |
| Show something on hover, always-visible on native              | `isHovered \|\| isNative \|\| isCompact` (hover only works on web)        |
| Gate to iOS or Android specifically                            | `Platform.OS === "ios"` / `Platform.OS === "android"` (rare, keep inline) |

### Rules

- **Default is cross-platform.** Don't gate unless you have a specific reason.
- **Unistyles:** never add `useUnistyles()`. Use `StyleSheet.create((theme) => ...)` by default, static constants for truly static values, and `withUnistyles(Component)` only for leaf third-party props that must react to theme. For high-churn measured styles on web, use `inlineUnistylesStyle` instead of feeding changing pixel values into Unistyles-managed style props.
- **Prefer Metro file extensions over `if` statements.** When a module has fundamentally different implementations per platform, use `.web.ts` / `.native.ts` file extensions instead of runtime `if (isWeb)` branches. Metro resolves the correct file at build time — the unused platform code is never bundled. Reserve `if (isWeb)` for small, inline checks (a single line or a few props). If you find yourself writing a large `if (isWeb) { ... } else { ... }` block, split into separate files instead.
  ```
  hooks/
    use-audio-recorder.web.ts    ← uses Web Audio API
    use-audio-recorder.native.ts ← uses expo-audio
  ```
  Import as `@/hooks/use-audio-recorder` — Metro picks the right file automatically.
- **Use `.electron.ts` / `.electron.tsx` for Electron-only web modules.** Electron is still the Metro `web` platform, but desktop dev/build sets `DOYA_WEB_PLATFORM=electron`, so Metro first looks for `.electron.*` files and falls back to normal `.web.*` files. Use this when the implementation depends on Electron-only behavior such as `webviewTag`, desktop preload APIs, or the Electron bridge. Keep plain browser web in `.web.*`, and keep native fallbacks in the base file or `.native.*`.
  ```
  components/
    browser-pane.electron.tsx ← Electron <webview> implementation
    browser-pane.web.tsx      ← plain web fallback
    browser-pane.tsx          ← native fallback
  ```
  Import as `@/components/browser-pane` — Electron desktop gets the `.electron.tsx` file, browser web gets `.web.tsx`, and native gets the native/base implementation.
- **NEVER use raw DOM APIs without `isWeb` guard.** DOM APIs crash native. Casting a RN ref to `HTMLElement` is a red flag — ensure the block is web-only.
- **Hover-to-reveal UI uses the canonical hover pattern from [docs/hover.md](docs/hover.md).** Track hover on a plain outer `View` with `onPointerEnter`/`onPointerLeave`; put press behavior on a separate inner `Pressable`; keep revealed controls inside the hover target; avoid geometry changes; use `isHovered || isNative || isCompact` so controls are reachable on native and compact layouts. Do not use `Pressable.onHoverIn`/`onHoverOut` to drive sibling/child reveal state when nested pressables are involved. If a floating layer creates a gap, use `useHoverSafeZone`.
- **Don't use Platform.OS as a proxy for layout capabilities.** Use breakpoints for layout decisions, not platform checks.
- **Import `isWeb`/`isNative` from `@/constants/platform`.** Never write `const isWeb = Platform.OS === "web"` locally.

## Debugging

Find the complete daemon logs and traces in the $DOYA_HOME/daemon.log
