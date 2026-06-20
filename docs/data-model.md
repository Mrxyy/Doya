# Data Model

Doya uses **file-based JSON persistence** instead of a traditional database. All data is validated at runtime with Zod schemas. Most stores write atomically (write to temp file, then rename); a few still use plain `writeFile` — see each section. There is no schema-versioning/migration framework — schemas rely on optional fields with defaults for forward compatibility, with a small amount of inline normalization in `persisted-config.ts` for legacy provider/speech entries.

Today most daemon-side stores live under `$DOYA_HOME` (defaults to `~/.doya`).
In the session-centered target model, durable user/session data belongs to the
control plane while `$DOYA_HOME` belongs to one daemon node.

The local control package stores control-plane records in:

```text
$DOYA_CONTROL_HOME/control.json
```

It owns users, sessions, session messages, artifact metadata, file snapshots,
daemon node inventory, and runtime allocation records. This is separate from
daemon-local runtime directories.

Control sessions use soft-delete timestamps for user-facing deletion. When an
admin later cleans up a deleted session's daemon-local working directory, the
session records `workDirDeletedAt`; older control files read without that field
are normalized to `null`. Admin overviews hide sessions with
`workDirDeletedAt`, so a cleaned daemon workdir does not reappear after refresh.

Account/workspace records are legacy daemon-local data. The daemon maps a
registered user to an automatically assigned workspace directory, and projects
created from the app become subdirectories inside that user's workspace. See
[multi-tenant](multi-tenant/README.md).

New durable work should be represented as control-plane sessions.
`accounts.projects.cwd` is a compatibility field and must not be treated as
the owner of a user's session history.

Control file snapshots store uploaded-file workspace inputs by `snapshotId`.
The durable `Session.workingContext` keeps only `{ type: "uploaded_files",
snapshotId }`; the file contents live in `fileSnapshots` and are sent to the
selected daemon only when leasing/restoring a runtime.

Runtime sync writes provider timeline events back into `sessionMessages` and
artifact metadata into `artifacts` through the control runtime-sync API. The
control API accepts these writes only when the supplied
`(sessionId, runtimeId, nodeId)` matches a persisted `runtimeAllocation`.
Artifact writes use `externalId` as an upsert key within a session. Timeline
`artifact` items are stored as artifact metadata instead of daemon-local UI
state, with the inline artifact payload retained in metadata. Each accepted
runtime-sync write refreshes the allocation `lastHeartbeatAt`, so the control
record reflects live daemon activity instead of only the original lease time.
The local control JSON store is separate from legacy daemon `accounts.json`;
control data lives under `$DOYA_CONTROL_HOME`, while daemon-local account
compatibility data still lives under `$DOYA_HOME/accounts`.
Daemon node records may carry an internal runtime auth token so the control
plane can call password-protected Runtime APIs. HTTP node responses must strip
that field; it is an internal scheduler credential, not session or user history.

Runtime allocations are durable lease records, not proof that a daemon still has
the runtime in memory. The daemon exposes `/api/runtimes/:runtimeId/status` so
the control plane can probe runtime liveness. Today the app confirms an internal
control-agent binding still points at an existing daemon agent before navigating
to it. Target runtime leasing will mark missing or unreachable allocations
`lost`, then lease the session onto an available daemon and rebuild it from its
`workingContext`.

Runtime allocations are provider-aware. New records may include `providerId`,
`modelId`, and `selectionReason`; older records read without these fields are
normalized to `null`. These fields describe the scheduling decision for a
runtime lease, not the durable Session identity. Provider capability itself is
daemon-scoped: the same provider can be available on one daemon, disabled on
another, and unauthenticated on a third.

Billing data also belongs to the control plane and is stored in the same
`$DOYA_CONTROL_HOME/control.json` file. Older control files read without billing
fields are normalized with default settings, Free/Pro plans, and empty billing
collections; there is still no migration framework.

Billing collections:

- `billingSettings` — display currency (`CNY`), USD/CNY rate, token markup
  multiplier, monthly grants, and referral reward limits.
- `plans` — Free and Pro plan definitions, including monthly AI grant and
  workspace/upload byte limits.
- `modelPricing` — enabled provider/model token pricing in USD per token,
  plus a `supportsUsageAccounting` gate. A model can have a price but still be
  blocked from billable runtime starts if it cannot report real usage.
- `billingAccounts` — per-user plan, billing status, current period, and cached
  balance. The cached balance is derived from ledger entries and is not the
  source of truth.
