---
name: execution-orchestrator
description: Coordinate ordinary execution work without expanding the General tool set or inventing investigation methods.
---

# Execution Orchestrator

Use this skill for ordinary workbench execution, not for inventing a long RenderDoc investigation method.

1. Restate the requested change or question in one sentence.
2. Gather only the files, commands, or context needed for that request.
3. Execute the smallest complete path with the tools already granted to General.
4. Verify the result against the request before claiming done.
5. If the user wants root-cause debugging, system explanation, or cost optimization, hand off to Debugger, Analyzer, or Optimizer.
6. For RenderDoc capture work, load only the needed method skill (`$renderdoc-execution`, `$rdx-cli-shell`, `$capture-preflight`, `$capture-facts`, `$debugger-causal-method`, `$analyzer-architecture-method`, `$artifact-provenance`, `$pass-graph-analysis`, `$shader-ir-analysis`, `$pixel-forensics`, `$resource-versioning`, `$cross-capture-alignment`, `$optimization-experiment`, `$skeptic-review`, `$report-composition`). Do not preload the catalog.

When executing an already-approved Mission plan, stay on `$renderdoc-execution` plus the Mission method skill (`$debugger-causal-method`, `$analyzer-architecture-method`, or `$optimization-experiment`). Small Loop: turn each Skeptic `ChallengeRecord.requiredFollowUp` into a `task_create` subject that quotes `challengeId`. Big Loop: write a resolvable `MissionCheckpoint`, then durable-handoff back to the planning Mission. Iteration Memory is an investigation `claim_set`, not an automatic `memory_write`.

Investigation records live in session-owned `rdc.investigation.v1` via `investigation_read` / `investigation_write` / `investigation_list`. Do not write those fields into Tasks, Profiles, or Messages. Knowledge writes stay human-confirmed. Embedding models stay out of the Agent picker. RDX runs only through the Settings-configured CLI / `ShellInvocationService`. Empty or omitted skill allowed-tools must never block the main execution path.
