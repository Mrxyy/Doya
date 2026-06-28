# 架构图

![Doya 架构总览](./doya-architecture-overview.png)

![Doya 多端构建与运行时流向](./doya-multiplatform-architecture-flow-cn-v2.png)

## 1. 产品闭环图

```mermaid
flowchart LR
  User["开发者 / 团队用户"]
  Platform["AI agent 工作台<br/>统一入口 / 会话 / 权限 / 状态"]
  Workspace["用户工作区<br/>项目目录 / 文件 / 终端 / Git"]
  Agents["多种 coding agent<br/>Codex / Claude Code / Copilot / OpenCode / 第三方插件"]
  Result["可交付结果<br/>代码修改 / PR / 脚本 / 文档 / 自动任务"]

  User -->|"提出任务、查看进展、确认权限"| Platform
  Platform -->|"创建项目、管理会话、分配执行目录"| Workspace
  Workspace -->|"提供真实工程上下文"| Agents
  Agents -->|"读写文件、运行命令、返回进度"| Workspace
  Workspace -->|"沉淀工程结果"| Result
  Result -->|"回到统一工作台"| Platform
```

架构重点：

- 核心对象是用户、工作台、工作区、agent 和交付结果。
- 工作台负责项目入口、会话状态、权限确认和 agent 编排。
- 工作区是执行边界，承载项目目录、文件系统、终端和 Git 状态。
- agent 在真实工程上下文中执行任务，结果沉淀回项目，而不是停留在聊天记录里。

## 2. 部署形态图

```mermaid
flowchart TB
  subgraph Clients["统一客户端"]
    Mobile["移动端"]
    Web["Web 端"]
    Desktop["桌面端"]
    CLI["命令行"]
  end

  subgraph LocalMode["本地桌面 runtime"]
    DesktopRuntime["Desktop managed daemon<br/>本机执行 / agent 编排"]
    LocalWorkspace["本机项目目录<br/>代码 / Git / 终端 / 依赖"]
    LocalAgents["本机 agent 进程<br/>Codex / Claude / Copilot / OpenCode"]
  end

  subgraph ControlMode["Control plane"]
    TenantGateway["账号入口<br/>登录 / 组织 / 成员"]
    TenantControl["商业控制面<br/>账号 / billing / session / 调度 / 审计"]
    HostedRuntime["托管或自有执行节点<br/>VM / 容器 / 开发机 / 私有服务器"]
    TenantAgents["隔离 agent 进程"]
  end

  subgraph Relay["可选远程连接层"]
    E2EE["端到端加密 relay<br/>只转发密文"]
  end

  Clients -->|"本机 / 内网直连"| DesktopRuntime
  Clients -.->|"无法直连时"| E2EE
  E2EE -.-> DesktopRuntime

  Clients -->|"账号登录"| TenantGateway
  TenantGateway --> TenantControl
  TenantControl --> HostedRuntime
  TenantControl -->|"runtime allocation"| DesktopRuntime
  DesktopRuntime -.->|"注册 / 心跳 / command polling"| TenantControl

  DesktopRuntime --> LocalWorkspace
  DesktopRuntime --> LocalAgents
  LocalAgents --> LocalWorkspace

  HostedRuntime --> TenantAgents
  TenantAgents --> HostedRuntime
```

架构重点：

- 同一套执行模型覆盖本地桌面 runtime 和远程 runtime：control 负责商业、账号、session 和调度，daemon 负责实际执行。
- 本地形态中，下载的桌面客户端内置并管理 daemon；代码、密钥、依赖、终端和 agent 进程留在用户机器。
- 远程形态中，control 选择托管或自有执行节点；具体任务下发到隔离 runtime。
- Relay 独立于 control，只负责在客户端无法直连 runtime daemon 时转发端到端加密流量。

## 3. 整体架构图

