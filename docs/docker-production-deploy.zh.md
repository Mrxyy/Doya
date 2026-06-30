# Docker 生产部署说明

这份文档描述当前 Doya 生产部署方式：

- 本地构建并推送 Docker 镜像到 Docker Hub。
- 服务器只拉镜像并用 `docker-compose.deploy.yml` 启动主服务，用
  `docker-compose.onlyoffice.yml` 启动 ONLYOFFICE。
- 宿主机 nginx 只做入口反向代理，不重新打包、不拷贝前端静态文件。
- control 使用内部 daemon 地址调用服务，浏览器使用公开 HTTPS/WSS 地址连接 daemon。

## 服务结构

生产环境有四个常驻容器和一个一次性注册容器：

| 服务                         | 容器端口 | 宿主端口 | 用途                                 |
| ---------------------------- | -------- | -------- | ------------------------------------ |
| `app`                        | `80`     | `8080`   | Web 前端                             |
| `server`                     | `6767`   | `6767`   | Doya daemon、WebSocket、agent 运行时 |
| `control`                    | `6777`   | `6777`   | 登录、短信、支付、节点调度、后台接口 |
| `onlyoffice-document-server` | `80`     | `8082`   | ONLYOFFICE 文档预览                  |
| `runtime-node-register`      | 无       | 无       | 一次性把 daemon 节点注册到 control   |

nginx 对外暴露域名，例如：

```text
https://www.codexppt.com/             -> app 容器 8080
wss://www.codexppt.com/ws            -> server 容器 6767
https://www.codexppt.com/api/         -> server 容器 6767
https://www.codexppt.com/control-api/ -> control 容器 6777
```

## 服务器目录

服务器使用 `/opt/doya`：

```text
/opt/doya/
  docker-compose.deploy.yml
  docker-compose.onlyoffice.yml
  docker/.env
  packages/server/docker/
    onlyoffice-entrypoint.sh
    onlyoffice-local.json
  workspaces/
```

`docker/.env` 包含真实短信、支付、Docker 镜像、节点注册配置，不要提交到 Git。

## 本地构建并推送镜像

先确认已经登录 Docker Hub：

```bash
docker login
```

生产服务器是 `linux/amd64` 时，构建命令必须显式指定目标平台。尤其本地是
Apple Silicon、OrbStack 或其他 `arm64` 环境时，compose 构建要设置
`DOCKER_DEFAULT_PLATFORM=linux/amd64`；否则会构建本机架构镜像，把 `arm64` 镜像推到
`amd64` 服务器后，容器会因为 `exec format error` 启动失败。

为 `amd64` 服务器构建并推送：

```bash
DOCKER_DEFAULT_PLATFORM=linux/amd64 docker compose --env-file docker/.env build server control app
docker compose --env-file docker/.env push server control app
```

这会使用 `docker-compose.yml` 里的 build args，并从 `docker/.env` 读取实际值。
`DOYA_PUBLIC_DAEMON` 和 `DOYA_PUBLIC_CONTROL_API_URL` 可以在 env 里留空，避免前端 bundle
写入本地默认 daemon/control 地址。
`EXPO_PUBLIC_ONLYOFFICE_DOCUMENT_SERVER_URL` 是浏览器直接加载的 ONLYOFFICE Docs 地址。
非域名访问使用这个变量，例如 `http://64.83.17.170:8082`；域名访问时前端会优先使用当前域名的
`/onlyoffice` 代理，避免 HTTPS 页面嵌入 HTTP 服务。

如果只改了前端，也可以只推 app 镜像：

```bash
DOCKER_DEFAULT_PLATFORM=linux/amd64 docker compose --env-file docker/.env build app
docker compose --env-file docker/.env push app
```

如果只改了 control，也可以只推 control 镜像：

```bash
DOCKER_DEFAULT_PLATFORM=linux/amd64 docker compose --env-file docker/.env build control
docker compose --env-file docker/.env push control
```

## 服务器环境变量

服务器 `/opt/doya/docker/.env` 至少需要这些配置：