- `creditLedger` — every balance mutation: monthly grants, top-ups, usage
  charges, referral rewards, and admin adjustments.
- `paymentOrders` — real payment gateway orders for plan upgrades. Orders store
  the user, plan, billing period, payment channel, local and provider trade
  numbers, payable amount, gateway payment targets, raw gateway response, raw
  notify payload, and status. Payment notify confirmation is the source of truth
  for upgrading a plan; return URLs are only a user-experience redirect.
- `usageLogs` — append-only billable turn records. Each record stores user,
  session, runtime, node, agent, provider/model, turn/request attribution, token
  buckets, cost buckets, pricing snapshot, USD/CNY rate, token markup
  multiplier, and `createdAt`.
- `storageQuotas` — per-user uploaded/generated/workspace byte usage and active
  byte limits.
- `referrals` — inviter/invitee relationship, reward status, rejection reason,
  and linked ledger entries.

Usage billing is idempotent by `requestId + requestFingerprint`. A repeated
turn with the same fingerprint returns the existing usage log and does not write
a second ledger charge. A repeated `requestId` with a different fingerprint is a
conflict and must not overwrite history. Usage statistics aggregate from
`usageLogs`; changing pricing, exchange rate, or markup later does not rewrite
historical usage because each log stores its own pricing and rate snapshot.

Runtime allocation is the control-plane start gate for billable work. If a
runtime allocation includes `providerId` and `modelId`, billing preflight checks
account status, available balance, workspace quota, and enabled model pricing
before the allocation is persisted. Pricing must also opt into real usage
accounting; Doya does not estimate usage for unsupported providers/models.
Billing accounts roll into a new monthly period when they are next touched after
`currentPeriodEnd`; the store writes one `monthly_grant` ledger entry for the
new period and refreshes the cached balance from ledger facts.

File snapshots count toward `uploadedBytesUsed` before they are persisted.
Runtime artifacts with inline content count toward `generatedBytesUsed`; artifact
upserts adjust generated storage by content-size delta. Storage overages update
the billing account status but never delete user files. Control can ask daemon
nodes to scan `/api/user-workspaces/scan`; the returned total workspace bytes are
merged with uploaded bytes to refresh `generatedBytesUsed`. Runtime turn
completion, failure, and cancellation events schedule the same scan
asynchronously so generated workspace files are eventually reflected without
blocking timeline sync.

Referral codes are derived from the inviter user id. Binding a code creates one
invitee referral, writes the invitee bonus ledger entry, and later qualifies the
inviter reward when the invitee creates a session or records real usage, subject
to the configured daily and monthly reward caps. Referral bindings may carry a
source fingerprint derived from client id and request IP; high-frequency
bindings from the same source are stored as `rejected` and do not receive bonus
ledger entries.

Admin billing usage views accept the same aggregation filters used by the store:
time range, user, session, provider, model, and plan. Filtered admin usage logs
and aggregate metrics are always derived from `usageLogs`.

---

## Directory layout

```
$DOYA_HOME/
├── config.json                          # Daemon configuration
├── server-id                            # Stable daemon identifier (plain text, "srv_<base64url>")
├── daemon-keypair.json                  # E2EE keypair for relay (mode 0600)
├── doya.pid                            # Daemon PID lock file
├── daemon.log                           # Default log file (path configurable)
├── agents/
│   └── {sanitized-cwd}/
│       └── {agentId}.json               # One file per agent
├── runtimes/
│   └── {runtimeId}/
│       └── workspace/                   # Control-plane allocated runtime workspace
├── recordings/
│   └── {agentId}/
│       └── {recordingId}.json           # Manual conversation replay recordings
├── schedules/
│   └── {scheduleId}.json                # One file per schedule
├── chat/
│   └── rooms.json                       # All rooms + messages
├── loops/
│   └── loops.json                       # All loop records
├── projects/
│   ├── projects.json                    # Project registry
│   └── workspaces.json                  # Workspace registry
├── accounts/
│   ├── accounts.json                    # Users, assigned workspaces, projects
│   └── workspaces/
│       └── {workspaceId}/projects/...   # User project execution directories
└── push-tokens.json                     # Expo push notification tokens
```

The `agents/{sanitized-cwd}/` directory name is derived from the agent's `cwd` by stripping the filesystem root and replacing path separators with `-` (Windows drive letters become a `C-` style prefix). Atomic writes (temp file + rename): agent records, chat, project/workspace registries, push tokens. Non-atomic (plain `writeFile`): `config.json`, `schedules/*.json`, `loops/loops.json`, `server-id`, `daemon-keypair.json`.

