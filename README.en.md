<div align="center">

<img src="docs/media/rdc-agent-hero.png" alt="RDC-Agent GPU debugging workbench" width="100%" />

# RDC-Agent

### Turn one GPU frame problem into a traceable chain of answers

RenderDoc `.rdc` capture × AI Agent workbench × native RDC diagnostics

[中文](./README.md) · [Design & architecture](./DESIGN.md) · [Issues](https://github.com/haolange/RDC-Agent/issues)

</div>

## A workbench that moves GPU questions forward

RDC-Agent is a Windows desktop application that brings everyday agent collaboration, RenderDoc capture investigation, and native RDC operations into one auditable workspace.

Start with “Why is this frame wrong?” and work through a stable chain:

1. Open a project and its `.rdc` captures while keeping capture, replay, and context identity explicit.
2. Let the agent inspect code, run commands, check RDC context, and expose the real execution process through Work Process.
3. Enter Debugger, Analyzer, or Optimizer methods when the problem calls for graphics-specific reasoning.
4. Keep observations, evidence, conclusions, and next actions in the same session instead of scattering them across terminals, screenshots, and chat logs.

## RDC-Agent is not just LLM + Skill + Tool

Many visible RenderDoc agent integrations still stop at a familiar shape: wrap Replay API operations as MCP tools, add a Skill, and let the LLM choose tool calls. That answers “can the model call RenderDoc?” It does not, by itself, answer “is the investigation stable, sufficiently evidenced, and trustworthy?”

RDC-Agent treats the investigation loop—not an individual tool call—as the product primitive:

```text
Problem
  ↓
Hypothesis
  ↓
Inspection
  ↓
Experiment
  ↓
Evidence
  ↓
Conclusion
```

Four systems keep that loop grounded:

- **Tasks system** tracks what must be verified next, which evidence gaps remain, and what is required before an investigation can close.
- **Context in app** keeps the current capture / replay / context, tasks, Artifacts, Outputs, Context, and Capture visible in one session instead of relying on model memory alone.
- **Investigation schema** stores World State, Evidence, Claim, Experiment, Challenge, Checkpoint, and Report as referenceable session artifacts with explicit epistemic and verification boundaries.
- **Knowledge Engine** connects six markdown-first retrieval lanes—Identity / Path, Scope / Metadata, Lexical, Structural, Relation / Graph, and Temporal / Version—without replacing evidence with an opaque embedding score.

The goal is not simply to expose more GPU buttons. It is to make the agent know which object is under investigation, what is observed, which hypotheses compete, how an experiment can be rolled back, and which conclusions are still only inferences.

That is also why several boundaries are intentional: MCP is not RDC-Agent's runtime authority; the programmable RDC-Tool CLI / JSON contract is the operation surface shared by agents, scripts, tests, and people. Remote / Android replay is an explicit runtime capability—local PNG success must not silently become a claim of remote success. Tools are discovered, described, and scoped from a catalog instead of dumping an ungoverned full table into every model turn. Fewer tools with complete facts, explicit identity, and honest failure are more valuable than a larger button count.

## One investigation, two reading surfaces

The result should not be only a chat answer. The same source-backed investigation can be projected into two reading surfaces:

- **Developer Report (Markdown)** for graphics programmers, TAs, engine and performance engineers: goal, inputs, environment, plan, task timeline, evidence, claims, experiments, challenges, limitations, and artifact index.
- **Executive Visual Report (generative UI / canvas)** for QA, artists, designers, producers, and other collaborators: explain what happened, who is affected, and what to do next through diagrams, Before / After / Diff views, region annotations, and credibility markers.

The visual report is a presentation layer, not a second conclusion engine. Important statements still point back to referenceable Claims, Evidence, and verification state, so readability never outruns trustworthiness.

![RDC-Agent workbench preview](docs/media/rdc-agent-workbench-preview.png)

> This is a public showcase preview based on the real in-app Browser QA `/app` workbench layout. Project names, capture names, conversation history, and model information have been replaced with neutral placeholders. It shows product structure, not fabricated runtime results.

## Three focused ways to investigate

- **Debugger** traces a visual symptom back to events, resources, pipeline state, and shaders.
- **Analyzer** connects clues across captures, events, and evidence into material that can be reviewed later.
- **Optimizer** compares cost and benefit through real, reversible interventions.

These are not three isolated chat personas. They share the same agent loop, project resource boundaries, permission model, and session evidence chain. General handles ordinary engineering work; RenderDoc investigations are handed off to the appropriate method surface when needed.

## What is real, and where the boundary is

- Capture management, diagnostics, and RDC / RenderDoc operations are driven by the external RDC-Tool CLI configured on the host.
- Agent work includes reading, planning, editing, searching, shell commands, tool calls, handoffs, memory, and subagent orchestration.
- User resources live under `~/.rdc-agent`; project resources live under `<project-root>/.rdc-agent`.
- Work Process reflects actual execution and provider reasoning semantics. It does not fabricate hidden chain-of-thought or treat model self-report as evidence.
- Local replay and Android presentation depend on the installed RDC / RenderDoc environment and the target GPU. A connected device is not a promise that every capture replays everywhere.

The release surface is **Windows-only**. RDC-Agent does not bundle your captures, provider keys, or RenderDoc installation. Configure the RDC-Tool CLI, provider / model, and device environment yourself.

## Download and first use

Windows releases provide an NSIS installer (`*-setup.exe`) and a portable zip. Extract the whole zip before running `RdcAgent.exe`; Node.js and pnpm are only needed for source development. The **0.6.0-rc.1 prerelease is unsigned**: Windows may warn about an unknown publisher or block execution under managed security policies. Download only from this repository's [Releases](https://github.com/haolange/RDC-Agent/releases) and verify SHA-256; do not disable security protections. Stable releases still require signing.

The four-step guide appears on first launch and can be reopened from the titlebar question mark. Configure your own provider/API key and model in Settings, then create a Project and import a capture. Official Agents, Skills and Hooks are bundled under `resources/agent-runtime` and are not copied into user space.

Download the independent [RDC-Tool release](https://github.com/haolange/RDC-Tool/releases), extract it, then use Settings → Tools → Detect installation / Select folder → Verify and apply. Select the `rdc-tool` root containing its bundled Python and CLI, not the Python executable. Detection checks the configured location and `%LOCALAPPDATA%/Programs/rdc-tool`; installing into PATH is optional. General use can start without RDC. Code Interpreter remains a separate environment.

## Source development

Requirements: Windows, Node.js `>=22.13.0`, pnpm `11.7.0`, and an RDC-Tool CLI that can be configured from Settings.

```powershell
pnpm install
pnpm run dev
```

For the real in-app Browser QA surface:

```powershell
pnpm run start:agent-browser
```

Useful verification commands:

```powershell
pnpm run typecheck
pnpm test
pnpm run check:gates
pnpm run build
```

Read the [design and architecture guide](./DESIGN.md) for the product boundary, the [RDC runtime contract](./docs/architecture/rdc-runtime.md) for native operations, and the [acceptance ledger](./docs/product/acceptance-ledger.md) for evidence and unverified boundaries.

This repository is evolving quickly. Please report reproducible problems with the smallest safe reproduction you can share. Never upload private `.rdc` captures, provider keys, user data, or logs containing sensitive paths.

## License

See [LICENSE](./LICENSE).

## RenderDoc runtime baseline

The current assembled and verified baseline is **RenderDoc 1.45**. RDC-Tool does not track every upstream minor release: a newer runtime becomes the baseline only after matching runtime packaging, catalog checks, tests and release gates pass. RenderDoc 1.44 and earlier official GUI releases are not separate assembly targets. Use the replay path matching this bundled runtime. Capture-format compatibility follows upstream RenderDoc.

RDC-Agent **0.6.x** pairs with RDC-Tool **1.0.0** and the current RenderDoc **1.45** runtime. Catalog definitions and fingerprints, not package version numbers, authorize operations. Local PNG export does not prove Android device presentation.

## Reporting safely

Do not upload private captures, provider keys or full logs containing local absolute paths. Redact logs and use the installation or bug-report template.