```mermaid
flowchart TB
  subgraph Access["用户访问层"]
    Mobile["移动端"]
    Web["Web 端"]
    Desktop["桌面端"]
    CLI["命令行"]
  end

  subgraph Connect["连接层"]
    Direct["直连 WebSocket"]
    Relay["E2E relay"]
    Gateway["云端租户网关"]
  end

  subgraph Control["控制与编排层<br/>本地 daemon 或远程多租户 server"]
    Account["账号 / 组织 / 工作区"]
    Session["会话与实时状态"]
    Orchestrator["Agent 编排引擎"]
    Permission["权限与安全确认"]
    Project["项目与执行目录"]
    Audit["审计与策略"]
  end

  subgraph Execution["执行层<br/>本机 / VM / 容器 / 私有服务器"]
    Runtime["执行节点"]
    Terminal["终端 / 脚本"]
    Files["文件系统"]
    Git["Git / 分支 / PR"]
  end

  subgraph AgentLayer["Agent 生态层"]
    Codex["Codex"]
    Claude["Claude Code"]
    Copilot["GitHub Copilot"]
    OpenCode["OpenCode"]
    Plugins["第三方 agent 插件"]
  end

  subgraph Data["数据层"]
    AccountData["账号 / 租户 / 工作区数据"]
    ProjectData["项目记录"]
    SessionData["会话与 agent 状态"]
    AuditData["权限与审计日志"]
    Logs["运行日志"]
  end

  Mobile --> Direct
  Mobile -.-> Relay
  Mobile --> Gateway
  Web --> Direct
  Web --> Gateway
  Desktop --> Direct
  Desktop -.-> Relay
  Desktop --> Gateway
  CLI --> Direct
  CLI --> Gateway

  Direct --> Session
  Relay --> Session
  Gateway --> Account
  Gateway --> Session
  Session --> Orchestrator
  Account --> Project
  Account --> Audit
  Project --> Runtime
  Orchestrator --> Permission
  Orchestrator --> AgentLayer
  AgentLayer --> Runtime

  Runtime --> Terminal
  Runtime --> Files
  Runtime --> Git

  Account --> AccountData
  Project --> ProjectData
  Session --> SessionData
  Audit --> AuditData
  Runtime --> Logs
```

架构重点：

- 访问层包含移动端、Web、桌面端和 CLI，所有客户端通过统一协议访问会话和 agent 状态。
- 连接层拆分为直连 WebSocket、端到端加密 relay、云端租户网关三类入口。
- 控制与编排层负责账号/组织/工作区、会话状态、agent 编排、权限确认、审计策略和项目到执行目录的映射。
- 执行层负责真实开发环境中的文件系统、终端、脚本、Git 和 agent 进程。
- 数据层保存账号/租户/工作区数据、项目记录、会话状态、权限审计和运行日志。

## 4. 多租户工作区隔离图

```mermaid
flowchart TB
  subgraph TenantPlane["租户控制面"]
    Login["登录 / 注册"]
    User["用户身份"]
    Tenant["组织 / 租户"]
    Role["成员角色"]
    WorkspacePolicy["工作区归属关系"]
    ProjectPolicy["项目访问权限"]
  end

  subgraph TenantA["租户 A"]
    MemberA["成员 A"]
    WorkspaceA["独立工作区 A"]
    AProject["项目 A"]
    ARuntime["隔离执行目录 / 节点"]
    AAgent["运行中的 agent"]
  end

  subgraph TenantB["租户 B"]
    MemberB["成员 B"]
    WorkspaceB["独立工作区 B"]
    BProject["项目 B"]
    BRuntime["隔离执行目录 / 节点"]
    BAgent["运行中的 agent"]
  end

  Login --> User
  User --> Tenant
  Tenant --> Role
  Role --> WorkspacePolicy
  WorkspacePolicy --> ProjectPolicy
  ProjectPolicy --> MemberA
  ProjectPolicy --> MemberB
  ProjectPolicy --> WorkspaceA
  ProjectPolicy --> WorkspaceB

  WorkspaceA --> AProject
  AProject --> ARuntime
  ARuntime --> AAgent

  WorkspaceB --> BProject
  BProject --> BRuntime
  BRuntime --> BAgent

  AAgent -.->|"不可读 / 不可执行"| BRuntime
  BAgent -.->|"不可读 / 不可执行"| ARuntime
```

架构重点：

- 多租户层级是租户、成员/角色、工作区、项目、执行节点。
- 权限校验发生在项目被打开、会话被创建、agent 被启动和敏感操作被确认之前。
- 项目是 agent 的最小授权执行边界；每个项目映射到独立执行目录或隔离执行节点。
- 隔离模型需要同时约束可见数据、可执行命令、运行日志和审计归属。

## 5. Agent 执行链路图

```mermaid
sequenceDiagram
  autonumber
  participant U as 用户
  participant UI as 多端工作台
  participant C as 控制面
  participant R as 执行节点
  participant A as Coding Agent
  participant P as 项目目录

  U->>UI: 选择项目并输入任务
  UI->>C: 创建或恢复会话
  C->>C: 校验用户、租户、项目和权限
  C->>R: 选择本地或远程执行节点
  R->>A: 在指定项目目录启动 agent
  A->>P: 读取代码、修改文件、运行命令
  P-->>A: 返回文件、终端和 Git 状态
  A-->>R: 返回进展、权限请求和结果
  R-->>C: 流式同步会话状态
  C-->>UI: 同步会话、状态和权限请求
  UI-->>U: 展示进度、结果和可确认操作

  alt 需要敏感操作
    A-->>R: 发起权限请求
    R-->>C: 转发权限请求
    C-->>UI: 展示确认
    U->>UI: 允许 / 拒绝
    UI->>C: 返回用户决策
    C->>R: 下发用户决策
    R->>A: 继续执行或停止操作
  end
```

架构重点：