---

## 1. Agent Record

**Path:** `$DOYA_HOME/agents/{project-dir}/{agentId}.json`

Each agent is stored as a separate JSON file, grouped by project directory.

| Field                | Type                                     | Description                                                                                                                                                              |
| -------------------- | ---------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `id`                 | `string`                                 | UUID, primary key                                                                                                                                                        |
| `provider`           | `string`                                 | Agent provider (`"claude"`, `"codex"`, `"opencode"`, etc.)                                                                                                               |
| `cwd`                | `string`                                 | Working directory the agent operates in                                                                                                                                  |
| `createdAt`          | `string` (ISO 8601)                      | Creation timestamp                                                                                                                                                       |
| `updatedAt`          | `string` (ISO 8601)                      | Last update timestamp                                                                                                                                                    |
| `lastActivityAt`     | `string?` (ISO 8601)                     | Last activity timestamp                                                                                                                                                  |
| `lastUserMessageAt`  | `string?` (ISO 8601)                     | Last user message timestamp                                                                                                                                              |
| `title`              | `string?`                                | User-visible title                                                                                                                                                       |
| `labels`             | `Record<string, string>`                 | Key-value labels (default `{}`). `doya.parent-agent-id` set automatically when launched via the `create_agent` MCP tool — see [agent-lifecycle.md](./agent-lifecycle.md) |
| `lastStatus`         | `AgentStatus`                            | One of: `"initializing"`, `"idle"`, `"running"`, `"error"`, `"closed"`                                                                                                   |
| `lastModeId`         | `string?`                                | Last active mode ID                                                                                                                                                      |
| `config`             | `SerializableConfig?`                    | Agent session configuration (see below)                                                                                                                                  |
| `runtimeInfo`        | `RuntimeInfo?`                           | Live runtime state (see below)                                                                                                                                           |
| `features`           | `AgentFeature[]?`                        | Provider-reported features (toggles/selects)                                                                                                                             |
| `persistence`        | `PersistenceHandle?`                     | Handle for resuming sessions                                                                                                                                             |
| `lastUsage`          | `AgentUsage?`                            | Last provider usage snapshot for context-window display and compatibility with older clients                                                                             |
| `turnUsageById`      | `Record<string, AgentUsage>?`            | Per-turn usage snapshots keyed by provider turn id so message footers can be restored after app refresh                                                                  |
| `lastError`          | `string?` (nullable)                     | Last error message, if any                                                                                                                                               |
| `requiresAttention`  | `boolean?`                               | Whether the agent needs user attention                                                                                                                                   |
| `attentionReason`    | `"finished" \| "error" \| "permission"?` | Why attention is needed                                                                                                                                                  |
| `attentionTimestamp` | `string?` (ISO 8601)                     | When attention was flagged                                                                                                                                               |
| `internal`           | `boolean?`                               | Whether this is a system-internal agent (loop workers, etc.)                                                                                                             |
| `archivedAt`         | `string?` (ISO 8601)                     | Soft-delete timestamp                                                                                                                                                    |

### Nested: SerializableConfig

| Field              | Type                       | Description                  |
| ------------------ | -------------------------- | ---------------------------- |
| `title`            | `string?`                  | Configured title             |
| `modeId`           | `string?`                  | Configured mode              |
| `model`            | `string?`                  | Configured model             |
| `thinkingOptionId` | `string?`                  | Thinking/reasoning level     |
| `featureValues`    | `Record<string, unknown>?` | Feature preference overrides |
| `extra`            | `Record<string, any>?`     | Provider-specific config     |
| `systemPrompt`     | `string?`                  | Custom system prompt         |
| `mcpServers`       | `Record<string, any>?`     | MCP server configurations    |

### Nested: RuntimeInfo

| Field              | Type                       | Description                    |
| ------------------ | -------------------------- | ------------------------------ |
| `provider`         | `string`                   | Active provider                |
| `sessionId`        | `string?`                  | Active session ID              |
| `model`            | `string?`                  | Active model                   |
| `thinkingOptionId` | `string?`                  | Active thinking option         |
| `modeId`           | `string?`                  | Active mode                    |
| `extra`            | `Record<string, unknown>?` | Provider-specific runtime data |

### Nested: PersistenceHandle

| Field          | Type                   | Description                                                           |
| -------------- | ---------------------- | --------------------------------------------------------------------- |
| `provider`     | `string`               | Provider that owns the session                                        |
| `sessionId`    | `string`               | Session ID for resumption                                             |
| `nativeHandle` | `any?`                 | Provider-specific handle (Codex thread ID, Claude resume token, etc.) |
| `metadata`     | `Record<string, any>?` | Extra metadata                                                        |

