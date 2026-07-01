# Desktop app/server 构建和 control 环境变量链路

本文只讲一条链路：desktop 客户端从构建到启动，app web、server/daemon、control 地址是怎么串起来的。

## 1. 准备 desktop 构建 env

执行命令：

```bash
node scripts/prepare-desktop-build-env.mjs
```

由 `npm run build:desktop` 自动执行。

读取来源：

```text
docker/.env
```

也可以用：

```bash
DOYA_DESKTOP_ENV_FILE=/path/to/env npm run build:desktop
```

生成给 app web build 用的 env：

```text
.desktop-build.env
```

control 地址取值顺序：

```text
EXPO_PUBLIC_CONTROL_API_URL
DOYA_PUBLIC_CONTROL_API_URL
DOYA_CONTROL_AI_GATEWAY_PUBLIC_BASE_URL
```

生成结果示例：

```env
export EXPO_PUBLIC_CONTROL_API_URL='https://www.codexppt.com/control-api'
export EXPO_PUBLIC_ONLYOFFICE_DOCUMENT_SERVER_URL='http://64.83.17.170:8082'
```

同时生成给 desktop daemon 运行时用的 env：

```text
packages/desktop/generated/daemon-env.json
```

当前会从 `docker/.env` 白名单带入这些 daemon runtime env：

```text
DOYA_CORS_ORIGINS
DOYA_HOSTNAMES
DOYA_RELAY_*
DOYA_CONTROL_DAEMON_*
DOYA_CONTROL_HEARTBEAT_INTERVAL_MS
```

不要带入这些敏感 env：

```text
DOYA_CONTROL_TOKEN
DOYA_CONTROL_NODE_REGISTRATION_TOKEN
DOYA_CONTROL_RUNTIME_AUTH_TOKEN
DOYA_SMS_*
DOYA_PAYMENT_MERCHANT_KEY
DOYA_CONTROL_AI_GATEWAY_UPSTREAM_API_KEY
```

## 2. 构建 app web

执行命令：

```bash
set -a && . ./.desktop-build.env && set +a
cd packages/app
DOYA_WEB_PLATFORM=electron npx expo export --platform web
```

由 `npm run build:desktop` 自动执行。

携带 env：

```text
DOYA_WEB_PLATFORM=electron
EXPO_PUBLIC_CONTROL_API_URL=<来自 .desktop-build.env>
EXPO_PUBLIC_ONLYOFFICE_DOCUMENT_SERVER_URL=<来自 .desktop-build.env>
```

做了什么：

```text
packages/app 源码
  ↓ expo export
packages/app/dist
```

注意：

```text
EXPO_PUBLIC_* 会写进 app 前端 bundle。
DOYA_WEB_PLATFORM=electron 会让 Metro 选择 .electron.ts/.electron.tsx 实现。
```

## 3. 构建 server/daemon

执行命令：

```bash
npm run build --workspace=@getdoya/server
```

由 `npm run build:desktop` 自动执行。

实际构建方式：

```bash
tsc -p tsconfig.server.json
tsc -p tsconfig.scripts.json
```

产物：

```text
packages/server/dist
```

注意：

```text
server 构建不会把 DOYA_* 写死进 dist。
server/daemon 是运行时读取 process.env。
```

也就是说：

```bash
DOYA_CONTROL_API_URL=https://example.com npm run build --workspace=@getdoya/server
```

不会把这个地址写进 server bundle。

## 4. Electron 打包 desktop

执行命令：

```bash
npm run build --workspace=@getdoya/desktop --
```

由 `npm run build:desktop` 自动执行，内部跑 `electron-builder`。

打包进去的主要内容：

```text
packages/app/dist
  → Doya.app/Contents/Resources/app-dist

packages/server/dist
  → desktop app 内的 @getdoya/server/dist

packages/desktop/generated/daemon-env.json
  → Doya.app/Contents/Resources/daemon-env.json
```

所以 desktop 安装包里同时有：

```text
app web 静态页面
server/daemon 运行时代码
daemon runtime env 白名单文件
```

## 5. desktop 启动 app

packaged desktop 启动后，Electron 主进程加载：

```text
doya://app/
```

实际映射到：

```text
Doya.app/Contents/Resources/app-dist/index.html
```

dev 模式不走这个，dev 模式加载：

```text
http://localhost:<expo-port>
```