```env
DOYA_SERVER_IMAGE=jadenxiong/doya-server:latest
DOYA_CONTROL_IMAGE=jadenxiong/doya-control:latest
DOYA_APP_IMAGE=jadenxiong/doya-app:latest

DOYA_CORS_ORIGINS=https://www.codexppt.com,https://codexppt.com
DOYA_HOSTNAMES=www.codexppt.com,codexppt.com,server

# control 服务用这个 token 验证 daemon 节点注册。
# daemon 容器用 DOYA_CONTROL_TOKEN 发起注册，两者必须相同。
DOYA_CONTROL_NODE_REGISTRATION_TOKEN=请替换为长随机密钥
DOYA_CONTROL_TOKEN=请替换为同一个长随机密钥

DOYA_RUNTIME_NODE_ID=prod-64-83-17-170

# control 容器访问 daemon 用，走 Docker 内网。
DOYA_RUNTIME_NODE_ENDPOINT=http://server:6767

# 浏览器访问 daemon 用，scheduler 会把这个地址返回给前端。
DOYA_RUNTIME_NODE_PUBLIC_ENDPOINT=https://www.codexppt.com

# 前端 XLSX 预览使用的 ONLYOFFICE Docs 地址。
EXPO_PUBLIC_ONLYOFFICE_DOCUMENT_SERVER_URL=http://64.83.17.170:8082
```

daemon 会校验 HTTP `Host`，所以 `DOYA_RUNTIME_NODE_ENDPOINT` 使用的主机名也必须出现在
`DOYA_HOSTNAMES` 里。这里用的是 Docker 内部服务名 `server`，因此
`DOYA_HOSTNAMES` 必须包含 `server`；否则 control 创建 session workdir 时会被
daemon 拒绝，报 `{"error":"Invalid Host header"}`。

`DOYA_CONTROL_NODE_REGISTRATION_TOKEN` 和 `DOYA_CONTROL_TOKEN` 是同一条节点注册密钥的
两侧配置：前者进入 control 容器，后者进入 daemon/server 容器。生产环境必须设置为同一个高强度随机值。
compose 会让 daemon 使用 `DOYA_CONTROL_API_URL=http://control:6777`、`DOYA_CONTROL_TOKEN`
和上述 daemon endpoint 周期性向 control 注册；`runtime-node-register` 只是部署时的
一次性补注册/刷新容器，也使用同一条节点注册密钥，不再通过注册账号拿用户 token。

短信和支付配置也放在同一个文件里：

```env
DOYA_SMS_ACCOUNT=...
DOYA_SMS_PASSWORD=...
DOYA_SMS_URL=http://mxthk.weiwebs.cn/msg/HttpVarSM

DOYA_PAYMENT_MERCHANT_ID=...
DOYA_PAYMENT_MERCHANT_KEY=...
DOYA_PAYMENT_PUBLIC_BASE_URL=...
DOYA_PAYMENT_GATEWAY_BASE_URL=...
DOYA_PAYMENT_NOTIFY_URL=...
DOYA_PAYMENT_RETURN_URL=...
```

## 首次部署

在服务器安装 Docker 和 compose 后：

```bash
mkdir -p /opt/doya/docker /opt/doya/workspaces
cd /opt/doya
```

把本地文件传到服务器：

```bash
scp docker-compose.deploy.yml root@64.83.17.170:/opt/doya/docker-compose.deploy.yml
scp docker-compose.onlyoffice.yml root@64.83.17.170:/opt/doya/docker-compose.onlyoffice.yml
ssh root@64.83.17.170 'mkdir -p /opt/doya/packages/server/docker'
scp packages/server/docker/onlyoffice-entrypoint.sh root@64.83.17.170:/opt/doya/packages/server/docker/onlyoffice-entrypoint.sh
scp packages/server/docker/onlyoffice-local.json root@64.83.17.170:/opt/doya/packages/server/docker/onlyoffice-local.json
scp docker/nginx-production.conf root@64.83.17.170:/opt/doya/docker/nginx-production.conf
scp docker/.env root@64.83.17.170:/opt/doya/docker/.env
```

服务器启动：

```bash
cd /opt/doya
docker compose -f docker-compose.deploy.yml --env-file docker/.env pull
docker compose -f docker-compose.onlyoffice.yml pull
docker compose -f docker-compose.deploy.yml --env-file docker/.env up -d
docker compose -f docker-compose.onlyoffice.yml up -d --force-recreate onlyoffice-document-server
docker compose -f docker-compose.deploy.yml --env-file docker/.env up --force-recreate runtime-node-register
```