### Nested: AgentFeature (discriminated union on `type`)

**Toggle:**

| Field         | Type       |
| ------------- | ---------- |
| `type`        | `"toggle"` |
| `id`          | `string`   |
| `label`       | `string`   |
| `description` | `string?`  |
| `tooltip`     | `string?`  |
| `icon`        | `string?`  |
| `value`       | `boolean`  |

**Select:**

| Field         | Type                  |
| ------------- | --------------------- |
| `type`        | `"select"`            |
| `id`          | `string`              |
| `label`       | `string`              |
| `description` | `string?`             |
| `tooltip`     | `string?`             |
| `icon`        | `string?`             |
| `value`       | `string \| null`      |
| `options`     | `AgentSelectOption[]` |

## 2. Conversation Recording

**Path:** `$DOYA_HOME/recordings/{agentId}/{recordingId}.json`

Manual conversation recordings are stored separately from the agent timeline.
The timeline remains the authoritative reading history; a recording is a replay
fact log with raw timing. In the app, replay temporarily projects the normal
chat surface: unrecorded timeline areas appear immediately, while recorded
events are emitted according to their offsets. Each recording stores metadata
(`recordingId`, `agentId`,
`provider`, `cwd`, `startedAt`, `stoppedAt`, `status`, `title`), append-only
`events`, and editable replay `edits`.

Recording events are ordered by `seq` and carry daemon-owned `recordedAt` and
relative `offsetMs`. User submissions are stored as `user_input` with the submit
source, request id, cwd, message id, text, image payload metadata, and
attachments. Provider stream events are stored as `agent_stream_raw` after
provider normalization but before the normal stream coalescer/projection path.
Edits are keyed by event sequence and only affect playback (`offsetMs`,
`hidden`); they do not rewrite the original event log.

---

## 3. Daemon Configuration

**Path:** `$DOYA_HOME/config.json`

Single file, validated with `PersistedConfigSchema`.

```
{
  version: 1,
  daemon: {
    listen: "127.0.0.1:6767",
    hostnames: true | string[],   // legacy alias `allowedHosts` is migrated on load
    mcp: { enabled: boolean, injectIntoAgents: boolean },
    appendSystemPrompt: string,    // appended to supported provider system/developer prompts
    cors: { allowedOrigins: string[] },
    relay: { enabled: boolean, endpoint: string, publicEndpoint: string, useTls: boolean, publicUseTls: boolean },
    auth: { password: string }    // bcrypt hash, optional
  },
  app: {
    baseUrl: string
  },
  worktrees?: {
    root?: string            // optional root for new worktrees; defaults to $DOYA_HOME/worktrees
  },
  providers: {
    openai: { apiKey: string },
    local: { modelsDir: string }
  },
  agents: {
    // ProviderOverrideSchema; legacy entries with `command: { mode, ... }` are migrated to the
    // current shape on load via `migrateProviderSettings`. Custom provider IDs must declare
    // `extends` (one of the built-ins or `"acp"`) and `label`. See `provider-launch-config.ts`.
    providers: Record<providerId, ProviderOverride>,
    metadataGeneration: {
      providers: [{ provider, model?, thinkingOptionId? }]
    }
  },
  features: {
    dictation: { enabled, stt: { provider, model, language, confidenceThreshold } },
    voiceMode: { enabled, llm, stt: { provider, model, language }, turnDetection, tts: { provider, model, voice, speakerId, speed } }
  },
  log: {
    level, format,
    console: { level, format },
    file: { level, path, rotate: { maxSize, maxFiles } }
  }
}
```

All fields are optional with sensible defaults.

`agents.metadataGeneration.providers` controls the preferred structured-generation fallback order for daemon-side metadata tasks such as commit messages, PR text, branch names, and generated agent titles. Entries are tried first in the configured order, then Doya falls through to dynamically discovered defaults and finally the current selection when available.

Local speech model ids are intentionally narrow: STT uses `parakeet-tdt-0.6b-v2-int8`, TTS uses `kokoro-en-v0_19`, and turn detection uses the bundled Silero VAD model.

---

## Control plane records

**Path:** `$DOYA_CONTROL_HOME/control.json`

The local control plane stores all records in one atomic JSON file. There is no
migration framework, so new fields are optional on read and normalized to safe
defaults.

### DaemonNode

