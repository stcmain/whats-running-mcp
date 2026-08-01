#!/usr/bin/env node
/**
 * whats-running-mcp — ground truth of what is ACTUALLY live on this machine.
 *
 * Agents hallucinate stale state: they report daemons from old transcripts,
 * memory files, and docs as if they were live. This server answers only from
 * the OS (ps / lsof / launchctl / df) — never from documentation.
 *
 * Born from running a multi-session Claude Code fleet where sessions kept
 * "health-checking" services that had been dead for weeks.
 *
 * Read-only by design: every command is a fixed binary with fixed flags.
 * Nothing derived from model input is ever passed to a shell.
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { execFile } from "node:child_process";
import { platform } from "node:os";

const VERSION = "0.1.0";
const IS_MAC = platform() === "darwin";

/** Default process-name patterns that count as "agent" processes. */
const DEFAULT_AGENT_PATTERNS = [
  "claude",
  "codex",
  "aider",
  "cursor-agent",
  "copilot",
  "goose",
];

function agentPatterns(): string[] {
  const env = process.env.WR_AGENT_PATTERNS;
  if (!env) return DEFAULT_AGENT_PATTERNS;
  return env
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
}

/** Run a fixed binary with fixed args. No shell, no interpolation of model input. */
function run(cmd: string, args: string[]): Promise<string> {
  return new Promise((resolve) => {
    execFile(cmd, args, { timeout: 10_000, maxBuffer: 8 * 1024 * 1024 }, (err, stdout) => {
      // Best-effort: on error return whatever we got; callers treat "" as unknown.
      resolve(stdout ?? "");
    });
  });
}

interface ProcRow {
  pid: number;
  tty: string;
  uptime: string;
  command: string;
}

async function psRows(): Promise<ProcRow[]> {
  const out = await run("ps", ["-Axo", "pid=,tty=,etime=,command="]);
  const rows: ProcRow[] = [];
  for (const line of out.split("\n")) {
    const m = line.match(/^\s*(\d+)\s+(\S+)\s+(\S+)\s+(.*)$/);
    if (!m) continue;
    rows.push({ pid: Number(m[1]), tty: m[2], uptime: m[3], command: m[4] });
  }
  return rows;
}

async function cwdOf(pid: number): Promise<string | null> {
  const out = await run("lsof", ["-a", "-d", "cwd", "-p", String(pid), "-Fn"]);
  const m = out.match(/^n(.+)$/m);
  return m ? m[1] : null;
}

function isAgentProc(command: string): boolean {
  const lc = command.toLowerCase();
  // Ignore helper/renderer processes and this server itself.
  if (/(helper|renderer|whats-running-mcp)/.test(lc)) return false;
  return agentPatterns().some((p) => lc.includes(p));
}

async function collectAgentSessions(includeDetached: boolean) {
  const rows = await psRows();
  const agents = rows.filter((r) => isAgentProc(r.command));
  const interactive = agents.filter((r) => r.tty !== "??");
  const detached = agents.filter((r) => r.tty === "??");

  const describe = async (r: ProcRow) => ({
    pid: r.pid,
    tty: r.tty === "??" ? null : r.tty,
    uptime: r.uptime,
    cwd: await cwdOf(r.pid),
    command: r.command.slice(0, 160),
  });

  return {
    interactive: await Promise.all(interactive.map(describe)),
    detached: includeDetached ? await Promise.all(detached.map(describe)) : undefined,
    note: "interactive = attached to a terminal a human can see; detached = background/orphan agent processes",
  };
}

async function collectListeners() {
  const out = await run("lsof", ["-nP", "-iTCP", "-sTCP:LISTEN"]);
  const seen = new Set<string>();
  const listeners: { process: string; pid: number; address: string }[] = [];
  for (const line of out.split("\n").slice(1)) {
    const parts = line.split(/\s+/);
    if (parts.length < 9) continue;
    const key = `${parts[0]}|${parts[1]}|${parts[8]}`;
    if (seen.has(key)) continue;
    seen.add(key);
    listeners.push({ process: parts[0], pid: Number(parts[1]), address: parts[8] });
  }
  return listeners;
}

