# 多用户工作区

当前实现是原 Doya daemon 内置的本地账号工作区能力，不再有独立包或独立账号 API 服务。

## 产品语义

- 用户必须先登录或注册，才能进入原来的会话界面。
- 每个用户注册后自动分配一个内部工作区目录；UI 不向用户暴露“工作区”概念。
- “新建会话”不让用户输入任意本机目录，而是在该用户内部工作区里创建一个项目子目录。
- agent 的执行目录就是该会话对应的项目目录。对话、会话、tab、provider、权限和运行状态继续使用原来的 Doya app + daemon 代码。

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

## HTTP 接口

接口挂在原 daemon 上，不需要启动额外服务：

- `POST /api/account/register`
- `POST /api/account/login`
- `POST /api/account/sms/send`
- `POST /api/account/sms/login`
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
npm run web --workspace=@getdoya/app
```

不再需要额外指定控制面 daemon 地址、provider 或工作区根目录，也不再运行额外账号服务。

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