| Field              | Type                                  | Description                                                              |
| ------------------ | ------------------------------------- | ------------------------------------------------------------------------ |
| `id`               | `string`                              | Stable daemon `serverId`; used as control-plane `nodeId`                 |
| `endpoint`         | `string`                              | Runtime API endpoint used by the control plane                           |
| `status`           | `"online" \| "offline" \| "draining"` | Scheduler state; `draining` stops new runtime leases                     |
| `capabilities`     | `unknown`                             | Forward-compatible daemon capability payload                             |
| `runtimeAuthToken` | `string \| null`                      | Internal credential for runtime API calls; stripped from public payloads |
| `doyaHome`         | `string \| null`                      | Daemon-local home path, admin-only                                       |
| `lastHeartbeatAt`  | `string`                              | Last registration/heartbeat/update time                                  |
| `createdAt`        | `string`                              | Creation time                                                            |

Provider capability belongs to a daemon node. Target provider snapshots should
record at least:

| Field           | Type                                                             | Description                                    |
| --------------- | ---------------------------------------------------------------- | ---------------------------------------------- |
| `nodeId`        | `string`                                                         | Daemon node                                    |
| `providerId`    | `string`                                                         | `claude`, `codex`, `copilot`, `opencode`, `pi` |
| `enabled`       | `boolean`                                                        | Whether this daemon accepts new runtime leases |
| `availability`  | `"available" \| "not_installed" \| "unauthenticated" \| "error"` | Current provider state on this daemon          |
| `models`        | `Array<{ id: string; label?: string }>`                          | Models usable for scheduling                   |
| `version`       | `string \| null`                                                 | Provider/binary version if known               |
| `binaryPath`    | `string \| null`                                                 | Provider executable path if known              |
| `lastRefreshAt` | `string \| null`                                                 | Last explicit capability refresh               |
| `lastError`     | `string \| null`                                                 | Last provider error                            |

### RuntimeAllocation

| Field             | Type                                             | Description                                                        |
| ----------------- | ------------------------------------------------ | ------------------------------------------------------------------ |
| `id`              | `string`                                         | Allocation id                                                      |
| `runtimeId`       | `string`                                         | Runtime lease id, usually `rt_${sessionId}` during migration       |
| `sessionId`       | `string`                                         | Session being executed                                             |
| `nodeId`          | `string`                                         | Selected daemon node                                               |
| `providerId`      | `string \| null`                                 | Provider selected for this runtime lease                           |
| `modelId`         | `string \| null`                                 | Model selected for this runtime lease                              |
| `selectionReason` | `string \| null`                                 | Scheduler explanation such as `default_available` or `lowest_load` |
| `userWorkspaceId` | `string \| null`                                 | User-daemon workspace backing this runtime                         |
| `workspaceDir`    | `string`                                         | Daemon-local runtime working directory                             |
| `status`          | `"starting" \| "running" \| "stopped" \| "lost"` | Runtime lease state                                                |
| `leasedAt`        | `string`                                         | Lease creation time                                                |
| `releasedAt`      | `string \| null`                                 | Stop/lost time                                                     |
| `lastHeartbeatAt` | `string`                                         | Last runtime-sync or touch time                                    |

`providerId`, `modelId`, and `selectionReason` are nullable for records created
before provider-aware scheduling. They should be filled for all new allocations,
including migration flows where the app still preselects a direct daemon.

### SessionAgentBinding

| Field             | Type                               | Description                               |
| ----------------- | ---------------------------------- | ----------------------------------------- |
| `sessionId`       | `string`                           | Durable Session                           |
| `nodeId`          | `string`                           | Daemon hosting the live agent             |
| `agentId`         | `string`                           | Daemon-local agent id                     |
| `userWorkspaceId` | `string \| null`                   | User-daemon workspace                     |
| `workspaceId`     | `string \| null`                   | Daemon workspace descriptor id            |
| `cwd`             | `string \| null`                   | Daemon-local cwd                          |
| `status`          | `"active" \| "lost" \| "archived"` | Whether this pointer can still be trusted |

SessionAgentBinding is a live pointer, not the source of durable history. If the
daemon loses the agent, the binding becomes stale and the Session can be leased
again through provider-aware scheduling.

---

## 4. Schedule

**Path:** `$DOYA_HOME/schedules/{id}.json`

One file per schedule. ID is 8 hex characters. Writes are direct (not atomic).

