<p align="center">
  <a href="https://pi.dev">
    <img alt="pi logo" src="https://pi.dev/logo-auto.svg" width="128">
  </a>
</p>
<p align="center">
  <a href="https://discord.com/invite/3cU7Bz4UPx"><img alt="Discord" src="https://img.shields.io/badge/discord-community-5865F2?style=flat-square&logo=discord&logoColor=white" /></a>
  <a href="https://www.npmjs.com/package/@earendil-works/pi-coding-agent"><img alt="npm" src="https://img.shields.io/npm/v/@earendil-works/pi-coding-agent?style=flat-square" /></a>
</p>

> New issues and PRs from new contributors are auto-closed by default. Maintainers review auto-closed issues daily. See [CONTRIBUTING.md](CONTRIBUTING.md).

# Pi

Pi is a minimal, extensible agent harness that you can make your own.

Adapt Pi to your workflows, not the other way around. Customize Pi with [extensions](packages/coding-agent/docs/extensions.md), [skills](packages/coding-agent/docs/skills.md), [prompt templates](packages/coding-agent/docs/prompt-templates.md), and [themes](packages/coding-agent/docs/themes.md). Bundle them as [Pi packages](packages/coding-agent/docs/packages.md) and share via npm or git.

Pi ships with powerful defaults but skips features like sub-agents and plan mode. Ask Pi to build what you want, or install a package that does it your way.

