# Quality Check — DXT one-click packaging for the whats-* MCP family (2026-08-08)

## What shipped
The distribution gap-fill for the free MCP funnel: `whats-running-mcp` (the flagship)
was the only family member with no DXT/MCPB `manifest.json`. Now:

1. **`tools/whats-running-mcp/manifest.json`** — NEW. manifest_version 0.2, version
   0.1.6 (synced to package.json AND to the npm published version), bundled-code
   `mcp_config` (`node ${__dirname}/dist/index.js` — no npx, no network at launch),
   `WR_AGENT_PATTERNS` exposed as optional `user_config`, `tools` array matching the
   served tools exactly, compatibility darwin/linux + node>=18 (mirrors CI matrix),
   icon.
2. **Sibling manifests corrected** (they existed but would not have shipped honestly):
   - `whats-allowed-mcp`: version 0.1.0 -> 0.1.1 (pkg/npm truth), `npx -y` ->
     bundled `${__dirname}` config, icon, compatibility.
   - `whats-inherited-mcp`: version 0.1.0 -> 0.1.6 (pkg/npm truth), same fixes.
   - `whats-loaded-mcp`: version 0.2.3 -> 0.2.5 (pkg/npm truth).
   Rationale: `npx -y` inside a one-click bundle re-downloads from npm at every
   launch and requires npx on PATH — fails exactly the non-terminal audience the
   bundle exists for.
3. **Four packed bundles** in `~/Desktop/STC/PRODUCTS/dxt-bundles/`
   (`.dxt` + byte-identical `.mcpb` twins, `SHA256SUMS`, `.gitignore` so 25MB of
   binaries never enters the STC monorepo, `SHIP.md` runbook for the release agent).
4. **README one-click install section** added to all four repos (ships inside the
   bundles too — bundles were re-packed after the README edits).

NOT done here by design (later serialized agent, per task): commits/pushes, GitHub
release creation/asset upload, extensions-directory submission. `SHIP.md` carries
the exact commands and the verified facts they rest on (no releases exist yet on
any of the four repos; `modelcontextprotocol/mcpb` is the canonical spec repo).

## How it was verified (end-to-end, not just compiled)
- All four repos rebuilt from source and their full suites run this session:
  34+22+22+22 = **100 tests, 0 failures** (`npm test`, exit 0 each).
- All four manifests: `npx @anthropic-ai/mcpb validate manifest.json` ->
  "Manifest schema validation passes!" (icon size note is informational).
- **The shipped bytes, not the repos**: each packed bundle was unpacked with the
  official CLI (`mcpb unpack`) into a clean scratch dir and driven over real MCP
  stdio JSON-RPC exactly as Claude Desktop runs it (`${__dirname}` substituted,
  manifest env applied): initialize -> tools/list -> a real tool call. 4/4 PASS:
  - whats-running@0.1.6: 5 tools, `whats_running` returned a live 4.3KB OS
    snapshot (fresh `generated_at` timestamp, live pids/ports).
  - whats-allowed-mcp@0.1.1: 4 tools, `whats_allowed` returned the permissions report.
  - whats-loaded@0.2.5: 5 tools, `context_budget` returned the context report.
  - whats-inherited-mcp@0.1.6: 5 tools, `inherited_summary` returned the scan.
  Served `serverInfo.version` matched the manifest version in every bundle.
- Version truth triangulated: npm registry (`npm view <pkg> version`) ==
  package.json == manifest.json == served serverInfo for all four.
- Repo existence for every URL written into READMEs/SHIP.md: `gh api
  repos/stcmain/<name>` (4/4 exist); release absence: `gh release list` (0 rows).
- Bundle contents spot-checked: unpacked README carries the new one-click section.

## Truth check (STC_TRUTH.json keys touched)
- `objective.live_lanes` -> "intel/automation tools productized for revenue" and
  `objective.primary_2026-07-09` (products lane LIVE): this is free-tool
  distribution feeding the $29 kits — ZP's own IP, nothing sold here directly.
- No dead lane touched: no music/beat sales, no outside-client services, no
  LinkedIn/Bluesky, no local LLMs. Catalog copy: n/a (no catalog surfaces).
- Brand: public artifacts say "Shift The Culture" only (README funnel sections
  pre-existed and were not altered beyond the install section).
- Operating rule respected: no daemons/cron; everything ran on-demand this session.

## Failure modes considered
- **Buyer-gets-nothing class** (REVENUE_SURFACE_INTEGRITY): the bundle IS the
  deliverable, so verification ran against the exact packed bytes, unpacked with
  the official tool, not against the repos ("attached is not delivered").
- **Version lies**: three sibling manifests carried stale versions (0.1.0/0.1.0/
  0.2.3 vs npm 0.1.1/0.1.6/0.2.5) — a user would install "0.1.0" and get 0.1.6
  behavior. Fixed and triangulated against npm before packing.
- **npx-in-bundle trap**: a one-click bundle that shells out to npx fails on
  machines without Node — the exact audience of the product. All bundles now run
  their own code with bundled prod node_modules (91 pkgs, ~3.1MB zipped each).
- **`npm ci` prepare-script trap**: `--omit=dev` broke `prepare` (tsc missing);
  staged installs use `--ignore-scripts` with dist/ prebuilt by the tested repo
  build, so a truncated install cannot ship silently.
- **Monorepo bloat**: 8 x 3.1MB binaries are gitignored inside
  `PRODUCTS/dxt-bundles/`; only SHA256SUMS + SHIP.md are commit-eligible.
- **Fabricated-URL class**: every URL in READMEs/SHIP.md was `gh api`-verified
  this session; release-asset URLs are deliberately NOT written anywhere because
  the releases do not exist yet.
- **Smoke-harness false negative**: first harness run demanded JSON payloads and
  "failed" three healthy servers that return markdown; the harness was fixed and
  the failure class documented rather than loosened silently.

## Reversal plan
- Bundles: delete `~/Desktop/STC/PRODUCTS/dxt-bundles/` — nothing published, no
  external state exists.
- Repo edits: each of the four repos is a standalone git repo with all changes
  uncommitted — `git checkout -- manifest.json README.md` (and `git clean -f
  manifest.json quality_check.md` in whats-running-mcp) restores HEAD exactly.
- Nothing was committed, pushed, released, or submitted anywhere.