| Field       | Type                                  | Description                      |
| ----------- | ------------------------------------- | -------------------------------- |
| `id`        | `string`                              | 8-char hex ID                    |
| `name`      | `string?`                             | Human-readable name              |
| `prompt`    | `string`                              | The prompt to send               |
| `cadence`   | `ScheduleCadence`                     | Timing (see below)               |
| `target`    | `ScheduleTarget`                      | What to run (see below)          |
| `status`    | `"active" \| "paused" \| "completed"` | Current state                    |
| `createdAt` | `string` (ISO 8601)                   |                                  |
| `updatedAt` | `string` (ISO 8601)                   |                                  |
| `nextRunAt` | `string?` (ISO 8601)                  | Next scheduled execution         |
| `lastRunAt` | `string?` (ISO 8601)                  | Last execution time              |
| `pausedAt`  | `string?` (ISO 8601)                  | When paused                      |
| `expiresAt` | `string?` (ISO 8601)                  | Auto-expire time                 |
| `maxRuns`   | `number?`                             | Max executions before completing |
| `runs`      | `ScheduleRun[]`                       | Execution history                |

### Nested: ScheduleCadence (discriminated union on `type`)

- `{ type: "every", everyMs: number }` — interval in milliseconds
- `{ type: "cron", expression: string, timezone?: string }` — cron expression; absent `timezone` means UTC, present `timezone` is an IANA time zone used for local wall-clock recurrence

### Nested: ScheduleTarget (discriminated union on `type`)

- `{ type: "agent", agentId: string }` — send to existing agent
- `{ type: "new-agent", config: { provider, cwd, modeId?, model?, thinkingOptionId?, title?, approvalPolicy?, sandboxMode?, networkAccess?, webSearch?, extra?, systemPrompt?, mcpServers? } }` — create a new agent

### Nested: ScheduleRun

| Field          | Type                                   | Description             |
| -------------- | -------------------------------------- | ----------------------- |
| `id`           | `string`                               | Run ID                  |
| `scheduledFor` | `string` (ISO 8601)                    | Intended execution time |
| `startedAt`    | `string` (ISO 8601)                    |                         |
| `endedAt`      | `string?` (ISO 8601)                   |                         |
| `status`       | `"running" \| "succeeded" \| "failed"` |                         |
| `agentId`      | `string?` (UUID)                       | Agent used for this run |
| `output`       | `string?`                              | Agent output text       |
| `error`        | `string?`                              | Error message if failed |

---

## 5. Chat

**Path:** `$DOYA_HOME/chat/rooms.json`

Single file containing all rooms and messages.

```json
{
  "rooms": [ ... ],
  "messages": [ ... ]
}
```

### ChatRoom

| Field       | Type                | Description                         |
| ----------- | ------------------- | ----------------------------------- |
| `id`        | `string` (UUID)     |                                     |
| `name`      | `string`            | Unique room name (case-insensitive) |
| `purpose`   | `string?`           | Room description                    |
| `createdAt` | `string` (ISO 8601) |                                     |
| `updatedAt` | `string` (ISO 8601) | Updated on each new message         |

### ChatMessage

| Field              | Type                | Description                         |
| ------------------ | ------------------- | ----------------------------------- |
| `id`               | `string` (UUID)     |                                     |
| `roomId`           | `string`            | FK to ChatRoom.id                   |
| `authorAgentId`    | `string`            | Agent ID of the author              |
| `body`             | `string`            | Message text (supports `@mentions`) |
| `replyToMessageId` | `string?`           | FK to another ChatMessage.id        |
| `mentionAgentIds`  | `string[]`          | Extracted `@mention` agent IDs      |
| `createdAt`        | `string` (ISO 8601) |                                     |

---

## 6. Loop

**Path:** `$DOYA_HOME/loops/loops.json`

Single file containing an array of all loop records. Writes are direct (not atomic) and serialized through an in-memory queue. On daemon startup any record with `status: "running"` is recovered as `"stopped"` with an interruption log entry.

