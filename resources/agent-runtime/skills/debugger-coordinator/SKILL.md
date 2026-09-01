---
name: debugger-coordinator
description: Coordinate Debugger planning so root-cause uncertainty decreases before any execution handoff.
---

# Debugger Coordinator

Plan first. The goal is to minimize root-cause uncertainty for an incorrect result. Do not invent a second runtime, TaskStore, or InvestigationGraph.

## Planning

1. Capture the expected result, the observed result, and the reproduction condition. Ask when any of those three is missing.
2. Use only limited read, search, web, shell, interpreter, RDX context, tasks, memory, and questions.
3. Retrieve similar cases with `$knowledge-scout`. Persistent Knowledge writes stay human-confirmed. Do not create a Session Candidate unless the user asked.
4. Name the smallest distinguishing check that would confirm or reject the current cause.
5. Write a versioned plan artifact that names: suspected component, First Bad Event check, Hypothesis Matrix rows, the qualifying Experiment, Skeptic, and Report. Then durable-handoff to General (`send: true`).
6. When the plan needs a method, cite an on-demand skill. Do not preload them:
   `$capture-preflight`, `$capture-facts`, `$debugger-causal-method`, `$pass-graph-analysis`, `$shader-ir-analysis`, `$pixel-forensics`, `$artifact-provenance`, `$optimization-experiment`, `$renderdoc-execution`, `$rdx-cli-shell`, `$skeptic-review`, `$report-composition`.

Use `investigation_*` for session-owned `rdc.investigation.v1` Evidence / Claim / Experiment / Challenge / Checkpoint. Causal claims need a qualifying Experiment (`S-CAUSAL-01`). Report and compact projections must not raise Claim rank (`S-CLAIM-01`).

## Durable Handoff

Handoff is the existing `ProfileHandoffState` machine (`prepared` → `committed` → `consumed`). `send: true` auto-continues after commit. Each user root chain allows at most 3 handoffs. A process restart does not auto-fire an unconsumed handoff. Stop / Rewrite / branch / manual switch cancels the active handoff. Approvals do not inherit. Do not treat `AgentHandoffDefinition` as the durable record.

## Execution (General owns the tools)

After handoff, General expands the plan into a Task graph and collects evidence through the Settings-configured RDX CLI. First Bad Event, Hypothesis Matrix, and Counterfactual Artifact shapes live in `$debugger-causal-method`. Do not write those fields into Tasks, Profiles, or Messages. Tasks may only store a subject and a `taskRef` back from Evidence.

## Small Loop

Trigger: missing evidence, a live alternative, a confound, scope growth, unvalidated visual regression, or undersampling. Do not replan the Mission.

1. Execution writes candidate Claims.
2. Open an independent context and load `$skeptic-review`. Skeptic writes `ChallengeRecord`s; it does not rewrite the Generator narrative.
3. For each `open` Challenge, General creates one follow-up Task with `task_create`. Subject quotes `challengeId` and `requiredFollowUp`. Do not add domain fields to `TaskRecord`.
4. After the follow-up, update the Iteration Memory Artifact: a `claim_set` titled Iteration Memory whose items are the current accepted / active / rejected Claims, `sourceRefs` pointing at Evidence and Challenge artifacts, and a summary that names blockers, resolved `challengeId`s, and the delta. Supersede the previous Iteration Memory artifact.
5. Retry only the follow-up path.

Iteration Memory is a Session Artifact. `memory_write` still requires explicit user intent or approval. Do not auto-extract conversation into Memory.

## Big Loop

Trigger: wrong bug family, collapsed structural assumption, missing capability, verifier repeating the same structural gap, changed user goal, or context nearly exhausted while the plan has drifted.

1. Write a `MissionCheckpoint` (`kind: checkpoint`). Every listed `claimId` / `experimentId` / `challengeId` / `artifactId` / `currentWorldStateId` must resolve.
2. Handoff back to Debugger with `checkpointId` in the prompt (and payload when the tool allows). Consume one durable-handoff depth.
3. Debugger re-retrieves Knowledge, writes a new plan version, and hands off to General again.

If the chain would exceed depth 3, stop and ask the user. After restart, wait for a manual continue.

## Delegation Capsule

When delegating a subagent, compile a capsule in the handoff / task prompt. This is not a new platform file type. Include: identity, Mission, Task, reason, accepted facts, competing hypotheses, related Challenges, current World State, input artifact ids, relevant Knowledge refs, falsified paths, experiments not to retry, output requirements, and recoverable Evidence refs (`artifactId` + hash). Offline subagents must set `requiresRdxLease: false`.

## Bounds

Do not write, edit, git-mutate, or manage files. Do not add unregistered tool tokens. Do not weaken `S-CLAIM-01` / `S-CAUSAL-01` / `S-RDC-01`. Embedding models stay out of the Agent picker. RDX runs only through the Settings-configured CLI. Analyzer and Optimizer vertical slices are not this skill.
