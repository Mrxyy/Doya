# 多用户工作区

当前实现是原 Doya daemon 内置的本地账号工作区能力。它是迁移期兼容层，
不是最终的产品归属边界。

目标模型里，用户主对象是 Session；daemon node 只负责 runtime。
Control plane 负责用户、session、历史消息、artifact metadata 和
runtime allocation。

## 产品语义

- 用户必须先登录或注册，才能进入原来的会话界面。
- 每个用户注册后自动分配一个内部工作区目录；UI 不向用户暴露“工作区”概念。
- “新建会话”不让用户输入任意本机目录，而是在该用户内部工作区里创建一个项目子目录。
- agent 的执行目录就是该会话对应的项目目录。对话、会话、tab、provider、权限和运行状态继续使用原来的 Doya app + daemon 代码。
- 云 agent 终态里，用户主概念是“会话”。workspace、project、daemon node、runtime directory 都是平台内部概念。

## 存储位置

账号控制面数据都在 `$DOYA_HOME/accounts` 下：

```text
$DOYA_HOME/accounts/
├── accounts.json
└── workspaces/
    └── ws_xxx/
        └── projects/
            └── project-name-xxxx/
```

`accounts.json` 记录 users、workspaces、projects。项目目录创建完成后，App 调用原来的 open project 流程打开目录，daemon 后续仍按普通 workspace 管理 agent；这些 project/workspace 名称是内部实现语义，产品 UI 对用户呈现为“会话/对话”。

重要限制：`$DOYA_HOME` 属于某一个 daemon node。`projects.cwd` 不能作为
全局 session 主数据；打开历史会话应走 `sessionId -> RuntimeAllocation ->
workspaceDir`。短期 legacy app 路径必须确认 account session 属于当前
direct host，不能让 6868 复用 6767 的 `projects.cwd`。

## HTTP 接口

Legacy 账号项目接口挂在原 daemon 上：

- `POST /api/account/register`
- `POST /api/account/login`
- `POST /api/account/sms/send`
- `POST /api/account/sms/login`
- `POST /api/account/projects`

开发时如果 daemon 监听 `127.0.0.1:6767`，App 会默认请求 `http://127.0.0.1:6767`。`npm run dev` 走 portless 时，App 使用 `EXPO_PUBLIC_LOCAL_DAEMON` 推导 daemon HTTP 地址。

新的 session-centered control plane 不复用这些 project 接口作为主数据源。
本地 control service 在 `packages/control`，默认监听 `127.0.0.1:6777`，
App 通过 `EXPO_PUBLIC_CONTROL_API_URL` 调用 `/api/sessions`、
`/api/nodes`、`/api/runtime-sync` 等 control API。legacy project API 只保留
兼容本机账号项目路径。

## 启动方式

legacy daemon 账号项目路径继续使用原有启动命令：

```bash
npm run dev
```

或本机固定端口开发：

```bash
npm run dev-xyy
npm run web --workspace=@getdoya/app
```

本地 control service 开发需要同时启动 control：

```bash
npm run dev:control
```

使用 `doya.json` 服务编排时，`control` service 会把 App 的
`EXPO_PUBLIC_CONTROL_API_URL` 指到对应端口。

## 短信登录

手机号注册/登录走 daemon 内置短信验证码接口。短信服务凭证只在 daemon
环境变量中配置，App 不保存或发送服务商 secret：

```bash
DOYA_DOTSMS_APIKEY=...
DOYA_DOTSMS_SECRET=...
DOYA_DOTSMS_SIGN_ID=...
DOYA_DOTSMS_TEMPLATE_ID=...
```

默认使用点信模板短信接口 `https://api.dotsms.cn/sms/template`。如需调试或切换网关，可用
`DOYA_DOTSMS_URL` 覆盖。