| Field                   | Type                                                | Description                                |
| ----------------------- | --------------------------------------------------- | ------------------------------------------ |
| `id`                    | `string`                                            | 8-char UUID prefix                         |
| `name`                  | `string?`                                           | Human-readable name                        |
| `prompt`                | `string`                                            | Worker prompt                              |
| `cwd`                   | `string`                                            | Working directory                          |
| `provider`              | `string`                                            | Default provider                           |
| `model`                 | `string?`                                           | Default model                              |
| `modeId`                | `string?`                                           | Default mode ID                            |
| `workerProvider`        | `string?`                                           | Override provider for workers              |
| `workerModel`           | `string?`                                           | Override model for workers                 |
| `verifierProvider`      | `string?`                                           | Override provider for verifiers            |
| `verifierModel`         | `string?`                                           | Override model for verifiers               |
| `verifierModeId`        | `string?`                                           | Override mode ID for verifiers             |
| `verifyPrompt`          | `string?`                                           | LLM verification prompt                    |
| `verifyChecks`          | `string[]`                                          | Shell commands to run as checks            |
| `archive`               | `boolean`                                           | Whether to archive worker agents after use |
| `sleepMs`               | `number`                                            | Delay between iterations (ms)              |
| `maxIterations`         | `number?`                                           | Cap on iterations                          |
| `maxTimeMs`             | `number?`                                           | Total time budget (ms)                     |
| `status`                | `"running" \| "succeeded" \| "failed" \| "stopped"` |                                            |
| `createdAt`             | `string` (ISO 8601)                                 |                                            |
| `updatedAt`             | `string` (ISO 8601)                                 |                                            |
| `startedAt`             | `string` (ISO 8601)                                 |                                            |
| `completedAt`           | `string?` (ISO 8601)                                |                                            |
| `stopRequestedAt`       | `string?` (ISO 8601)                                |                                            |
| `iterations`            | `LoopIteration[]`                                   |                                            |
| `logs`                  | `LoopLogEntry[]`                                    |                                            |
| `nextLogSeq`            | `number`                                            | Monotonic log sequence counter             |
| `activeIteration`       | `number?`                                           | Currently executing iteration index        |
| `activeWorkerAgentId`   | `string?`                                           | Currently running worker agent             |
| `activeVerifierAgentId` | `string?`                                           | Currently running verifier agent           |

### Nested: LoopIteration

| Field               | Type                                                | Description              |
| ------------------- | --------------------------------------------------- | ------------------------ |
| `index`             | `number`                                            | 1-based iteration index  |
| `workerAgentId`     | `string?`                                           | Agent ID of the worker   |
| `workerStartedAt`   | `string` (ISO 8601)                                 |                          |
| `workerCompletedAt` | `string?` (ISO 8601)                                |                          |
| `verifierAgentId`   | `string?`                                           | Agent ID of the verifier |
| `status`            | `"running" \| "succeeded" \| "failed" \| "stopped"` |                          |
| `workerOutcome`     | `"completed" \| "failed" \| "canceled"?`            |                          |
| `failureReason`     | `string?`                                           |                          |
| `verifyChecks`      | `LoopVerifyCheckResult[]`                           | Shell check results      |
| `verifyPrompt`      | `LoopVerifyPromptResult?`                           | LLM verification result  |

### Nested: LoopLogEntry

| Field       | Type                                                 |
| ----------- | ---------------------------------------------------- |
| `seq`       | `number` (monotonic)                                 |
| `timestamp` | `string` (ISO 8601)                                  |
| `iteration` | `number?`                                            |
| `source`    | `"loop" \| "worker" \| "verifier" \| "verify-check"` |
| `level`     | `"info" \| "error"`                                  |
| `text`      | `string`                                             |

### Nested: LoopVerifyCheckResult

| Field         | Type                |
| ------------- | ------------------- |
| `command`     | `string`            |
| `exitCode`    | `number`            |
| `passed`      | `boolean`           |
| `stdout`      | `string`            |
| `stderr`      | `string`            |
| `startedAt`   | `string` (ISO 8601) |
| `completedAt` | `string` (ISO 8601) |

### Nested: LoopVerifyPromptResult

| Field             | Type                |
| ----------------- | ------------------- |
| `passed`          | `boolean`           |
| `reason`          | `string`            |
| `verifierAgentId` | `string?`           |
| `startedAt`       | `string` (ISO 8601) |
| `completedAt`     | `string` (ISO 8601) |

---

## 7. Project Registry

**Path:** `$DOYA_HOME/projects/projects.json`

Array of project records.

| Field         | Type                        | Description                              |
| ------------- | --------------------------- | ---------------------------------------- |
| `projectId`   | `string`                    | Primary key                              |
| `rootPath`    | `string`                    | Filesystem root of the project           |
| `kind`        | `"git" \| "non_git"`        |                                          |
| `displayName` | `string`                    |                                          |
| `createdAt`   | `string` (ISO 8601)         |                                          |
| `updatedAt`   | `string` (ISO 8601)         |                                          |
| `archivedAt`  | `string \| null` (ISO 8601) | Soft-delete timestamp; required nullable |

