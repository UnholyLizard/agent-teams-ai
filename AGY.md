# Google Antigravity (AGY) Integration Guide

This document is the authoritative architectural reference for Google Antigravity (**AGY**) support in [`agent-teams-ai`](file:///c:/Users/unhol/AI_Agents/agent-teams-ai/README.md).

---

## 1. Overview & Architecture

Google Antigravity (**AGY**) provides Google's agentic AI runtime and developer tools ecosystem:
1. **Antigravity CLI (`agy`)**: High-performance native binary (`agy.exe` on Windows / `agy` on macOS and Linux) supporting structured NDJSON turn execution, model probing, and MCP server management.
2. **Antigravity Customization Framework**: Hierarchical rule discovery (`GEMINI.md`, `AGENTS.md`, `.agents/rules/`), progressive-disclosure skills (`skills/<name>/SKILL.md`), and tool leasing.
3. **Antigravity IDE & 2.0 Platform**: Electron-based developer workbench with persistent task graphs, subagents, and MCP bridges.

In `agent-teams-ai`, the Google / Gemini provider was previously held behind [`geminiUiFreeze.ts`](file:///c:/Users/unhol/AI_Agents/agent-teams-ai/src/renderer/utils/geminiUiFreeze.ts#L6) (`GEMINI_UI_FROZEN = true`) due to legacy Gemini APIs lacking a streaming command-line execution contract. The `agy` CLI solves this by offering an identical `--input-format stream-json --output-format stream-json` standard matching Claude Code and Codex CLI.

---

## 2. Binary Resolution (`AgyBinaryResolver`)

The [`AgyBinaryResolver`](file:///c:/Users/unhol/AI_Agents/agent-teams-ai/src/main/services/team/AgyBinaryResolver.ts) is responsible for locating, caching, and validating the local `agy` executable:

- **Resolution Order**:
  1. **Explicit Environment Variable**: `AGY_CLI_PATH`
  2. **PATH Directories**: Traversed via `buildMergedCliPath()` (checking `.exe`, `.cmd`, `.bat` on Windows)
  3. **Standard OS Locations**:
     - Windows: `%LOCALAPPDATA%\agy\bin\agy.exe`, `~/.gemini/bin/agy.exe`, `~/bin/agy.exe`
     - Unix / macOS: `~/.local/bin/agy`, `~/.gemini/bin/agy`, `~/bin/agy`, `/usr/local/bin/agy`, `/opt/homebrew/bin/agy`, `/usr/bin/agy`
- **Caching**:
  - Positive and negative results are cached with a **30-second TTL**.
  - Cache can be manually purged via `AgyBinaryResolver.invalidateCache()`.

---

## 3. Stream-JSON Protocol Specification

When invoking `agy` in non-interactive print mode for one-shot runs or team orchestration:

### Command Arguments
```bash
agy --input-format stream-json --output-format stream-json --dangerously-skip-permissions --disable-slash-commands --print=
```

> [!IMPORTANT]
> **Go Flag Parser Behavior**:
> - Always attach an empty argument directly to `--print=` (or `-p=`). Omitting the equals sign causes the Go flag parser to treat the next argument (e.g., `--input-format`) as the prompt string.
> - Do not pass `--mode auto` as it triggers a warning on stdout/stderr if the active account lacks auto mode privileges (`warning: --mode auto is not available for this account; continuing in the default mode.`).

### Stdin Input Format
Prompts must be written as a single NDJSON line:
```json
{"event":"user","message":{"content":"<PROMPT_TEXT>"}}
```

### Stdout Output Events
The process emits NDJSON events:
- **`init`**: Session initialization metadata with registered tools and session IDs:
  ```json
  {"event":"init","conversation_id":"...","init":{"cwd":"...","tools":[...],"permission_mode":"always-proceed"}}
  ```
- **`step_update`**: Turn streaming updates including token usage and partial text deltas:
  ```json
  {"event":"step_update","step_update":{"step_index":1,"state":"DONE","step_type":"agent_response","text_delta":"..."}}
  ```
- **`result`**: Turn completion report:
  ```json
  {"event":"result","result":{"status":"SUCCESS","response":"...","duration_seconds":12.3}}
  ```
  `result.status === "SUCCESS"` confirms clean turn completion. Any other status or `event === "error"` indicates failure.

---

## 4. Customizations & Discovery Layers

AGY customizations are seamlessly integrated into `agent-teams-ai`:

### Skills (`skills/<name>/SKILL.md`)
- Registered in [`src/shared/utils/skillRoots.ts`](file:///c:/Users/unhol/AI_Agents/agent-teams-ai/src/shared/utils/skillRoots.ts) and [`src/main/services/extensions/skills/SkillRootsResolver.ts`](file:///c:/Users/unhol/AI_Agents/agent-teams-ai/src/main/services/extensions/skills/SkillRootsResolver.ts):
  - Project Workspace: `.agents/skills`
  - Global Config: `~/.gemini/config/skills`
  - IDE Built-ins: `~/.gemini/antigravity-ide/builtin/skills` and `~/.gemini/skills`

### Rules (`GEMINI.md` & `AGENTS.md`)
- Detected and tracked by [`src/main/services/parsing/ClaudeMdReader.ts`](file:///c:/Users/unhol/AI_Agents/agent-teams-ai/src/main/services/parsing/ClaudeMdReader.ts) and [`src/renderer/utils/claudeMdTracker.ts`](file:///c:/Users/unhol/AI_Agents/agent-teams-ai/src/renderer/utils/claudeMdTracker.ts):
  - Root Rules: `GEMINI.md`, `AGENTS.md`, `CLAUDE.md`
  - Directory Rules: `.agents/rules/*.md`, `.gemini/rules/*.md`

### Ephemeral MCP Configuration
- During one-shot prompt execution in [`src/features/external-agent-connection/main/nativeAgentRun.ts`](file:///c:/Users/unhol/AI_Agents/agent-teams-ai/src/features/external-agent-connection/main/nativeAgentRun.ts), the service automatically writes `<cwd>/.agents/mcp_config.json` targeting the app's live MCP server URL.

---

## 5. Provider Taxonomy & Model Catalog

In `agent-teams-ai`, AGY operates as the execution engine for the unified `gemini` provider:

- **Provider ID**: `'gemini'` (in `CliProviderId` and `TeamProviderId`)
- **Authority**:
  - `verificationState`: `'verified'`
  - `statusCheckOutcome`: `'authoritative'`
  - `authMethod`: `'agy_cli'`
  - `capabilities.oneShot`: `true`
  - `capabilities.teamLaunch`: `true`
- **Supported Models** (in [`src/renderer/utils/teamModelCatalog.ts`](file:///c:/Users/unhol/AI_Agents/agent-teams-ai/src/renderer/utils/teamModelCatalog.ts)):
  - `gemini-4-argon-high`, `gemini-4-argon-medium`, `gemini-4-argon-low`
  - `gemini-3.8-flash-high`, `gemini-3.8-flash-medium`, `gemini-3.8-flash-low`
  - `gemini-2.5-pro`, `gemini-2.5-flash`, `gemini-2.5-flash-lite`

---

## 6. Integration Roadmap & Phases

### Phase Comparison: Investigation Plan vs. TODO.md

The original investigation report ([`agy_support_investigation.md`](file:///c:/Users/unhol/.gemini/antigravity-ide/brain/500a53cd-01e5-4e8a-a873-ef516fffcf52/agy_support_investigation.md)) specified **4 discrete phases**, while the initial [`TODO.md`](file:///c:/Users/unhol/AI_Agents/agent-teams-ai/TODO.md) listed **3 phases**:

| Phase | Original Investigation Roadmap | Initial `TODO.md` | Resolution / Status |
| :--- | :--- | :--- | :--- |
| **Phase 1** | **Skills & Rules Linking** (register roots, `GEMINI.md`) | **Skills & Rules Discovery** | **Completed** |
| **Phase 2** | **Binary Detection & Catalog** (`AgyBinaryResolver`, unfreeze gate) | **Provider & Runtime** (combined unfreeze + one-shot prompt execution) | **Completed** |
| **Phase 3** | **Team Provisioning & Stream-JSON Runtime Adapter** (multi-agent launch in `TeamProvisioningLaunchTeamFlow.ts`) | *Omitted* (jumped directly to MCP sync) | **Completed** |
| **Phase 4** | **Bi-directional Integration & MCP Sync** (`external-agent-connection` prompt + `agy mcp` sync) | Labeled as **Phase 3: MCP Ecosystem Synchronization** | **Completed** |

### Roadmap Definition:
- **Phase 1: Skills & Rules Discovery** (Completed)
- **Phase 2: Provider Dynamic Gate & Direct One-Shot Run Support** (Completed)
- **Phase 3: Team Provisioning & Multi-Agent Team Launch Runtime Adapter** (Completed)
- **Phase 4: Bi-directional MCP Ecosystem Synchronization** (Completed)

---

## 7. Bi-directional MCP Synchronization (`AgyMcpSyncService`)

Phase 4 bridges the MCP ecosystems between `agent-teams-ai` / Claude CLI and Google Antigravity (`agy`):

1. **Config Locations**:
   - **Global AGY Root**: `~/.gemini/config/mcp_config.json` (with fallback to `~/.gemini/antigravity-ide/mcp_config.json`)
   - **Project AGY Root**: `<projectPath>/.agents/mcp_config.json`
   - **Claude App Roots**: `~/.claude.json` (`user` scope) and `<projectPath>/.mcp.json` (`project` scope)

2. **Components**:
   - [`AgyMcpConfigManager`](file:///c:/Users/unhol/AI_Agents/agent-teams-ai/src/main/services/extensions/agy/AgyMcpConfigManager.ts): Handles low-level reading, writing, atomic JSON updates, and tabular CLI output parsing (`agy mcp list`).
   - [`AgyMcpSyncService`](file:///c:/Users/unhol/AI_Agents/agent-teams-ai/src/main/services/extensions/agy/AgyMcpSyncService.ts): Provides bidirectional reconciliation (`syncAgyToApp`, `syncAppToAgy`, `syncBidirectional`), normalizing stdio (`command`, `args`, `env`) and HTTP transports (`url`, `serverUrl`, `headers`).
   - [`McpConfigStateReader`](file:///c:/Users/unhol/AI_Agents/agent-teams-ai/src/main/services/extensions/runtime/McpConfigStateReader.ts): Extended with AGY discovery support and normalized `serverUrl` resolution for mixed teams.
   - **IPC & Preload Bridge**: Exposed via `mcp:agySync` and `mcp:agyList` channels on `window.electronAPI.extensions.mcp`.

