---
title: CLI
description: "Doya CLI reference: manage agents, daemons, permissions, and worktrees from your terminal."
nav: CLI
order: 6
---

# CLI

The Doya CLI lets you manage agents from your terminal. It's the same interface exposed by the daemon's API, so anything you can do in the app you can do from the command line.

> **Agent orchestration:** You can tell coding agents to use the Doya CLI to spawn and manage other agents. This enables multi-agent workflows where one agent delegates subtasks to others and waits for results.

## Quick reference

```bash
doya run "fix the tests"            # Start an agent
doya ls                             # List running agents
doya attach <id>                    # Stream agent output
doya send <id> "also fix linting"   # Send follow-up task
doya logs <id>                      # View agent timeline
doya stop <id>                      # Stop an agent
```

## Running agents

Use `doya run` to start a new agent with a task:

```bash
doya run "implement user authentication"
doya run --provider codex "refactor the API layer"
doya run --detach "run the full test suite"  # background
doya run --worktree feature-x "implement feature X"
doya run --output-schema schema.json "extract release notes"
doya run --output-schema '{"type":"object","properties":{"summary":{"type":"string"}},"required":["summary"]}' "summarize release notes"
```

The `--worktree` flag creates the agent in an isolated git worktree, useful for parallel feature development.

Use `--output-schema` to return only matching JSON output. You can pass a schema file path or an inline JSON schema object. This mode cannot be used with `--detach`.

By default, `doya run` waits for completion. Use `--detach` to run in the background.

## Listing agents

```bash
doya ls                    # Running agents in current directory
doya ls -a                 # Include completed/stopped agents
doya ls -g                 # All directories
doya ls -a -g --json       # Full list as JSON
```

## Streaming output

Use `doya attach` to stream an agent's output in real-time:

```bash
doya attach abc123   # Attach to agent (Ctrl+C to detach)
```

Agent IDs can be shortened, `abc` works if it's unambiguous.

## Sending messages

Send follow-up tasks to a running or idle agent:

```bash
doya send <id> "now run the tests"
doya send <id> --image screenshot.png "what's wrong here?"
doya send <id> --no-wait "queue this task"
```

## Viewing logs

```bash
doya logs <id>                  # Full timeline
doya logs <id> -f               # Follow (streaming)
doya logs <id> --tail 10        # Last 10 entries
doya logs <id> --filter tools   # Only tool calls
```

## Waiting for agents

Block until an agent finishes its current task:

```bash
doya wait <id>
doya wait <id> --timeout 60   # 60 second timeout
```

Useful in scripts or when one agent needs to wait for another.

## Permissions

Agents may request permission for certain actions. Manage these from the CLI:

```bash
doya permit ls                # List pending requests
doya permit allow <id>        # Allow all pending for agent
doya permit deny <id> --all   # Deny all pending
```

## Agent modes

Change an agent's operational mode (provider-specific):

```bash
doya agent mode <id> --list   # Show available modes
doya agent mode <id> bypass   # Set bypass mode
doya agent mode <id> plan     # Set plan mode
```

## Daemon management

```bash
doya daemon start             # Start the daemon
doya daemon status            # Check status
doya daemon stop              # Stop the daemon
```

Use `DOYA_HOME` to run multiple isolated daemon instances.

## Connecting to a remote daemon

`--host` accepts either a local target (`host:port`, a unix socket, or a Windows pipe) or a pairing offer URL, the same `https://app.doya.sh/#offer=...` link the mobile app uses for QR pairing. With an offer URL the CLI connects through the Doya relay with end-to-end encryption, so you can drive a daemon on another machine without exposing it to the network.

Get an offer URL from the daemon you want to control:

```bash
doya daemon pair --json   # prints { url, qr, ... }
```

Use it from anywhere:

```bash
doya ls --host 'https://app.doya.sh/#offer=eyJ2IjoyLC...'
doya run --host "$OFFER_URL" "fix the failing tests"
```

You can also set it once via `DOYA_HOST` instead of passing `--host` on every command.

## Multi-agent workflows

The CLI is designed to be used by agents themselves. You can instruct an agent to spawn sub-agents for parallel work:

```bash
# Agent A spawns Agent B and waits for it
doya run --detach "implement the API" --name api-agent
doya wait api-agent
doya logs api-agent --tail 5
```

Simple implement + verify loop:

```bash
# Requires jq
while true; do
  doya run --provider codex "make the tests pass" >/dev/null

  verdict=$(doya run --provider claude --output-schema '{"type":"object","properties":{"criteria_met":{"type":"boolean"}},"required":["criteria_met"],"additionalProperties":false}' "ensure tests all pass")
  if echo "$verdict" | jq -e '.criteria_met == true' >/dev/null; then
    echo "criteria met"
    break
  fi
done
```

This pattern enables hierarchical task decomposition, a lead agent can break down work, delegate to specialists, and synthesize results.

## Output formats

Most commands support multiple output formats for scripting:

```bash
doya ls --json                # JSON output
doya ls --format yaml         # YAML output
doya ls -q                    # IDs only (quiet)
```

## Global options

- `--host <target>`, connect to a different daemon (`host:port`, unix socket, or `https://app.doya.sh/#offer=...` for relay). See [Connecting to a remote daemon](#connecting-to-a-remote-daemon).
- `--json`, JSON output
- `-q, --quiet`, minimal output
- `--no-color`, disable colors