- 用户请求先进入控制面，控制面完成用户、租户、项目和权限校验。
- 控制面根据项目路由选择本地或远程执行节点，并在指定项目目录启动 agent。
- 执行节点负责读取代码、修改文件、运行命令、维护终端/Git 状态，并把会话事件流式回传给控制面。
- 权限请求沿 agent、执行节点、控制面、客户端链路返回给用户确认，再由控制面下发决策。
- 会话状态由控制面统一同步，多端客户端看到同一个 agent 生命周期和时间线。

## 6. 数据安全边界图

```mermaid
flowchart LR
  subgraph Execution["执行环境<br/>用户设备 / 自有服务器 / 托管节点"]
    Code["代码仓库"]
    Key["模型账号 / API Key"]
    Env["开发环境<br/>依赖 / 终端 / Git"]
    Runtime["Doya 执行服务"]
    Agent["Agent 进程"]
  end

  subgraph Control["控制与连接面"]
    LocalDaemon["本地 daemon<br/>个人控制面"]
    TenantServer["多租户 server<br/>账号 / 权限 / 审计"]
    Relay["端到端加密通道<br/>只转发密文"]
  end

  subgraph Clients["用户入口"]
    Phone["手机"]
    Browser["浏览器"]
    Desktop["桌面端"]
  end

  Code --> Runtime
  Key --> Agent
  Env --> Agent
  Runtime --> Agent
  Agent --> Code

  Phone <-->|"直连"| LocalDaemon
  Phone -.->|"relay"| Relay
  Phone <-->|"云端登录"| TenantServer
  Browser <-->|"直连"| LocalDaemon
  Browser <-->|"云端登录"| TenantServer
  Desktop <-->|"本机直连"| LocalDaemon
  Desktop -.->|"relay"| Relay
  Desktop <-->|"云端登录"| TenantServer

  LocalDaemon --> Runtime
  TenantServer --> Runtime
  Relay -.->|"密文转发"| LocalDaemon
```

架构重点：

- 代码仓库、模型账号/API Key、依赖、终端和 Git 状态属于执行环境。
- 本地 daemon 是个人形态的控制面，直接管理同一机器或自有服务器上的执行服务。
- 多租户 server 是团队形态的控制面，管理账号、权限、审计和执行节点路由。
- Relay 不保存业务数据，不读取代码内容，只转发客户端与本地 daemon 之间的端到端加密流量。
- 安全边界需要分别落在租户、项目、执行节点、agent 进程和连接通道上。

## 7. 商业化分层图

```mermaid
flowchart TB
  subgraph Base["基础层：开发者入口"]
    Local["本地执行服务"]
    Providers["多 agent 接入"]
    MultiDevice["桌面 / 移动 / Web / 命令行"]
    Projects["项目与会话管理"]
  end

  subgraph Pro["个人高级版"]
    RemoteAccess["稳定远程访问"]
    Automation["定时任务 / 自动执行"]
    Voice["语音交互"]
    AdvancedWorkflow["多窗格 / 浏览器 / 高级工作流"]
  end

  subgraph Team["团队与企业版"]
    Members["成员与角色"]
    Policy["权限策略"]
    Audit["审计日志"]
    TenantServer["多租户 server"]
    SharedConfig["共享 agent 配置"]
    PrivateDeploy["私有化部署"]
  end

  subgraph Ecosystem["生态扩展"]
    Plugins["Agent 插件市场"]
    Skills["工作流技能"]
    Templates["项目模板"]
    Integrations["企业系统集成"]
  end

  Base --> Pro
  Pro --> Team
  Base --> Ecosystem
  Ecosystem --> Pro
  Ecosystem --> Team
```

架构重点：

- 基础层是本地执行服务、多 agent 接入、多端客户端、项目和会话管理。
- 个人高级能力建立在本地 daemon 之上，包括稳定远程访问、自动化、语音和高级工作流。
- 团队与企业能力建立在多租户 server 之上，包括成员角色、权限策略、审计日志、共享 agent 配置和私有化部署。
- 生态扩展层包括 agent 插件、工作流技能、项目模板和企业系统集成，可以同时服务个人版和团队版。

## 8. 架构演进图

```mermaid
flowchart LR
  Before["传统 IDE<br/>用户直接编辑代码"]
  Now["Agent 执行层<br/>agent 读写代码 / 运行命令"]
  Pain["控制缺口<br/>状态 / 权限 / 审计 / 多端同步"]
  Platform["工作流控制面<br/>会话 / 项目 / 编排 / 隔离"]
  Future["AI-native 开发环境<br/>多 agent / 多租户 / 可扩展生态"]

  Before --> Now --> Pain --> Platform --> Future
```

架构重点：

- 架构假设从“开发者直接编辑代码”转向“开发者编排 agent 执行工程任务”。
- 系统需要解决 agent 工具分散、状态不可见、权限不可控、执行结果难追踪的问题。
- 控制面成为长期稳定层，底层模型和 agent provider 可以持续替换。
- 工作台、协议、执行节点和生态层共同组成 AI-native 开发工作流入口。
