import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

/**
 * These are the claims this project makes publicly — in the README, on the npm
 * page, and in the Product Hunt listing. They are asserted here so that a
 * regression breaks CI instead of quietly making the marketing false.
 *
 * If you are changing the server and a test here fails, the correct fix is
 * usually to change the claim, not to weaken the test.
 */
const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const SRC = readFileSync(join(ROOT, "src/index.ts"), "utf8");

// Strip comments so prose about networking can't trip the source checks.
const CODE = SRC.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

describe('claim: "no network code in it — no telemetry, nothing leaves the machine"', () => {
  const FORBIDDEN_MODULES = ["http", "https", "net", "tls", "dgram", "dns", "node:http", "node:https", "node:net", "node:tls", "node:dgram", "node:dns"];

  test("imports no networking module", () => {
    for (const mod of FORBIDDEN_MODULES) {
      const importRe = new RegExp(`from\\s+["']${mod}["']`);
      const requireRe = new RegExp(`require\\(\\s*["']${mod}["']\\s*\\)`);
      assert.ok(!importRe.test(CODE), `imports "${mod}" — breaks the no-network claim`);
      assert.ok(!requireRe.test(CODE), `requires "${mod}" — breaks the no-network claim`);
    }
  });

  test("makes no outbound calls", () => {
    for (const pattern of [/\bfetch\s*\(/, /\bXMLHttpRequest\b/, /\bWebSocket\b/, /\baxios\b/, /\bundici\b/, /node-fetch/]) {
      assert.ok(!pattern.test(CODE), `found ${pattern} — breaks the no-network claim`);
    }
  });

  test("declares no network dependency", () => {
    const pkg = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8"));
    const deps = Object.keys(pkg.dependencies ?? {});
    assert.deepEqual(deps.sort(), ["@modelcontextprotocol/sdk", "zod"], "runtime dependency set changed — re-audit the no-network claim");
  });
});

describe('claim: "read-only by construction — no shell, nothing model-produced is executed"', () => {
  test("never spawns a shell", () => {
    for (const pattern of [/\bexecSync\s*\(/, /\bspawnSync\s*\(/, /\bspawn\s*\(/, /\bshell\s*:\s*true/, /[^A-Za-z]exec\s*\(/]) {
      assert.ok(!pattern.test(CODE), `found ${pattern} — only execFile is permitted`);
    }
  });

  test("execFile is the sole process-execution primitive", () => {
    assert.match(CODE, /import\s*\{\s*execFile\s*\}\s*from\s*["']node:child_process["']/);
    const childProcessImports = CODE.match(/from\s+["']node:child_process["']/g) ?? [];
    assert.equal(childProcessImports.length, 1, "more than one child_process import — re-audit execution surface");
  });

  test("every command is a string literal, never interpolated", () => {
    // Matches `run("ps", [...])` call sites. The wrapper's own declaration
    // (`function run(cmd: string, ...)`) is excluded so it is not mistaken for
    // a call site with a non-literal command.
    const CALLS = CODE.replace(/function\s+run\s*\([^)]*\)/g, "");
    const callSites = [...CALLS.matchAll(/\brun\(\s*([^,]+),/g)].map((m) => m[1].trim());
    assert.ok(callSites.length > 0, "no run() call sites found — did the wrapper get renamed?");
    for (const arg of callSites) {
      assert.match(arg, /^"[a-z]+"$/, `command argument ${arg} is not a bare string literal`);
    }
  });

  test("no template literals or concatenation inside command argument arrays", () => {
    const argArrays = [...CODE.matchAll(/\brun\(\s*"[a-z]+"\s*,\s*\[([\s\S]*?)\]/g)].map((m) => m[1]);
    assert.ok(argArrays.length > 0, "no run() argument arrays found");
    for (const args of argArrays) {
      assert.ok(!args.includes("`"), `template literal in command args: ${args.trim()}`);
      assert.ok(!/\+/.test(args), `string concatenation in command args: ${args.trim()}`);
    }
  });
});

describe('claim: "the only model-controlled inputs are one boolean and one substring filter"', () => {
  test("exposes exactly two schema inputs across all tools", () => {
    const zodInputs = [...CODE.matchAll(/^\s*(\w+)\s*:\s*z\s*$/gm), ...CODE.matchAll(/^\s*(\w+)\s*:\s*z\./gm)];
    const names = [...new Set(zodInputs.map((m) => m[1]))].sort();
    assert.deepEqual(names, ["filter", "include_detached"], `model-controlled input surface changed: ${names.join(", ")}`);
  });

  test("the filter is bounded", () => {
    assert.match(CODE, /filter\s*:\s*z[\s\S]{0,40}\.string\(\)[\s\S]{0,40}\.max\(\s*\d+\s*\)/, "filter must stay length-bounded");
  });

  test("the filter is applied in-process and never reaches a command argument", () => {
    assert.match(CODE, /includes\(\s*filter/, "expected an in-process String.includes match on filter");
    const argArrays = [...CODE.matchAll(/\brun\(\s*"[a-z]+"\s*,\s*\[([\s\S]*?)\]/g)].map((m) => m[1]);
    for (const args of argArrays) {
      assert.ok(!/filter/.test(args), `filter leaked into command args: ${args.trim()}`);
    }
  });
});

describe("claim: probes are bounded and degrade instead of throwing", () => {
  test("every command runs under an explicit timeout", () => {
    assert.match(CODE, /timeout\s*:\s*[\d_]+/, "execFile must pass an explicit timeout");
  });

  test("a failed probe resolves to empty output rather than rejecting", () => {
    // This is the documented wart: callers treat "" as unknown. Asserted so the
    // behaviour cannot change silently while the README still describes it.
    assert.match(CODE, /resolve\(\s*stdout\s*\?\?\s*""\s*\)/);
  });
});

describe("claim: MIT licensed and honestly versioned", () => {
  test("package license is MIT and a LICENSE file ships", () => {
    const pkg = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8"));
    assert.equal(pkg.license, "MIT");
    assert.match(readFileSync(join(ROOT, "LICENSE"), "utf8"), /MIT License/i);
    assert.ok(pkg.files.includes("LICENSE"), "LICENSE must ship in the tarball");
  });

  test("version is read from package.json so it cannot drift from what is published", () => {
    // Regression guard: this server previously reported a hardcoded version
    // that disagreed with the published one.
    assert.match(CODE, /createRequire\(import\.meta\.url\)\("\.\.\/package\.json"\)\.version/);
    assert.ok(!/version\s*:\s*["']\d+\.\d+\.\d+["']/.test(CODE), "hardcoded version string found in source");
  });

  test("the tarball ships only build output and docs", () => {
    const pkg = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8"));
    assert.deepEqual(pkg.files.sort(), ["LICENSE", "README.md", "dist"]);
  });
});
