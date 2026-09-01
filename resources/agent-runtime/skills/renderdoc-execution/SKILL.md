---
name: renderdoc-execution
description: Execute approved RenderDoc investigation work with existing tools and session-owned artifacts.
allowed-tools: [investigation_read, investigation_write, investigation_list, artifact_read, rdx_context, shell, task_create, task_update, task_get, task_list, subagent, knowledge_browse, knowledge_search, knowledge_read]
---

# RenderDoc Execution

Use this skill after a Mission plan is handed to General. Execute the planned capture work. Do not invent a new investigation runtime.

1. Restate the planned check in one sentence.
2. Load only the method skill required for that check (`$debugger-causal-method`, `$analyzer-architecture-method`, `$capture-facts`, `$pass-graph-analysis`, `$shader-ir-analysis`, `$pixel-forensics`, `$resource-versioning`, `$cross-capture-alignment`, `$optimization-experiment`, `$artifact-provenance`, `$skeptic-review`, `$report-composition`, `$rdx-cli-shell`).
3. For a Debugger plan, execute in order: First Bad Event → Hypothesis Matrix → Evidence → qualifying Experiment / Counterfactual → independent `$skeptic-review` → Report. Use `$debugger-causal-method` for the three Debugger record shapes.
4. For an Analyzer plan, execute in order: Capture Facts → Resource Versioning → Pass Reconstruction → Shader Fingerprint/Block → Traceability → incremental Architecture Model → independent `$skeptic-review` → Report. Use `$analyzer-architecture-method` for Architecture Model versions. `claimKind` must not cross Observed / Reconstructed / Authoring.
5. For an Optimizer plan, execute in order: Baseline Qualification + Noise Floor → Frame Breakdown → Cost/Limiter/Mechanism → transactional Experiment → Replay Benchmark (A-B-A) → Visual/Numerical Regression → independent `$skeptic-review` → Optimization Report. Use `$optimization-experiment`. A mutate cannot close without rollback. `intervention.type == none` is not a counterfactual.
6. Write Evidence / Claim / Experiment / Challenge / Checkpoint only through `investigation_*` into `rdc.investigation.v1` Session Artifacts.
7. Cite artifacts with `session://` or `investigation_read`. Mark `ready` only when provenance holds.
8. Verify the planned result before claiming done.

## Small Loop glue

When `$skeptic-review` leaves `open` Challenges, create one Task per Challenge with `task_create`. Subject quotes `challengeId` and `requiredFollowUp`. After the follow-up, update or supersede the Iteration Memory `claim_set`. Do not write Challenge fields onto `TaskRecord`. Do not call `memory_write` unless the user asked.

## Big Loop glue

When Small Loop cannot close the gap, write a `MissionCheckpoint` whose listed ids all resolve, then durable-handoff back to the planning Mission (Debugger / Analyzer / Optimizer) with `checkpointId` in the prompt. Consume one handoff depth (limit 3). Restart does not auto-fire.

## Delegation Capsule

Subagent prompts must compile identity, Mission, Task, reason, accepted facts, competing hypotheses, related Challenges, World State, input artifacts, Knowledge refs, falsified paths, experiments not to retry, outputs, and recoverable Evidence refs. Offline subagents: `requiresRdxLease: false`.

Do not write investigation fields into Tasks, Profiles, or Messages. Do not hardcode RenderDoc/RDX CLI paths; use the Settings-configured RDX shell action. Persistent Knowledge writes stay human-confirmed. Embedding models stay out of the Agent picker. Causal claims need a qualifying Experiment (`S-CAUSAL-01`). Report and compact projections must not raise Claim rank (`S-CLAIM-01`). Analyzer `claimKind` must not cross Observed / Reconstructed / Authoring. Method skills that declare `allowed-tools` must keep `subagent`, `task_create`, and `shell` so `allowedTools = ∩(skill_i)` still closes the loop.
