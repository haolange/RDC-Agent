# Agent manifest and model selection

RDC-Agent uses app-level `.agent.md` files as the product-facing source for Agent configuration. The Settings UI reads and writes the same files, so users can configure Agents through either the GUI or Markdown.

## Manifest location

Agent manifests live under the active workspace:

`profiles/agents/*.agent.md`

Global orchestrator instructions live at:

`profiles/global-instructions.md`

## Manifest shape

Each manifest uses YAML frontmatter plus Markdown instructions:

```markdown
---
id: rdc-debugger
name: RDC Debugger
description: RenderDoc/RDC planning and intake orchestrator.
argument-hint: Describe the .rdc symptom, goal, capture, or baseline.
target: rdc-agent
model:
  - kimi-code:kimi-coding
disable-model-invocation: false
user-invocable: true
enabled: true
tools:
  - read
  - search
  - rdx
skills: []
mcpServers: []
agents:
  - triage_agent
  - capture_repro_agent
handoffs:
  - label: Start Implementation
    agent: rdc-debugger
    prompt: Start the approved RDC investigation.
    send: true
metadata:
  legacyAgentRole: rdc-debugger
---

You are the RDC Debugger orchestrator.
```

## Model ids

The GUI shows models as a provider-grouped picker. The manifest stores the selected model as a canonical id:

`<providerId>:<modelId>`

Examples:

- `kimi-code:kimi-coding`
- `deepseek:deepseek-chat`
- `google-ai-studio:gemini-2.5-pro`

If a provider or model is disabled, the picker keeps the manifest readable but marks that model unavailable. Runtime routing fails closed until the provider is connected and the model is enabled again.

## Toolchain boundary

RenderDoc tools are exposed to Agents through the local RenderDoc toolchain configured in Settings. Agents may decide to call available tools during their loop, but command execution still goes through the main-process settings boundary and fails closed when the toolchain is disabled or misconfigured.