刚推完 `latest` 后，Docker Hub 可能短时间内让服务器第一次 `pull` 看到旧 digest。部署后核对
`docker image inspect jadenxiong/doya-server:latest jadenxiong/doya-app:latest` 的
`Created`/`RepoDigests`；如果仍是旧镜像，单独再 `pull` 对应服务并 `up -d --force-recreate`。

修改 `packages/server/docker/onlyoffice-entrypoint.sh` 或
`packages/server/docker/onlyoffice-local.json` 后，需要强制重建 ONLYOFFICE 容器。compose
会把这些文件挂载进容器，但入口脚本只在容器启动时执行：

```bash
docker compose -f docker-compose.onlyoffice.yml up -d --force-recreate onlyoffice-document-server
```

## 日常一键更新

本地推完镜像后，服务器执行：

```bash
cd /opt/doya
docker compose -f docker-compose.deploy.yml --env-file docker/.env pull
docker compose -f docker-compose.onlyoffice.yml pull
docker compose -f docker-compose.deploy.yml --env-file docker/.env up -d
docker compose -f docker-compose.onlyoffice.yml up -d --force-recreate onlyoffice-document-server
docker compose -f docker-compose.deploy.yml --env-file docker/.env up --force-recreate runtime-node-register
```

日常发布也固定重建 ONLYOFFICE。它的 `onlyoffice-entrypoint.sh` 会在容器启动时合并
`local.json` 并打入 Doya 的预览 CSS；即使这次没有改 ONLYOFFICE 文件，也让容器重新跑一遍入口脚本，
保持发布结果一致。

如果只更新前端：

```bash
cd /opt/doya
docker compose -f docker-compose.deploy.yml --env-file docker/.env pull app
docker compose -f docker-compose.deploy.yml --env-file docker/.env up -d app
docker compose -f docker-compose.onlyoffice.yml up -d --force-recreate onlyoffice-document-server
```

如果只更新 control，并且节点注册配置也变了：

```bash
cd /opt/doya
docker compose -f docker-compose.deploy.yml --env-file docker/.env pull control
docker compose -f docker-compose.deploy.yml --env-file docker/.env up -d control
docker compose -f docker-compose.onlyoffice.yml up -d --force-recreate onlyoffice-document-server
docker compose -f docker-compose.deploy.yml --env-file docker/.env up --force-recreate runtime-node-register
```

## nginx 配置

宿主机 nginx 负责 HTTPS 证书和反向代理。仓库里的
`docker/nginx-production.conf` 是可直接拷贝的核心配置；如果服务器上已有
Certbot/HTTPS server block，把下面这些 `location` 合并进去即可。

```nginx
location /ws {
    proxy_pass http://127.0.0.1:6767/ws;
    proxy_http_version 1.1;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection "upgrade";
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
}

location /control-api/ {
    proxy_pass http://127.0.0.1:6777/;
    proxy_http_version 1.1;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
}

location /onlyoffice/ {
    proxy_pass http://127.0.0.1:8082/;
    proxy_http_version 1.1;
    proxy_set_header Host $http_host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_set_header X-Forwarded-Host $http_host;
    proxy_set_header X-Forwarded-Prefix /onlyoffice;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection "upgrade";
    proxy_read_timeout 3600s;
    proxy_send_timeout 3600s;
}

location /cache/ {
    proxy_pass http://127.0.0.1:8082/cache/;
    proxy_http_version 1.1;
    proxy_set_header Host $http_host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_set_header X-Forwarded-Host $http_host;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection "upgrade";
    proxy_read_timeout 3600s;
    proxy_send_timeout 3600s;
}

location /ppt-confirm/ {
    proxy_pass http://127.0.0.1:6767/ppt-confirm/;
    proxy_http_version 1.1;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
}

location /ppt-preview/ {
    proxy_pass http://127.0.0.1:6767/ppt-preview/;
    proxy_http_version 1.1;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
}

location /api/ {
    proxy_pass http://127.0.0.1:6767/api/;
    proxy_http_version 1.1;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
}

location /mcp/ {
    proxy_pass http://127.0.0.1:6767/mcp/;
    proxy_http_version 1.1;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
}

location / {
    proxy_pass http://127.0.0.1:8080;
    proxy_http_version 1.1;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
}
```

`/onlyoffice/` 的 `proxy_pass` 末尾 `/` 必须保留，这样
`/onlyoffice/web-apps/...` 才会转发为 ONLYOFFICE 容器里的 `/web-apps/...`。
`/cache/` 也必须代理给 ONLYOFFICE；编辑器会把运行时文件缓存生成为
`/cache/files/...`，不走这条代理会导致 `Editor.bin` 等文件加载失败。

