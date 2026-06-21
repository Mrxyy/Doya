# Doya 术语表

本文档是权威术语来源。UI label 优先。不要发明同义词，使用这里定义的词。

- **Project**：过渡期本地标签，账号 UI 现在把它呈现为一条历史对话。在 control-plane 模型中会变成 **Session**。迁移期间代码仍使用 `ProjectSummary`（`packages/app/src/utils/projects.ts:22`）和 `projectKey`（`packages/server/src/server/workspace-registry-model.ts:16`）。UI 禁止使用：`Repo`、`Repository`。
- **Workspace**：一个 daemon 上的具体 `cwd`，带 git 状态，并且只属于一个 project。UI：`Workspace`。代码：`WorkspaceDescriptorPayload`（`packages/protocol/src/messages.ts:2178`）。不要和 Branch 混淆；一个 branch 可以通过 worktree 支撑多个 workspace。UI 禁止使用：`Folder`、`Directory`。
- **Workspace kind**：`"directory" | "local_checkout" | "worktree"`。代码：`PersistedWorkspaceKind`（`packages/server/src/server/workspace-registry-model.ts:8`）。
- **Agent**：执行者。它是 daemon 中某个 runtime workspace 里正在运行的一次 AI 编程任务，拥有 provider/model/`cwd`/timeline，但不是持久化用户历史对象。UI：`Agent` / `New Agent`。代码：`AgentSnapshotPayload`（`packages/protocol/src/messages.ts:608`）。禁止使用：`Task`、`Job`、`Run`。
- **Daemon**：本地 Doya server 进程，通过 `serverId` 标识。UI：仅系统上下文使用 `Daemon`。代码：`ServerInfoStatusPayloadSchema` 中的 `serverId`（`packages/protocol/src/messages.ts:1936`）、`DaemonClient`（`packages/client/src/daemon-client.ts`）。
- **Daemon node**：control-plane 中记录一个可接收 runtime allocation 的 daemon。代码：`DaemonNodeRecord`（`packages/control/src/domain.ts`）。UI 除非明确解释架构，否则使用 `Daemon`。
- **Runtime scheduler**：control-plane 为新 runtime allocation 选择 daemon node 的策略入口。不要使用 default daemon 概念；新 Session / AI creation 必须通过 scheduler 分配 daemon。
- **Draining daemon**：保留既有 runtime 继续运行，但不应接收新 runtime allocation 的 daemon。UI：admin/operator 表面使用 `draining`。
- **Host**：客户端连接 profile，指向 daemon，并包含一个或多个 `HostConnection`。UI：`Host` / `Add host` / `Switch host`。代码：`HostProfile`（`packages/app/src/types/host-connection.ts:37`）。禁止用 `Connection` 表示 host，因为它指的是 `HostConnection`。
- **Project host entry**：project 中某个单独 `(project, daemon)` 组合的一行，聚合该 daemon 在此 project 下的 workspace。内部概念。代码：`ProjectHostEntry`（`packages/app/src/utils/projects.ts:11`）。不要引入 `Checkout` 作为同义词。
- **Placement**：某个 workspace 与 project 的关系，包括 projectKey、projectName、git checkout snapshot。内部概念。代码：`ProjectPlacementPayload`（`packages/protocol/src/messages.ts:2113`）。
- **Branch**：普通 git branch。UI：`Switch branch`。代码：`WorkspaceGitRuntimePayloadSchema` 中的 `currentBranch`（`packages/protocol/src/messages.ts:2136`）、`BranchSwitcher`（`packages/app/src/components/branch-switcher.tsx`）。
- **Worktree**：Doya 管理的 git worktree（`~/.doya/worktrees/{name}`），也是一个 `workspaceKind` 值。UI：仅 CLI 和 `doya.json` key（`worktree.setup`、`worktree.teardown`）使用。代码：`ProjectCheckoutLiteGitDoyaPayload`（`packages/protocol/src/messages.ts:2092`）、CLI `doya worktree`（`packages/cli/src/commands/worktree/index.ts:8`）。禁止用 `Checkout` 作为同义词。
- **Repository / Remote**：用于推导 `projectKey` 的内部 git 输入（`remoteUrl`、`mainRepoRoot`）。不作为 UI label。
- **Session**：面向用户的历史对话和工作意图；它由 `New session` 创建，并可从历史中重新打开。它拥有 title、messages、artifacts、status 和 `workingContext`，但不拥有 daemon node 或 `cwd`。代码：`SessionRecord`（`packages/control/src/domain.ts`）。当前 legacy account projects 正在迁移到这个概念。
- **Daemon client session**：客户端到 daemon 的单次连接 session。内部概念。代码：`Session`（`packages/server/src/server/session.ts`）。不要和面向用户的 Session 或 provider 侧 agent session log 混淆。
- **Runtime allocation**：执行位置；是 Session 到 daemon node/runtime workspace 的临时绑定。它拥有 `runtimeId`、`nodeId`、`workspaceDir`、status 和 heartbeat。代码：`RuntimeAllocationRecord`（`packages/control/src/domain.ts`）。`cwd`/`workspaceDir` 属于这里，不属于 Session。
- **Session-agent binding**：live-agent 指针；control-plane 记录某个 Session 当前应该打开哪个 daemon Agent。它拥有 `sessionId`、`nodeId`、`agentId`、可选 `workspaceId`/`cwd` 和 binding status。代码：`SessionAgentBindingRecord`（`packages/control/src/domain.ts`）。如果 daemon 已没有该 agent，binding 可能过期。
- **User daemon workspace**：一个 daemon 上属于某个用户的基础目录，用于存放该用户的 runtime workdir。代码：`UserDaemonWorkspaceRecord`（`packages/control/src/domain.ts`）。UI：admin 表面使用 `User workspace` / `用户工作区`。
- **Deleted session workdir**：daemon 本地 runtime 目录，其所属 control Session 已被 soft-delete，并且文件已成功删除。代码：`SessionRecord.workDirDeletedAt`。一旦设置，admin overview 应从 cleanup list 隐藏该 session。
- **Profile**：host 持久化形态的内部名称。代码：`HostProfile`（`packages/app/src/types/host-connection.ts:37`）。永远不要面向用户。
- **Provider**：agent 后端，例如 Claude Code、Codex、Copilot、OpenCode、Pi。UI：`Provider`。代码：`ProviderSnapshotEntry`（`packages/protocol/src/messages.ts:198`）。
- **Provider capability**：daemon 级 provider 可用性快照，包括某个 provider 在某个 daemon 上的 enabled/available/error/model state。它不是全局 provider account setting。
- **Model**：provider 提供的具体 LLM。UI：`Model` / `Select model`。代码：`AgentModelDefinition`（`packages/protocol/src/messages.ts:187`）。
- **Terminal**：workspace 级 PTY shell，通过 binary mux channel streaming。UI：`Terminal`。代码：`TerminalStreamFrame`（`packages/protocol/src/terminal-stream-protocol.ts`）。
- **Schedule**：cron 风格触发器，用于创建新 agents。UI：CLI/MCP（`doya schedule`、`create_schedule`）。不要和 Heartbeat 或 Loop 混淆；Heartbeat 是 cron prompt 回同一个 agent，Loop 是一个 agent 的迭代重执行。
- **Heartbeat**：cron 风格 prompt，发送回同一个 agent/conversation。MCP：`create_heartbeat`。适合提醒和 babysitting，状态应回到同一对话内。
- **Mode**：provider 特定运行模式，例如 plan、default、full-access。UI：只使用 icon。代码：`AgentSessionConfig` 中的 `modeId`（`packages/protocol/src/messages.ts:257`）。
- **Attachment**：绑定到 agent prompt 的 GitHub PR 或 Issue。UI：`Attach issue or PR`。代码：`AgentAttachment`（`packages/protocol/src/messages.ts:782`）。
- **Composer**：向 agent 发送工作的完整 prompt 表面。代码：`Composer`（`packages/app/src/composer/index.tsx`）。除了文本输入子组件，不要把它叫 `message input`。
- **Composer input**：composer 内的文本输入表面。代码：`MessageInput`（`packages/app/src/composer/input/input.tsx`）。
- **Composer toolbar**：composer input 底部控制行，包含 agent controls、attachment button、voice controls、stop/send controls。代码：`MessageInput` 中的 `leftContent`、`beforeVoiceContent`、`rightContent` slots（`packages/app/src/composer/input/input.tsx`）。禁止使用：`Status bar`。
- **Agent controls**：agent 或 draft agent 的 Provider、model、mode、thinking 和 provider-feature controls。代码：`AgentControls` / `DraftAgentControls`（`packages/app/src/composer/agent-controls/index.tsx`）。禁止使用：`Agent status bar`。
- **Composer footer**：渲染在 composer input 下方、但仍属于 keyboard-shifted composer layout 的可选区域。代码：`Composer.footer`（`packages/app/src/composer/index.tsx`）。
- **Composer track**：composer input 上方的上下文 lane。具体 track 使用 `<thing> track` 形式，例如 **Queue track**、**Subagents track**。代码：`Composer` 内 queue track（`packages/app/src/composer/index.tsx`）、`SubagentsTrack`（`packages/app/src/subagents/track.tsx`）。
- **Attachment tray**：composer input 中、text input 上方的 selected attachments 行。代码：`renderAttachmentTray`（`packages/app/src/composer/index.tsx`）。禁止使用：`Attachment bar`。
- **Conflict**：有两个不同含义；UI 文案不要裸用这个词，必须说明是哪一种：（a）`doya.json` 的 **stale-write conflict**（`Config changed on disk`，code `stale_project_config`，`packages/app/src/screens/project-settings-screen.tsx:593`）；（b）**git merge conflict**（当前没有 UI string）。

## 不一致点（记录下来，不粉饰）

- CLI `--host <host>` 描述 `"Daemon host target"`（`packages/cli/src/utils/command-options.ts:5`）模糊了 daemon/host；app 里保持二者区分。
- `WorkspaceDescriptorPayloadSchema.workspaceKind` 在线路协议中接受 legacy `"checkout"`（`packages/protocol/src/messages.ts:2187`），但 `PersistedWorkspaceKind` 不接受（`packages/server/src/server/workspace-registry-model.ts:8`）。
