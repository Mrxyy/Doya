---
title: Git worktrees
description: Run agents in isolated git worktrees with setup hooks, scripts, and long-running services.
nav: Git worktrees
order: 7
---

# Git worktrees

Each agent runs in its own git worktree, a separate directory on a separate branch, so parallel agents never step on each other. You configure setup, scripts, and long-running services through a `doya.json` file at your repo root.

## Layout and workflow

Worktrees live under `$DOYA_HOME/worktrees/` by default, grouped by a hash of the source checkout path. You can change the base directory with `worktrees.root` in `config.json`. Each worktree gets a random slug; the branch name is chosen when you first launch an agent.

```
~/.doya/worktrees/
└── 1vnnm9k3/               # hash of source checkout path
    ├── tidy-fox/           # worktree slug (branch set on first agent)
    └── bold-owl/
```

With a custom root, Doya keeps the same hashed layout under that directory:

```json
{
  "worktrees": {
    "root": "/mnt/fast/doya-worktrees"
  }
}
```

1. Create a worktree, Doya runs your setup hooks
2. Launch an agent, a branch is created or assigned
3. Review the diff against the base branch
4. Merge or archive, archive runs teardown and removes the directory

## doya.json

Drop a `doya.json` in your repo root. Doya reads it from the committed version of the base branch you picked, so uncommitted changes in other branches don't apply.

```json
{
  "worktree": {
    "setup": "npm ci",
    "teardown": "rm -rf .cache"
  },
  "scripts": {
    "test": { "command": "npm test" },
    "web": { "command": "npm run dev", "type": "service", "port": 3000 }
  }
}
```

## Setup and teardown

`setup` runs once after the worktree is created. A fresh worktree has no installed dependencies and no ignored files (like `.env`), so use setup to install and copy what you need. `teardown` runs during archive, before the directory is removed.

```json
{
  "worktree": {
    "setup": "npm ci\ncp \"$DOYA_SOURCE_CHECKOUT_PATH/.env\" .env\nnpm run db:migrate",
    "teardown": "npm run db:drop || true"
  }
}
```

Both fields accept a multiline shell script or an array of commands; commands run sequentially either way.

Commands run with the worktree as `cwd`. Use `$DOYA_SOURCE_CHECKOUT_PATH` to reach files in the original checkout (untracked config, local caches, etc).

## Scripts and services

`scripts` are named commands you can run inside a worktree on demand. Mark one as a _service_ and Doya supervises it as a long-running process, assigns it a port, and routes HTTP traffic to it through the daemon's reverse proxy.

### Plain scripts

```json
{
  "scripts": {
    "test": { "command": "npm test" },
    "lint": { "command": "npm run lint" },
    "generate": { "command": "npm run codegen" }
  }
}
```

### Services

```json
{
  "scripts": {
    "web": {
      "type": "service",
      "command": "npm run dev -- --port $DOYA_PORT",
      "port": 3000
    },
    "api": {
      "type": "service",
      "command": "npm run api -- --port $DOYA_PORT"
    }
  }
}
```

Omit `port` to let Doya auto-assign one. Bind your process to `$DOYA_PORT` rather than hard-coding, each worktree gets a distinct port so multiple copies of the same service coexist.

### Reverse proxy

Every service is reachable through the daemon at a deterministic hostname:

```
http://<script>.<branch>.<project>.localhost:<daemon-port>

# on the default branch, the branch label is dropped:
http://<script>.<project>.localhost:<daemon-port>
```

`*.localhost` resolves to `127.0.0.1` on modern systems, so these URLs work out of the box. The proxy supports WebSocket upgrades.

### Service-to-service

Services launched from the same workspace see each other's ports and proxy URLs. Given `web` and `api` above, each process gets:

```
DOYA_PORT=3000                         # this service's port
DOYA_URL=http://web.my-app.localhost:6767  # this service's proxy URL
DOYA_SERVICE_API_PORT=51732
DOYA_SERVICE_API_URL=http://api.my-app.localhost:6767
DOYA_SERVICE_WEB_PORT=3000
DOYA_SERVICE_WEB_URL=http://web.my-app.localhost:6767
```

Script names are upper-cased and non-alphanumerics become `_`. Point your frontend at `$DOYA_SERVICE_API_URL` instead of hard-coding a port.

## Terminals

Open terminals automatically when a worktree is created. Useful for tailing logs or leaving a REPL ready to go.

```json
{
  "worktree": {
    "terminals": [
      { "name": "logs", "command": "tail -f dev.log" },
      { "name": "shell", "command": "bash" }
    ]
  }
}
```

## Environment variables

Setup, teardown, scripts, and services all see:

- `$DOYA_SOURCE_CHECKOUT_PATH`, the original repo root
- `$DOYA_WORKTREE_PATH`, the worktree directory
- `$DOYA_BRANCH_NAME`, the worktree's branch
- `$DOYA_WORKTREE_PORT`, legacy per-worktree port (prefer `$DOYA_PORT` inside services)

Services additionally get:

- `$DOYA_PORT`, this service's assigned port
- `$DOYA_URL`, this service's proxy URL
- `$DOYA_SERVICE_<NAME>_PORT` / `_URL`, peer service ports and URLs
- `$HOST`, `127.0.0.1` for local-only daemons, `0.0.0.0` when the daemon binds all interfaces

## CLI

```bash
doya run --worktree feature-auth --base main "implement auth"
doya worktree ls
doya worktree archive feature-auth
```