Use Pi [interactively](packages/coding-agent/docs/usage.md), automate it in [print or JSON mode](packages/coding-agent/docs/cli.md), control it over [RPC](packages/coding-agent/docs/rpc.md), or build apps with the [Pi TypeScript SDK](packages/coding-agent/docs/sdk.md). See [OpenClaw](https://github.com/OpenClaw/OpenClaw) for a real-world integration.

## Getting started

### Install from this fork (includes headless mode & Deep Research)

```bash
# pnpm (recommended)
pnpm add github:monpanache11/pi#main

# npm
npm install github:monpanache11/pi#main
```

### Official release

Install the command-line interface:

```bash
curl -fsSL https://pi.dev/install.sh | sh
```

On Windows:

```shell
powershell -c "irm https://pi.dev/install.ps1 | iex"
```

The installer pins all dependencies and updates Pi with `pi update`. Alternatively, install directly with npm, which does not pin transitive dependencies:

```bash
npm install -g --ignore-scripts @earendil-works/pi-coding-agent
```

Pi requires Node.js 22.19 or newer. The macOS, Linux, and Windows installers can install it if needed. Pi does not require dependency lifecycle scripts for a normal npm installation.

Start Pi in the directory where you want it to work:

```bash
cd /path/to/project
pi
```

For a built-in AI provider, run `/login` inside Pi to connect a subscription or API key. Then give Pi a task.

See the [documentation](https://pi.dev/docs/latest) for full setup and usage instructions, or [visit pi.dev](https://pi.dev) for demos.

## 🚀 This Fork: Headless Mode + Deep Research

This fork adds **headless execution mode** and a **Deep Research extension** for multi-agent research workflows.

### ✨ What's New

| Feature | Description |
|---------|-------------|
| **Headless CLI** | Run Pi non-interactively with `--headless` flag for automation & sub-agents |
| **Deep Research** | 5-phase orchestration: Planner → Parallel Researchers → Synthesizer → Critic → Fact-checker |
| **Agent Loader** | Load custom agents from `~/.pi/agent/agents/` |
| **ModelResolver** | Model inheritance via env vars (`PI_MODEL`, `PI_PROVIDER`) — sub-agents inherit parent's model |
| **Native Tools** | Provider-native web search & code interpreter (OpenAI, Anthropic, Google, xAI) |
| **Updated Model Catalogs** | 37+ provider model definitions refreshed |

---

### Architecture Overview

```
USER QUERY
    │
    ▼
/deep-research "research question" --depth comprehensive
    │
    ▼
DEEP RESEARCH EXTENSION (orchestrator)
    │
    ├─► Sets PI_MODEL, PI_PROVIDER, API keys as env vars
    │
    ├─► Phase 1: PLANNER (headless agent)
    │      Breaks question into 3-5 sub-questions
    │
    ├─► Phase 2: PARALLEL RESEARCHERS (3-5 headless agents)
    │      Each researches one sub-question using native web search
    │
    ├─► Phase 3: SYNTHESIZER (headless agent)
    │      Combines findings into coherent report
    │
    ├─► Phase 4: CRITIC (headless agent)
    │      Checks for logical gaps, missing evidence
    │
    └─► Phase 5: FACT-CHECKER (headless agent)
           Verifies key claims
    │
    ▼
STRUCTURED JSON REPORT + CITATIONS
```

**Key principle:** Model is chosen **once** by the user. Sub-agents **cannot override** it — they inherit via env vars only. `HeadlessCLI` explicitly rejects `--model`/`--provider` flags.

---

### Quick Start: Deep Research

```bash
# Install this fork
pnpm add github:monpanache11/pi#main

# Run Pi interactively
cd /your/project
pi

# Inside Pi, run deep research:
> /deep-research "Compare Rust vs Go for microservices in 2024" --depth comprehensive
```

**Depth options:**
- `--depth quick` — 2 researchers, ~2 min
- `--depth standard` — 3 researchers, ~5 min (default)
- `--depth comprehensive` — 5 researchers, ~10 min

Output: Markdown report with citations, confidence scores, and gap analysis.

---

### Headless Mode (for automation / sub-agents)

```bash
# Direct headless execution (used by Deep Research internally)
PI_MODEL="gpt-4o" PI_PROVIDER="openai" OPENAI_API_KEY="sk-..." \
pi --headless \
   --agent researcher_headless \
   --task-file /tmp/task.json \
   --output /tmp/result.json \
   --max-turns 15
```

**Task file** (`/tmp/task.json`):
```json
{
  "sub_question_id": "sq1",
  "question": "Rust vs Go for microservices in 2024",
  "description": "Focus on performance, ecosystem, hiring, operational maturity",
  "budget": 5
}
```

**Output** (`/tmp/result.json`):
```json
{
  "sub_question_id": "sq1",
  "findings": "## Key Findings\n...",
  "citations": [{"id": 1, "title": "...", "url": "...", "source_type": "primary", "domain": "..."}],
  "gaps": [],
  "confidence": "HIGH",
  "confidence_reasoning": "...",
  "searches_used": 4,
  "turns_used": 12
}
```

---

### Native Tools by Provider

| Provider | Tools | API |
|----------|-------|-----|
| **OpenAI** | `web_search_preview`, `code_interpreter` | Responses API |
| **Anthropic** | `web_search` | Messages API |
| **Google** | `google_search` | Generative AI |
| **xAI** | `web_search` | OpenAI-compatible |

No need for external `web_search`/`web_fetch` tools — the model's **native** search is used directly.

---

### Custom Agents

Place agent definitions in `~/.pi/agent/agents/`:

```
~/.pi/agent/agents/
├── researcher_headless.md    # Included in this fork
└── my_custom_agent.md        # Your agents
```

Agent frontmatter:
```markdown
---
name: my_agent
description: What this agent does
tools: think_tool, write_output
---
Your prompt here...
```

Load with `--agent my_agent` in headless mode.

---

### Environment Variables

| Variable | Purpose |
|----------|---------|
| `PI_MODEL` | Model ID (e.g., `gpt-4o`, `claude-3-5-sonnet-20241022`) |
| `PI_PROVIDER` | Provider name (`openai`, `anthropic`, `google`, `xai`, etc.) |
| `PI_OFFLINE` | `1` to skip network calls (testing) |
| `OPENAI_API_KEY` / `ANTHROPIC_API_KEY` / etc. | Provider API keys |

---

## Run with Nix

```bash
nix run github:earendil-works/pi/stable
```

`stable` points at the latest release. Install it with `nix profile add github:earendil-works/pi/stable` and update with `nix profile upgrade pi`. Use a release tag such as `github:earendil-works/pi/v1.0.0` to pin a version, or `github:earendil-works/pi` for unreleased changes on `main`. Nix builds Pi from source.

Supports ARM64 and x86-64 on Linux and macOS. Use `nix build .` or `nix run .` to build or run your checkout.

Nix builds are offline, so the bundled model data comes from a pi.dev model catalog revision pinned in `nix/model-catalog.json`. At runtime, Pi still overlays newer catalog data from pi.dev as usual. The Nix workflow replaces the pin on `main` when it no longer matches the checkout, for example after a provider is added or gains a new model type. To refresh it by hand:

```bash
npm run update:model-catalog-pin
```

## Packages

This monorepo contains the Pi CLI and its supporting libraries.

| Package | Description |
|---------|-------------|
| **[@earendil-works/chord](packages/chord)** | Typed host runtime for hot-reloadable plugins, contracts, replicated state, and RPC over JSON links |
| **[@earendil-works/pi-telemetry](packages/telemetry)** | Vendor-neutral telemetry contracts, reference adapter, conformance tests, and typed schemas |
| **[@earendil-works/pi-ai](packages/ai)** | Unified multi-provider LLM API (OpenAI, Anthropic, Google, etc.) |
| **[@earendil-works/pi-durable](packages/durable)** | Durable conversation, task, and document runtime |
| **[@earendil-works/pi-agent-core](packages/agent)** | Agent runtime with tool calling and state management |
| **[@earendil-works/pi-coding-agent](packages/coding-agent)** | Interactive coding agent CLI |
| **[@earendil-works/pi-tui](packages/tui)** | Terminal UI library with differential rendering |

For Slack/chat automation and workflows see [earendil-works/pi-chat](https://github.com/earendil-works/pi-chat).

## Permissions & Containerization

Pi does not include a built-in permission system for restricting filesystem, process, network, or credential access. By default, it runs with the permissions of the user and process that launched it.

If you need stronger boundaries, containerize or sandbox Pi. See [packages/coding-agent/docs/containerization.md](packages/coding-agent/docs/containerization.md) for three patterns:

- **Gondolin extension**: keep `pi` and provider auth on the host while routing built-in tools and `!` commands into a local Linux micro-VM.
- **Plain Docker**: run the whole `pi` process in a local container for simple isolation.
- **OpenShell**: run the whole `pi` process in a policy-controlled sandbox.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for contribution guidelines and [AGENTS.md](AGENTS.md) for project-specific rules (for both humans and agents).  Longer term plans for Pi can also be found in [RFCs](https://rfc.earendil.com/keyword/pi/).

## Development

```bash
npm install --ignore-scripts  # Install all dependencies without running lifecycle scripts
npm run build         # Refresh model data, then build all packages
npm run build:offline # Rebuild using existing model data without network access
npm run check         # Lint, format, and type check
./test.sh            # Run tests (skips LLM-dependent tests without API keys)
./pi-test.sh         # Run pi from sources (can be run from any directory)
```

### Using local packages outside the monorepo

Build every public package into one coherent local artifact set:

```bash
npm run pack:packages -- --out .artifacts/pi-packages
```

This refreshes model data before building `pi-ai`. To avoid network access when
model data is already hydrated, pass `--offline-model-data`.

Then configure an external project to consume one package and resolve all of
its Pi dependencies from the same artifact set. npm is the default:

```bash
node scripts/use-local-packages.mjs \
  --manifest .artifacts/pi-packages/manifest.json \
  --consumer ../my-project \
  --package @earendil-works/pi-durable \
  --package @earendil-works/pi-agent-core
cd ../my-project
npm install --ignore-scripts
```

For a pnpm project, point `--consumer` at the workspace root:

```bash
node scripts/use-local-packages.mjs \
  --manifest .artifacts/pi-packages/manifest.json \
  --consumer ../my-project \
  --package @earendil-works/pi-agent-core \
  --package-manager pnpm
cd ../my-project
pnpm install --ignore-scripts
```

Repeat `--package` for each direct dependency. The command updates the
consumer's `package.json` with content-addressed local `file:` references. It
writes transitive overrides to `package.json` for npm or `pnpm-workspace.yaml`
for pnpm. Keep the artifact directory available while installing or updating
the consumer. Re-run both commands after changing Pi source.

## Building standalone binaries from release source

GitHub releases include a versioned source archive covered by the release's `SHA256SUMS` file. Extract it and run the same build script used for the official standalone binaries:

```bash
VERSION="<release-version>"
tar -xzf "pi-${VERSION}-source.tar.gz"
cd "pi-${VERSION}"
./scripts/build-binaries.sh --offline-model-data --platform linux-x64 --out "$PWD/out"
```

The archive includes release model data and native prebuilds. `--offline-model-data` uses that model data without refreshing provider catalogs. The script installs dependencies and builds the executable with its runtime assets; pass `--skip-install` if dependencies are already provided.

## Supply-chain hardening

We treat npm dependency changes as reviewed code changes.

- Direct external dependencies are pinned to exact versions. Internal workspace packages remain version-ranged.
- `.npmrc` sets `save-exact=true` and `min-release-age=2` to avoid same-day dependency releases during npm resolution.
- `package-lock.json` is the dependency ground truth. Pre-commit blocks accidental lockfile commits unless `PI_ALLOW_LOCKFILE_CHANGE=1` is set.
- `npm run check` verifies pinned direct deps, native TypeScript import compatibility, and the generated coding-agent install lock.
- The pi.dev installer installs from `packages/coding-agent/install-lock/`, generated from the root lockfile, to pin transitive deps. The npm package does not pin transitive deps.
- Local release smoke tests and npm publication use the same tarball packer; npm publishes the validated tarballs rather than repacking workspace directories.
- Local release installs, documented npm installs, and `pi update --self` use `--ignore-scripts` where supported.
- CI installs with `npm ci --ignore-scripts`, and a scheduled GitHub workflow runs `npm audit --omit=dev` plus `npm audit signatures --omit=dev`.
- Install lock generation has an explicit allowlist for dependency lifecycle scripts; new lifecycle-script deps fail checks until reviewed.

## Share your OSS coding agent sessions

If you use Pi or other coding agents for open source work, please share your sessions.

Public OSS session data helps improve coding agents with real-world tasks, tool use, failures, and fixes instead of toy benchmarks.

For the full explanation, see [this post on X](https://x.com/badlogicgames/status/2037811643774652911).

To publish sessions, use [`badlogic/pi-share-hf`](https://github.com/badlogic/pi-share-hf). Read its README.md for setup instructions. All you need is a Hugging Face account, the Hugging Face CLI, and `pi-share-hf`.

You can also watch [this video](https://x.com/badlogicgames/status/2041151967695634619), where I show how I publish my `pi-mono` sessions.

I regularly publish my own `pi-mono` work sessions here:

- [badlogicgames/pi-mono on Hugging Face](https://huggingface.co/datasets/badlogicgames/pi-mono)

## License

MIT

<p align="center">
  <a href="https://pi.dev">pi.dev</a> domain graciously donated by
  <br /><br />
  <a href="https://exe.dev"><img src="packages/coding-agent/docs/images/exy.png" alt="Exy mascot" width="48" /><br />exe.dev</a>
</p>
