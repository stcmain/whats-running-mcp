# whats-running-mcp

**Ground truth for agent fleets.** An MCP server that tells your AI agent what is *actually* running on the machine — live agent sessions, listening TCP ports, loaded daemons, system load — read straight from the OS (`ps` / `lsof` / `launchctl` / `df`), never from docs, transcripts, or memory files.

## Why

If you run more than one coding-agent session (Claude Code, Codex, Aider…), you've seen this failure mode: an agent "health-checks" a server that died weeks ago, or confidently reports a daemon as live because an old transcript said so. Model memory is a cache with no invalidation. The OS is the source of truth.

This server started as a shell script (`whats-running`) I wrote after my own fleet of Claude Code sessions kept reporting stale state as live. Wrapping it in MCP means every session grounds itself the same way, automatically.

## Tools

| Tool | What it answers |
|---|---|
| `whats_running` | Full snapshot in one call — use at session start |
| `agent_sessions` | Which agent processes are live? Terminal-attached vs detached/orphan, with pid, uptime, and working directory |
| `listening_ports` | Is service X actually up? Every TCP LISTEN socket with owning process |
| `daemons` | What persistent services are loaded? `launchctl` (macOS, non-Apple) or systemd user services (Linux), with optional label filter |
| `system_stats` | Load average, uptime, root-disk free space |

## Install

```bash
git clone https://github.com/stcmain/whats-running-mcp.git
cd whats-running-mcp
npm install && npm run build
```

Register with Claude Code (available in every session):

```bash
claude mcp add --scope user whats-running -- node /path/to/whats-running-mcp/dist/index.js
```

Or in any MCP client config:

```json
{
  "mcpServers": {
    "whats-running": {
      "command": "node",
      "args": ["/path/to/whats-running-mcp/dist/index.js"]
    }
  }
}
```

## Configuration

| Env var | Default | Purpose |
|---|---|---|
| `WR_AGENT_PATTERNS` | `claude,codex,aider,cursor-agent,copilot,goose` | Comma-separated substrings that mark a process as an "agent" in `agent_sessions` |

## Design notes

- **Read-only by construction.** Every command is a fixed binary with fixed flags via `execFile` — no shell, and nothing derived from model input is ever executed. The only model-controlled inputs are a boolean and a substring filter applied in-process.
- **Local information disclosure is the point.** The model sees process names, pids, working directories, and ports of *your own machine*. Don't attach this server to an untrusted client.
- **Best-effort, never blocking.** Commands time out at 10s and degrade to empty results rather than erroring the whole snapshot.

Platform: macOS first (my daily driver), Linux best-effort (`systemd --user` in place of `launchctl`).

## License

MIT © Zachary Pampu