修改后验证并重载：

```bash
nginx -t
systemctl reload nginx
```

## 多 daemon 配置方式

每个 daemon 节点都应该注册两种地址：

```text
endpoint       = control 内部访问 daemon 的地址
publicEndpoint = 浏览器访问 daemon 的地址
```

单机 Docker 部署：

```env
DOYA_RUNTIME_NODE_ID=prod-64-83-17-170
DOYA_RUNTIME_NODE_ENDPOINT=http://server:6767
DOYA_RUNTIME_NODE_PUBLIC_ENDPOINT=https://www.codexppt.com
```

第二台机器可以注册成：

```env
DOYA_RUNTIME_NODE_ID=prod-node-2
DOYA_RUNTIME_NODE_ENDPOINT=http://server:6767
DOYA_RUNTIME_NODE_PUBLIC_ENDPOINT=https://node2.example.com
```

对应的 `node2.example.com` 也要配置 nginx：

```text
wss://node2.example.com/ws -> 这台机器的 127.0.0.1:6767/ws
```

## 验证

检查容器：

```bash
cd /opt/doya
docker compose -f docker-compose.deploy.yml --env-file docker/.env ps
docker compose -f docker-compose.onlyoffice.yml ps
```

检查 app：

```bash
curl -fsSI http://64.83.17.170:8080
curl -fsS https://www.codexppt.com/healthz
```

检查 ONLYOFFICE：

```bash
# IP HTTP 模式可直接访问 ONLYOFFICE 宿主机端口。
curl -fsS http://64.83.17.170:8082/healthcheck
curl -fsSI http://64.83.17.170:8082/web-apps/apps/api/documents/api.js

# 域名 HTTPS 入口必须走同域名路径代理。
curl -fsS https://www.codexppt.com/onlyoffice/healthcheck
curl -fsSI https://www.codexppt.com/onlyoffice/web-apps/apps/api/documents/api.js
# 打开一次 XLSX 预览后，用浏览器 Network 里的实际 /cache/files/... URL 检查。
curl -fsSI '<actual https://www.codexppt.com/cache/files/... URL>'
```

检查 control：

```bash
curl -fsS https://www.codexppt.com/control-api/api/health
```

检查 scheduler 返回公开地址：

```bash
curl -fsS -X POST https://www.codexppt.com/control-api/api/scheduler/runtime-node
```

正常返回里应该看到：

```json
{
  "node": {
    "id": "prod-64-83-17-170",
    "endpoint": "https://www.codexppt.com",
    "status": "online"
  }
}
```

检查 control 内部存储映射：

```bash
docker exec doya-control-1 node -e 'const fs=require("fs"); const s=JSON.parse(fs.readFileSync("/data/control/control.json","utf8")); console.log(JSON.stringify(s.daemonNodes.map(({id, endpoint, publicEndpoint, status}) => ({id, endpoint, publicEndpoint, status})), null, 2));'
```

正常应该类似：

```json
[
  {
    "id": "prod-64-83-17-170",
    "endpoint": "http://server:6767",
    "publicEndpoint": "https://www.codexppt.com",
    "status": "online"
  }
]
```

## 常见问题

### 浏览器没有请求 scheduler

先清理浏览器里的旧 daemon registry：

```js
localStorage.removeItem("@doya:daemon-registry");
```

然后刷新 `https://www.codexppt.com/`。

### 出现 Mixed Content

说明 HTTPS 页面尝试连接了 `ws://...`。检查 scheduler 返回值：

```bash
curl -fsS -X POST https://www.codexppt.com/control-api/api/scheduler/runtime-node
```

如果返回的是 `http://64.83.17.170:6767`，说明节点没有配置
`DOYA_RUNTIME_NODE_PUBLIC_ENDPOINT=https://www.codexppt.com`，或者没有重新执行
`runtime-node-register`。

### control 能调 daemon，但浏览器连不上

检查 nginx `/ws` 是否有 WebSocket upgrade 头：

```nginx
proxy_set_header Upgrade $http_upgrade;
proxy_set_header Connection "upgrade";
```

同时确认 `DOYA_RUNTIME_NODE_PUBLIC_ENDPOINT` 对应的域名就是 nginx 证书域名。
