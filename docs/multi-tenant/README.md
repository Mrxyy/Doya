# 多用户工作区

当前实现是原 Paseo daemon 内置的本地账号工作区能力，不再有独立包或独立账号 API 服务。

## 产品语义

- 用户必须先登录或注册，才能进入原来的项目/会话界面。
- 每个用户注册后自动分配一个工作区目录。
- “新建项目”不再让用户输入任意本机目录，而是在该用户工作区里创建一个项目子目录。
- agent 的执行目录就是项目目录。对话、会话、tab、provider、权限和运行状态继续使用原来的 Paseo app + daemon 代码。

## 存储位置

账号控制面数据都在 `$PASEO_HOME/accounts` 下：

```text
$PASEO_HOME/accounts/
├── accounts.json
└── workspaces/
    └── ws_xxx/
        └── projects/
            └── project-name-xxxx/
```

`accounts.json` 记录 users、workspaces、projects。项目目录创建完成后，App 调用原来的 open project 流程打开目录，daemon 后续仍按普通 workspace 管理 agent。

## HTTP 接口

接口挂在原 daemon 上，不需要启动额外服务：

- `POST /api/account/register`
- `POST /api/account/login`
- `POST /api/account/projects`

开发时如果 daemon 监听 `127.0.0.1:6767`，App 会默认请求 `http://127.0.0.1:6767`。`npm run dev` 走 portless 时，App 使用 `EXPO_PUBLIC_LOCAL_DAEMON` 推导 daemon HTTP 地址。

## 启动方式

使用原有启动命令：

```bash
npm run dev
```

或本机固定端口开发：

```bash
npm run dev-xyy
npm run web --workspace=@getpaseo/app
```

不再需要额外指定控制面 daemon 地址、provider 或工作区根目录，也不再运行额外账号服务。
