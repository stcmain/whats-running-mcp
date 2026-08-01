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

Register with Claude Code (available in every session):

```bash
claude mcp add --scope user whats-running -- npx -y whats-running-mcp
```

Or in any MCP client config:

```json
{
  "mcpServers": {
    "whats-running": {
      "command": "npx",
      "args": ["-y", "whats-running-mcp"]
    }
  }
}
```

<details>
<summary>From source</summary>

```bash
git clone https://github.com/stcmain/whats-running-mcp.git
cd whats-running-mcp
npm install && npm run build
# then point your client at node /path/to/whats-running-mcp/dist/index.js
```

</details>

Published as [`whats-running-mcp`](https://www.npmjs.com/package/whats-running-mcp) on npm and as
`io.github.stcmain/whats-running-mcp` in the [MCP Registry](https://registry.modelcontextprotocol.io/).

## Configuration

| Env var | Default | Purpose |
|---|---|---|
| `WR_AGENT_PATTERNS` | `claude,codex,aider,cursor-agent,copilot,goose` | Comma-separated substrings that mark a process as an "agent" in `agent_sessions` |

## Design notes

- **Read-only by construction.** Every command is a fixed binary with fixed flags via `execFile` — no shell, and nothing derived from model input is ever executed. The only model-controlled inputs are a boolean and a substring filter applied in-process.
- **Local information disclosure is the point.** The model sees process names, pids, working directories, and ports of *your own machine*. Don't attach this server to an untrusted client.
- **Best-effort, never blocking.** Commands time out at 10s and degrade to empty results rather than erroring the whole snapshot.

Platform: macOS first (my daily driver), Linux best-effort (`systemd --user` in place of `launchctl`).

## Who makes this

Built by [Shift The Culture](https://shifttheculture.media/?utm_source=github&utm_medium=readme&utm_campaign=whats-running-mcp) — we run a one-person company on AI agents and ship the tooling we needed ourselves. This server is free and MIT-licensed, no strings.

This server is the free, standalone piece of a larger multi-agent setup. The rest of that tooling is paid:

- **[Agent Fleet Ops Kit](https://stcai.gumroad.com/l/agent-fleet-ops-kit?wanted=true&utm_source=github&utm_medium=readme&utm_campaign=whats-running-mcp)** ($29) — the other failure modes of running three or four agents on one box: two sessions editing the same checkout, a dev server nobody owns (so the agent tests a different app than it edits), and MCP servers leaked from crashed sessions that hold ports and RAM for weeks.
- **[Agent Reliability Kit](https://stcai.gumroad.com/l/agent-reliability-kit?wanted=true&utm_source=github&utm_medium=readme&utm_campaign=whats-running-mcp)** ($29) — a Stop hook and two CLIs that block a turn when an agent claims "done" against a repo, URL, or build that was never actually checked.

The server above stays free and MIT either way — it has no upsell in it, no telemetry, and no dependency on the paid kits.

## License

MIT © Zachary Pampu