Active git projects are unique by normalized `rootPath`. Startup reconciliation repairs older bad
states by moving workspaces from duplicate path-keyed projects onto the canonical project,
preferring remote-keyed project IDs such as `remote:github.com/owner/repo`, then archiving the
emptied duplicate.

---

## 8. Workspace Registry

**Path:** `$DOYA_HOME/projects/workspaces.json`

Array of workspace records. A workspace is a specific working directory within a project.

| Field         | Type                                            | Description                    |
| ------------- | ----------------------------------------------- | ------------------------------ |
| `workspaceId` | `string`                                        | Primary key                    |
| `projectId`   | `string`                                        | FK to Project.projectId        |
| `cwd`         | `string`                                        | Filesystem path                |
| `kind`        | `"local_checkout" \| "worktree" \| "directory"` |                                |
| `displayName` | `string`                                        |                                |
| `createdAt`   | `string` (ISO 8601)                             |                                |
| `updatedAt`   | `string` (ISO 8601)                             |                                |
| `archivedAt`  | `string \| null` (ISO 8601)                     | Soft-delete; required nullable |

---

## 9. Push Token Store

**Path:** `$DOYA_HOME/push-tokens.json`

```json
{
  "tokens": ["ExponentPushToken[...]", ...]
}
```

Simple set of Expo push notification tokens. Loaded with permissive parsing (filters non-string entries). Persisted with atomic temp-file rename.

---

## 10. Daemon meta files

These small files are not validated as full Zod schemas but are persisted under `$DOYA_HOME` for daemon identity and runtime coordination.

| Path                  | Format                                                         | Notes                                                                             |
| --------------------- | -------------------------------------------------------------- | --------------------------------------------------------------------------------- |
| `server-id`           | Plain text, e.g. `srv_<base64url>`                             | Stable per-`$DOYA_HOME` daemon ID. Overridable via `DOYA_SERVER_ID` env.          |
| `daemon-keypair.json` | `{ v: 2, publicKeyB64, secretKeyB64 }` (libsodium box keypair) | E2EE relay identity. Written with mode `0600`. Regenerated if file is unreadable. |
| `doya.pid`            | JSON `{ pid, startedAt, ... }`                                 | PID lock; prevents two daemons sharing one `$DOYA_HOME`.                          |
| `daemon.log`          | Pino log output                                                | Default location; path/rotation configurable via `log.file` in `config.json`.     |

---

## Client-side stores (App)

These live in React Native `AsyncStorage` or browser `IndexedDB`, not on the daemon filesystem.

### Draft Store

**AsyncStorage key:** `doya-drafts` (version 2)

```typescript
{
  drafts: Record<draftKey, {
    input: {
      text: string,
      attachments: Array<
        | { kind: "image", metadata: AttachmentMetadata }
        | { kind: "file", metadata: AttachmentMetadata }
        | { kind: "github_issue", item: GitHubSearchItem }
        | { kind: "github_pr", item: GitHubSearchItem }
      >
    },
    lifecycle: "active" | "abandoned" | "sent",
    updatedAt: number,     // epoch ms
    version: number        // optimistic concurrency
  }>,
  createModalDraft: DraftRecord | null
}
```

### Attachment Store (Web)

**IndexedDB database:** `doya-attachment-bytes`, object store: `attachments`

Stores binary attachment blobs keyed by attachment ID.

Image and file composer attachments share `AttachmentMetadata` storage while they are local drafts.
When the user submits a message or creates an agent, user-supplied images and files are materialized
by the daemon into the conversation workspace under `attachments/`. Browser/native attachments are
uploaded to the daemon as a `multipart/form-data` HTTP request with a `file` field, while desktop
path-backed attachments are copied server-side. The prompt attachment gives the agent the
workspace-relative path to read, and user-message display stores workspace-backed image metadata
with that path plus the daemon raw-file URL. IndexedDB remains the draft/legacy byte store, not the
source of truth for submitted message images. Text-file inline encoding remains only as a
compatibility fallback for paths that do not yet provide a workspace materializer.

### AttachmentMetadata

| Field         | Type      | Description                    |
| ------------- | --------- | ------------------------------ |
| `id`          | `string`  | Unique attachment ID           |
| `mimeType`    | `string`  | MIME type                      |
| `storageType` | `string`  | Storage backend identifier     |
| `storageKey`  | `string`  | Key within the storage backend |
| `createdAt`   | `number`  | Epoch ms                       |
| `fileName`    | `string?` | Original filename              |
| `byteSize`    | `number?` | Size in bytes                  |
