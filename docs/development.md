# Development

## Prerequisites

- Node.js (see `.tool-versions` for exact version)
- npm workspaces (comes with Node)

## Running the dev server

```bash
npm run dev
```

`scripts/dev.sh` runs the daemon and Expo together via `concurrently`, fronted by [`portless`](https://www.npmjs.com/package/portless) so each service is reachable at a stable name like `https://daemon.localhost` / `https://app.localhost` instead of a fixed port. The underlying TCP ports are ephemeral — never hardcode them. (Windows uses `scripts/dev.ps1`, which still binds the daemon to `localhost:6767` directly.)

Local dev disables the hosted relay by default (`DOYA_RELAY_ENABLED=0`) so
startup does not depend on external network access. Set this when you are
specifically testing relay behavior:

```bash
DOYA_RELAY_ENABLED=1 npm run dev
```

### Runtime Home

The runtime home directory holds local state: agents, sockets, daemon logs, account data, and config. Resolution rules:

- The **server itself** (e.g. when launched by the desktop app or `npm run start`) defaults to `~/.doya`.
- **`npm run dev` from a git worktree** derives a stable home like `~/.doya-<worktree-name>` and, on first run, seeds it from `~/.doya` by copying agent/project JSON metadata and `config.json`. Checkout/worktree directories are not copied.
- **`npm run dev` from the main checkout** (not a worktree) uses a fresh `mktemp` directory under `$TMPDIR` and removes it on exit. Set the runtime home explicitly to keep state across runs.

Override knobs:

```bash
DOYA_HOME=~/.doya-blue npm run dev             # explicit home; legacy env name remains supported
DOYA_DEV_SEED_HOME=/path/to/home npm run dev   # seed from a different source home
DOYA_DEV_RESET_HOME=1 npm run dev              # clear and reseed the derived worktree home
```

### Daemon endpoints

- Stable daemon launched by the desktop app: `localhost:6767`.
- `npm run dev` (macOS/Linux): portless URLs only — read them from the `dev.sh` banner or `portless get daemon` / `portless get app`.
- `npm run dev` (Windows): `localhost:6767` for the daemon.

In any worktree-style or portless setup, never assume default ports.

### Local control service

The session-centered local control plane runs separately from the daemon:

```bash
npm run dev:control
```

By default it listens on `127.0.0.1:6777` and stores control data in
`$DOYA_CONTROL_HOME/control.json` or `~/.doya-control/control.json`.
Point the app at it with:

```bash
EXPO_PUBLIC_CONTROL_API_URL=http://127.0.0.1:6777
```

When using `doya.json` service orchestration, the `control` service and app env
are wired together by the service config. The daemon remains the runtime node;
control owns account/session/history state.

For local SMS login testing, the control service loads `docker/.env` when the
file exists. Values already exported in the shell take precedence over the file.

Paid plan upgrades are created by the control service. Configure the real
gateway with a private `$DOYA_CONTROL_HOME/payment.json` file, or with
environment variables for deploys. Never put the merchant key in app code.

Private file:

```json
{
  "merchantId": "1614",
  "merchantKey": "...",
  "publicBaseUrl": "https://control.example.com",
  "baseUrl": "https://dl.qpzf.cn",
  "notifyUrl": "https://control.example.com/api/billing/payments/notify",
  "returnUrl": "https://app.example.com/billing"
}
```

Environment override:

```bash
DOYA_PAYMENT_MERCHANT_ID=...
DOYA_PAYMENT_MERCHANT_KEY=...
DOYA_PAYMENT_PUBLIC_BASE_URL=https://control.example.com
DOYA_PAYMENT_GATEWAY_BASE_URL=https://dl.qpzf.cn # optional
DOYA_PAYMENT_NOTIFY_URL=https://control.example.com/api/billing/payments/notify # optional
DOYA_PAYMENT_RETURN_URL=https://app.example.com/billing # optional
DOYA_PAYMENT_CONFIG_FILE=/secure/path/payment.json # optional
```

`DOYA_PAYMENT_PUBLIC_BASE_URL` must be reachable by the payment provider because
successful upgrades are applied only from the server-side notify callback.

### Host runtime lazy connections

The app keeps saved host profiles in local state, but it must not open every
daemon WebSocket just to render a list, home page, Settings page, or admin
overview. A saved daemon with no active socket is a normal `idle` host runtime,
not a failed connection.

Start a host runtime only when the user enters a workflow that needs that
specific daemon: opening a live session/agent, creating a new runtime on a
selected host, running a probe, or opening a daemon-scoped admin surface that
needs live provider/runtime details. Use `ensureStarted(serverId)` or the
matching hook at that boundary, not in broad list components.

Control-plane history can render from persisted sessions and bindings before a
daemon socket exists. When the user opens a history item, resolve its active
`SessionAgentBinding` and connect only to that binding's `nodeId`. Avoid
prefetching artifacts or registering all online nodes during sidebar hydration;
those operations create noisy `/register` and `/agent-binding` traffic and make
startup look connected to daemons the user did not choose.

### Desktop renderer profiling

`npm run dev:desktop` starts Electron with Chromium remote debugging enabled on
`http://127.0.0.1:9223` so renderer CPU profiles can be captured through CDP.
Override the port with `DOYA_ELECTRON_REMOTE_DEBUGGING_PORT` when `9223` is busy.
The script clears `ELECTRON_RUN_AS_NODE` for the Electron UI process so agent or
packaging environments that set it do not make Electron run as plain Node.
The desktop main process ignores `write EPIPE` from console logging so a closed
terminal pipe does not surface as an Electron main-process crash dialog.

### React render profiling

The app has a gated React render profiler in
`packages/app/src/utils/render-profiler.tsx`. Wrap the component boundary you want
to measure with `RenderProfile`, then open the app with `?renderProfile=1`. When
the query param is absent, `RenderProfile` returns children directly and records
nothing.

Captured samples are exposed on `globalThis.__DOYA_RENDER_PROFILE__`. Call
`globalThis.__DOYA_RESET_RENDER_PROFILE__?.()` after warm-up and before the
interaction you want to measure. If a memo comparator or subscription boundary
needs explanation, call `recordRenderProfileReasons(id, reasons)` while profiling;
reason counts are exposed on `globalThis.__DOYA_RENDER_PROFILE_REASONS__`.

Use this workflow for any render investigation:

1. Add stable `RenderProfile` boundaries around the suspected root and expensive
   children. Keep IDs specific enough to compare before and after.
2. Reproduce against real app state, not toy fixtures, whenever practical.
3. Record an idle baseline first. If idle is noisy, fix or account for that
   before optimizing the interaction.
4. Warm up the route, reset profiler samples, run the exact interaction, then
   compare `actualDuration`, render counts, and per-commit samples.
5. When a memo boundary still renders, record reasons before changing code. Do
   not guess from object identity alone.
6. Keep changes that move the measured profile. Remove probes or memo wrappers
   that do not move the number.

What this caught during the workspace tab investigation:

- A large apparent workspace cost was real interaction work, not daemon noise;
  the idle baseline stayed near zero.
- The expensive stream rerender was mostly prop identity churn from pane context
  callbacks and capability objects, not new stream data.
- Stabilizing provider actions at the pane boundary helped because every mounted
  panel consumes that context.
- Comparing value-shaped capability flags beat preserving object identity through
  unrelated stores.
- Some plausible fixes did not pay off: memoizing the tab row and composer draft
  object barely moved the profile, so they were removed.

Existing scenario script: workspace agent/terminal tab switching. Start Expo on
web, keep a daemon available, then run:

```bash
DOYA_PROFILE_SERVER_ID=<server-id> \
DOYA_PROFILE_WORKSPACE_ID=<workspace-path> \
DOYA_PROFILE_AGENT_ID=<agent-id> \
  npm run profile:workspace-tabs --workspace=@getdoya/app
```

This script opens the app with `?renderProfile=1`, creates a temporary terminal
tab, switches between a real agent and that terminal, prints aggregated React
Profiler timings, then removes the temporary terminal. It is an example of the
workflow above, not the only way to use the profiler. Useful knobs:

```bash
DOYA_PROFILE_APP_URL=http://localhost:19010 # Expo web URL
DOYA_PROFILE_SWITCH_COUNT=1                # number of agent/terminal switch pairs
DOYA_PROFILE_SWITCH_WAIT_MS=250            # delay after each click
DOYA_PROFILE_IDLE_WAIT_MS=3000             # idle baseline before switching
DOYA_PROFILE_DUMP_COMMITS=1                # include per-commit profiler samples
```

### Desktop macOS compositor watchdog

macOS display sleep can leave Chromium's GPU-process display link — the vsync
source that drives frame production — stuck on a stale display. The compositor
then stops producing frames and the window looks frozen: unresponsive to clicks
and keys even though the renderer and every process stay alive. It self-recovers
after a few minutes, which is too long for a foreground app.

`setupDarwinCompositorWatchdog`
(`packages/desktop/src/window/compositor-watchdog/index.ts`) guards against
this. It polls the renderer for frame production every couple of seconds and,
after a sustained stall while the window is visible and unlocked, restarts the
GPU process so Chromium rebuilds the display link. The probe is skipped while
the screen is locked or the window is hidden or minimized, since a window
legitimately stops producing frames then.

The watchdog deliberately leaves background throttling **enabled**. Calling
`webContents.setBackgroundThrottling(false)` would keep the compositor producing
frames non-stop, pinning ProMotion displays at 120Hz forever and draining the
battery while the app is idle — so do not re-add it. The probe's visibility
guards already prevent throttling from causing a false stall.

### Daemon logs

Check `$DOYA_HOME/daemon.log` for daemon logs. The default level is `info`; set
`DOYA_LOG_LEVEL=trace` before launching the daemon when you need full provider,
session, and agent-manager traces for stuck-state debugging.

The supervisor rotates `daemon.log`. Persisted `log.file.rotate` settings in
`$DOYA_HOME/config.json` win first. Without persisted config, the optional
`DOYA_LOG_ROTATE_SIZE` and `DOYA_LOG_ROTATE_COUNT` env vars override the
defaults. The default rotation is `10m` x `3` files everywhere.

## doya.json service scripts

`worktree.setup` and `worktree.teardown` accept either a multiline shell script or an array
of commands. Both run sequentially.

```json
{
  "worktree": {
    "setup": "npm ci\ncp \"$DOYA_SOURCE_CHECKOUT_PATH/.env\" .env\nnpm run db:migrate",
    "teardown": "npm run db:drop || true"
  }
}
```

Every `scripts` entry with `"type": "service"` receives these environment variables:

| Variable                   | Value                                                                                                                     |
| -------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| `DOYA_SERVICE_<NAME>_URL`  | Proxied daemon URL for a declared peer service. Prefer this for peer discovery; it survives peer restarts.                |
| `DOYA_SERVICE_<NAME>_PORT` | Raw ephemeral port for a declared peer service. Use only as a bypass escape hatch; it can go stale if that peer restarts. |
| `DOYA_URL`                 | Self alias for `DOYA_SERVICE_<SELF>_URL`.                                                                                 |
| `DOYA_PORT`                | Self alias for `DOYA_SERVICE_<SELF>_PORT`.                                                                                |
| `HOST`                     | Bind host for the service process.                                                                                        |

`<NAME>` is normalized from the script name by uppercasing it, replacing each run of non-`A-Z0-9` characters with `_`, and trimming leading or trailing `_`. For example, `app-server` and `app.server` both normalize to `APP_SERVER`; that collision fails at spawn time with an actionable error.

`PORT` is not injected by default. If a framework requires `PORT`, set it in the command:

```json
{
  "scripts": {
    "web": {
      "type": "service",
      "command": "PORT=$DOYA_PORT npm run dev:web"
    }
  }
}
```

## Built workspace packages

Package imports resolve through package exports to compiled `dist/` output, not sibling `src/` files. This is true in local dev and in published packages: the app, daemon, CLI, and SDK consumers should all exercise the same runtime paths.

`npm run dev`, `npm run dev:server`, and `npm run dev:app` build the workspace packages they need once, then keep `@getdoya/protocol` and `@getdoya/client` fresh with TypeScript watch builds while the daemon or Expo runs. If you change protocol schemas or client code outside those watch workflows, rebuild the producer before trusting runtime behavior.

Use the named root build targets instead of remembering workspace dependency chains:

```bash
npm run build:client       # protocol -> client
npm run build:server-deps  # highlight -> relay -> protocol -> client -> control
npm run build:server       # server-deps -> server -> cli
npm run build:app-deps     # highlight -> protocol -> client -> expo-two-way-audio
```

The local control service lives in `packages/control`. The root
`build:server-deps` target builds it alongside the other server-facing
workspaces so app/server development has current control declarations.

Use `npm run build:server` whenever you have changed any daemon/server-facing package and need clean cross-package types or runtime behavior.

For tighter loops, you can rebuild a single workspace:

- Changed `packages/protocol/src/*` or `packages/client/src/*`: `npm run build:client`.
- Changed `packages/server/src/*`, `packages/control/src/*`, `packages/cli/src/*`, `packages/relay/src/*`, or `packages/highlight/src/*`: `npm run build:server`.
- Changed app build dependencies: `npm run build:app-deps`.

## CLI reference

Use `npm run cli` to run the in-repo CLI from source (`npx tsx packages/cli/src/index.ts`). The globally installed `doya` binary on macOS is a symlink into the installed Doya desktop app, not this checkout — use it to drive the desktop's built-in daemon, but use `npm run cli` when you want to talk to the CLI you are editing.

```bash
npm run cli -- ls -a -g              # List all agents globally
npm run cli -- ls -a -g --json       # Same, as JSON
npm run cli -- inspect <id>          # Show detailed agent info
npm run cli -- logs <id>             # View agent timeline
npm run cli -- daemon status         # Check daemon status
```

Use `--host <host:port>` to point the CLI at a different daemon:

```bash
npm run cli -- --host localhost:7777 ls -a
```

## Agent state

Agent data lives at:

```
$DOYA_HOME/agents/{cwd-with-dashes}/{agent-id}.json
```

Find an agent by ID:

```bash
find $DOYA_HOME/agents -name "{agent-id}.json"
```

Find by content:

```bash
rg -l "some title text" $DOYA_HOME/agents/
```

## Provider session files

Get the session ID from the agent JSON (`persistence.sessionId`), then:

**Claude:**

```
~/.claude/projects/{cwd-with-dashes}/{session-id}.jsonl
```

**Codex:**

```
~/.codex/sessions/{YYYY}/{MM}/{DD}/rollout-{timestamp}-{session-id}.jsonl
```

## Testing with Playwright MCP

Point Playwright MCP at the running Expo web target. Under `npm run dev` (macOS/Linux) that is the portless URL printed in the dev banner — typically `https://app.localhost`. If you start Expo directly with `expo start --web` (no portless), Metro defaults to `http://localhost:8081`.

Do NOT use browser history (back/forward). Always navigate by clicking UI elements or using `browser_navigate` with the full URL — the app uses client-side routing and browser history breaks state.

## App web deploys

`packages/app` exports a single-page Expo web app and deploys the `dist/`
directory to Cloudflare Pages with `npm run deploy:web --workspace=@getdoya/app`.

PWA install metadata lives in `packages/app/public/manifest.json` and is linked
from `packages/app/public/index.html`. Keep the install icons in `public/` so
Cloudflare serves them from stable root URLs after `expo export`.

Do not add service-worker caching casually. Doya is a live control surface for
agents, and an aggressive service worker can strand installed users on stale web
code. If offline behavior becomes a product requirement, add it deliberately
with an update strategy and test the installed-app upgrade path.

## Docker production compose

中文的一键生产部署流程见 [docs/docker-production-deploy.zh.md](docker-production-deploy.zh.md)。

The root `docker-compose.yml` builds the production daemon and Expo web export:

```bash
npm run docker:build
npm run docker:up
```

By default the web app is served on `http://localhost:8080`, the daemon on
`localhost:6767`, and the control API on `http://localhost:6777`. For a remote
host, copy `docker/.env.example` to `docker/.env`, then set the internal daemon
endpoint, optional browser-visible daemon endpoint, control endpoint, and matching
app origins before building:

```bash
npm run docker:build
npm run docker:up
```

The compose stack stores daemon state in the `doya_home` Docker volume, control
state in the `doya_control_home` Docker volume, and mounts `./workspaces` at
`/workspaces` for projects. Agent provider CLIs and their auth still need to
exist inside the server container or be added by extending the server image.
SMS login credentials (`DOYA_SMS_*`) and payment credentials (`DOYA_PAYMENT_*`)
are passed to the control service.

Runtime node registration keeps two daemon addresses when needed:
`DOYA_RUNTIME_NODE_ENDPOINT` is the internal address the control service uses to
call the daemon, while `DOYA_RUNTIME_NODE_PUBLIC_ENDPOINT` is returned to browser
clients by the scheduler. In an nginx TLS deployment, one node can use
`DOYA_RUNTIME_NODE_ENDPOINT=http://server:6767` and
`DOYA_RUNTIME_NODE_PUBLIC_ENDPOINT=https://www.example.com`; additional daemons
can register their own public paths or hostnames.

For registry-based deployment, set `DOYA_SERVER_IMAGE`, `DOYA_CONTROL_IMAGE`,
and `DOYA_APP_IMAGE` in `docker/.env`, build and push locally, then copy
`docker-compose.deploy.yml` plus `docker/.env` to the server. For Docker Hub
under `jadenxiong`, use image names like `jadenxiong/doya-server:0.1.88`,
`jadenxiong/doya-control:0.1.88`, and `jadenxiong/doya-app:0.1.88`:

```bash
docker compose --env-file docker/.env build
docker compose --env-file docker/.env push
```

On the server:

```bash
docker compose --env-file docker/.env -f docker-compose.deploy.yml pull
docker compose --env-file docker/.env -f docker-compose.deploy.yml up -d
```

## Expo troubleshooting

```bash
npx expo-doctor
```

Diagnoses version mismatches and native module issues.

## ONLYOFFICE XLSX Preview

Start the local ONLYOFFICE stack with:

```bash
npm run onlyoffice:up
```

This runs `onlyoffice/documentserver` on `http://127.0.0.1:8082`. Local
development uses that address by default. Production web builds use
ONLYOFFICE only when `EXPO_PUBLIC_ONLYOFFICE_DOCUMENT_SERVER_URL` is set to the
browser-visible document server URL; otherwise XLSX files fall back to Doya's
built-in table preview.

When the document server downloads a file, it cannot use the host machine's
`localhost:6767`, so the app rewrites local file URLs to
`host.docker.internal:6767`. The compose file maps `host.docker.internal` to the
Docker host gateway for Linux-compatible runtimes.

The web app embeds ONLYOFFICE Docs with `DocsAPI.DocEditor`, which renders the
editor inside an iframe. Community Document Server does not expose the external
Automation API connector (`docEditor.createConnector()`), so XLSX annotation
selection cannot rely on the outer app reading the editor directly. The preview
uses a small autostart ONLYOFFICE plugin bridge instead: the plugin runs inside
the editor, reads `Api.GetActiveSheet().GetSelection()`, and reports the latest
selection to the daemon for the app to consume.

## Typecheck

Run typecheck manually when requested, during release/commit verification that
requires it, or when a high-risk change needs broader validation:

```bash
npm run typecheck
```