async function collectDaemons(filter?: string) {
  if (IS_MAC) {
    const out = await run("launchctl", ["list"]);
    const rows: { label: string; pid: number | null; status: string }[] = [];
    for (const line of out.split("\n").slice(1)) {
      const m = line.match(/^\s*(\S+)\s+(\S+)\s+(\S+)/);
      if (!m) continue;
      const [, pid, status, label] = m;
      if (label.startsWith("com.apple.")) continue;
      if (filter && !label.toLowerCase().includes(filter.toLowerCase())) continue;
      rows.push({ label, pid: pid === "-" ? null : Number(pid), status });
    }
    return { platform: "darwin", source: "launchctl list (non-Apple)", daemons: rows };
  }
  const out = await run("systemctl", [
    "--user",
    "list-units",
    "--type=service",
    "--state=running",
    "--no-legend",
    "--plain",
  ]);
  const rows = out
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean)
    .map((l) => l.split(/\s+/)[0])
    .filter((u) => !filter || u.toLowerCase().includes(filter.toLowerCase()))
    .map((unit) => ({ label: unit, pid: null, status: "running" }));
  return { platform: platform(), source: "systemctl --user (running services)", daemons: rows };
}

async function collectSystem() {
  const uptime = (await run("uptime", [])).trim();
  const df = await run("df", ["-h", "/"]);
  const dfLine = df.split("\n")[1]?.trim() ?? "";
  const parts = dfLine.split(/\s+/);
  return {
    uptime,
    disk_root: parts.length >= 5 ? { free: parts[3], used_pct: parts[4] } : null,
  };
}

function text(obj: unknown) {
  return { content: [{ type: "text" as const, text: JSON.stringify(obj, null, 2) }] };
}

const server = new McpServer({ name: "whats-running", version: VERSION });

server.registerTool(
  "agent_sessions",
  {
    description:
      "List AI-agent processes actually running right now (Claude Code, Codex, Aider, ...). " +
      "Separates terminal-attached sessions (a human can see them) from detached/orphan ones. " +
      "Reads ps/lsof directly — never transcripts or docs. Patterns configurable via WR_AGENT_PATTERNS.",
    inputSchema: {
      include_detached: z
        .boolean()
        .optional()
        .describe("Also list background/orphan agent processes with no terminal (default true)"),
    },
  },
  async ({ include_detached }) => text(await collectAgentSessions(include_detached ?? true))
);

server.registerTool(
  "listening_ports",
  {
    description:
      "All TCP ports currently in LISTEN state with owning process and pid (lsof). " +
      "The definitive answer to 'is service X actually up?' — nothing hidden, nothing assumed.",
    inputSchema: {},
  },
  async () => text(await collectListeners())
);

server.registerTool(
  "daemons",
  {
    description:
      "Persistent services actually loaded right now: launchctl (macOS, non-Apple) or " +
      "systemd user services (Linux). Optional case-insensitive substring filter on the label.",
    inputSchema: {
      filter: z.string().max(100).optional().describe("Substring filter on service label"),
    },
  },
  async ({ filter }) => text(await collectDaemons(filter))
);

server.registerTool(
  "system_stats",
  {
    description: "Load average, uptime, and root-disk free space.",
    inputSchema: {},
  },
  async () => text(await collectSystem())
);

server.registerTool(
  "whats_running",
  {
    description:
      "Full live snapshot in one call: agent sessions, TCP listeners, loaded daemons, system stats. " +
      "Use at session start to ground yourself in what is ACTUALLY live instead of stale memory.",
    inputSchema: {},
  },
  async () => {
    const [agents, listeners, daemons, system] = await Promise.all([
      collectAgentSessions(true),
      collectListeners(),
      collectDaemons(),
      collectSystem(),
    ]);
    return text({
      generated_at: new Date().toISOString(),
      agent_sessions: agents,
      listening_tcp: listeners,
      daemons,
      system,
    });
  }
);

const transport = new StdioServerTransport();
await server.connect(transport);
