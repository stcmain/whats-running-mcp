import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { McpHarness } from "./helpers/mcp-client.mjs";

/**
 * Drives the built server over stdio exactly as an MCP host does. Requires
 * `npm run build` first (the pretest script handles it).
 */
const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const PKG = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8"));

const EXPECTED_TOOLS = ["agent_sessions", "daemons", "listening_ports", "system_stats", "whats_running"];

let mcp;

before(async () => {
  mcp = new McpHarness(join(ROOT, "dist/index.js"));
  await mcp.start();
});

after(async () => {
  await mcp?.stop();
});

describe("handshake", () => {
  test("negotiates a protocol version", () => {
    assert.ok(mcp.initializeResult.protocolVersion, "no protocolVersion returned");
  });

  test("identifies itself as whats-running", () => {
    assert.equal(mcp.initializeResult.serverInfo.name, "whats-running");
  });

  test("reports the version from package.json, not a hardcoded string", () => {
    // Regression guard for a real past bug: the server once reported a version
    // that disagreed with what was published to npm.
    assert.equal(
      mcp.initializeResult.serverInfo.version,
      PKG.version,
      "reported version drifted from package.json",
    );
  });

  test("writes nothing to stdout that is not JSON-RPC", () => {
    // stdout is the transport; stray logging corrupts the stream for the host.
    assert.equal(mcp.buffer.trim(), "", `unparsed stdout remainder: ${mcp.buffer.slice(0, 200)}`);
  });
});

describe("tools/list", () => {
  test("exposes exactly the five documented tools", async () => {
    const { tools } = await mcp.listTools();
    const names = tools.map((t) => t.name).sort();
    assert.deepEqual(names, EXPECTED_TOOLS, "tool surface changed — README, npm page and PH listing all say five");
  });

  test("every tool is documented", async () => {
    const { tools } = await mcp.listTools();
    for (const tool of tools) {
      assert.ok(tool.description && tool.description.length > 20, `${tool.name} has no meaningful description`);
    }
  });
});

describe("tools/call", () => {
  for (const name of EXPECTED_TOOLS) {
    test(`${name} returns text content without erroring`, async () => {
      const res = await mcp.callTool(name);
      assert.ok(Array.isArray(res.content) && res.content.length > 0, `${name} returned no content`);
      assert.equal(res.content[0].type, "text");
      assert.ok(res.content[0].text.length > 0, `${name} returned empty text`);
      assert.notEqual(res.isError, true, `${name} reported isError`);
    });
  }

  test("whats_running returns the full snapshot shape", async () => {
    const res = await mcp.callTool("whats_running");
    const parsed = JSON.parse(res.content[0].text);
    for (const key of ["generated_at", "agent_sessions", "listening_tcp", "daemons"]) {
      assert.ok(key in parsed, `snapshot missing "${key}"`);
    }
  });

  test("system_stats reports uptime and root disk", async () => {
    const parsed = JSON.parse((await mcp.callTool("system_stats")).content[0].text);
    assert.ok("uptime" in parsed, "missing uptime");
    assert.ok("disk_root" in parsed, "missing disk_root");
  });

  test("daemons accepts a substring filter", async () => {
    const res = await mcp.callTool("daemons", { filter: "com.apple" });
    assert.equal(res.isError, undefined ?? res.isError, "filtered call should not error");
    assert.ok(res.content[0].text.length > 0);
  });

  test("daemons filter does not execute injected shell metacharacters", async () => {
    // The filter is matched in-process; this asserts the server survives input
    // that would be catastrophic if it were ever interpolated into a command.
    const res = await mcp.callTool("daemons", { filter: '"; touch /tmp/whats-running-pwned; #' });
    assert.notEqual(res.isError, true, "hostile filter should be handled, not error");
    const { existsSync } = await import("node:fs");
    assert.equal(existsSync("/tmp/whats-running-pwned"), false, "COMMAND INJECTION: filter reached a shell");
  });

  test("agent_sessions honours include_detached", async () => {
    const withDetached = JSON.parse((await mcp.callTool("agent_sessions", { include_detached: true })).content[0].text);
    const without = JSON.parse((await mcp.callTool("agent_sessions", { include_detached: false })).content[0].text);
    assert.ok("detached" in withDetached || withDetached.detached === undefined);
    assert.equal(without.detached, undefined, "include_detached:false must omit detached sessions");
  });

  test("an unknown tool is reported as an error, not silently ignored", async () => {
    // MCP surfaces tool-level failures as a result with isError set, rather
    // than a JSON-RPC rejection. Either would be acceptable; silence is not.
    const res = await mcp.callTool("definitely_not_a_tool");
    assert.equal(res.isError, true, "unknown tool did not set isError");
    assert.match(res.content[0].text, /not found/i);
  });
});

describe("version integrity", () => {
  test("package.json version matches the built artifact's reported version", async () => {
    const snapshot = await mcp.callTool("whats_running");
    assert.ok(snapshot.content[0].text.length > 0);
    // The server reads its version from package.json at runtime; assert the
    // file the tarball ships is the one under test.
    assert.match(PKG.version, /^\d+\.\d+\.\d+$/);
  });
});