也就是 Expo dev server。

## 6. app 启动本机 daemon

app 页面起来后，会通过 Electron IPC 请求主进程启动 daemon。

调用链：

```text
packages/app/src/runtime/daemon-start-service.ts
  ↓ startDesktopDaemon(options)
packages/app/src/desktop/daemon/desktop-daemon.ts
  ↓ invokeDesktopCommand("start_desktop_daemon")
Electron IPC
  ↓
packages/desktop/src/daemon/daemon-manager.ts
  ↓ startDaemon()
spawn @getdoya/server
```

启动 daemon 的入口：

```text
@getdoya/server/dist/scripts/supervisor-entrypoint.js
```

## 7. app 怎么把 control 地址传给 daemon

app runtime 读取：

```ts
process.env.EXPO_PUBLIC_CONTROL_API_URL;
```

这个值来自第 2 步 app web 构建时写进 bundle 的 env。

用户登录后，app 拿到：

```text
apiBaseUrl = EXPO_PUBLIC_CONTROL_API_URL
userId = 当前用户 id
accessToken = 当前用户 token
```

然后通过 IPC 传给 Electron 主进程：

```ts
startDesktopDaemon({
  control: {
    apiBaseUrl,
    userId,
    accessToken,
  },
});
```

Electron 主进程启动 daemon 时转成 env：

```env
DOYA_CONTROL_ENABLED=1
DOYA_CONTROL_API_URL=<apiBaseUrl>
DOYA_CONTROL_USER_ID=<userId>
DOYA_CONTROL_TOKEN=<accessToken>
DOYA_CONTROL_OWNER_USER_ID=<userId>
```

daemon 运行时读取：

```ts
process.env.DOYA_CONTROL_API_URL;
```

所以 desktop control 地址链路是：

```text
docker/.env
  ↓ prepare-desktop-build-env.mjs
EXPO_PUBLIC_CONTROL_API_URL
  ↓ expo export 写进 app bundle
app runtime
  ↓ IPC
Electron main
  ↓ spawn env
DOYA_CONTROL_API_URL
  ↓ daemon runtime
control
```

## 8. app/daemon/control 用什么协议

```text
Electron 加载 app：
  packaged: doya://app/
  dev:      http://localhost:<expo-port>

app 请求 Electron 启 daemon：
  Electron IPC

app 连接 daemon：
  HTTP + WebSocket

daemon 连接 control：
  HTTP
```

## 9. desktop daemon 和 runtime daemon 的区别

desktop daemon：

```text
运行位置：用户本机 desktop app 内
control 地址来源：EXPO_PUBLIC_CONTROL_API_URL → DOYA_CONTROL_API_URL
DOYA_CONTROL_TOKEN：当前登录用户 access token
```

runtime daemon：

```text
运行位置：服务器 Docker
control 地址来源：docker-compose 的 DOYA_CONTROL_API_URL=http://control:6777
DOYA_CONTROL_TOKEN：节点注册密钥
```

runtime daemon 的 compose env 示例：

```env
DOYA_CONTROL_API_URL=http://control:6777
DOYA_CONTROL_ENABLED=1
DOYA_CONTROL_TOKEN=<节点注册密钥>
DOYA_CONTROL_DAEMON_ENDPOINT=<control 访问 daemon 的内部地址>
DOYA_CONTROL_DAEMON_PUBLIC_ENDPOINT=<浏览器访问 daemon 的公开地址>
```

这个节点注册密钥不能打进 desktop 安装包。

## 10. 快速检查命令

看 desktop app 将使用哪个 control：

```bash
node scripts/prepare-desktop-build-env.mjs
sed -n '1,8p' .desktop-build.env
```

看 desktop daemon 会带哪些 runtime env key：

```bash
node -e 'const fs=require("fs"); const p="packages/desktop/generated/daemon-env.json"; console.log(Object.keys(JSON.parse(fs.readFileSync(p,"utf8"))).sort().join("\n"))'
```

打包前至少确认：

```text
EXPO_PUBLIC_CONTROL_API_URL 指向公开可访问的 control 地址
DOYA_CORS_ORIGINS 包含本机 dev origin 和生产 web origin
DOYA_HOSTNAMES 包含 localhost/127.0.0.1、生产域名、Docker 内部 server
没有把节点注册密钥或服务端密钥放进 desktop runtime 白名单
```
