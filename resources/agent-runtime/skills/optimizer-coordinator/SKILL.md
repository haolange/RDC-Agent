---
name: optimizer-coordinator
description: Coordinate Optimizer planning so cost drops only under explicit correctness and quality constraints.
---

# Optimizer Coordinator

Plan first. The goal is to minimize cost while preserving correctness, quality, and scope. Do not invent a second runtime, TaskStore, or InvestigationGraph.

## Planning

1. Name the cost, the constraint that must not regress, and the measurement that proves a gain. Ask when any of those three is missing.
2. Stay plan-only: use only read/search/web, `ask_user`, handoff, tasks (no `output_register`), `plan_artifact`, `investigation_*`, `knowledge_*` (no persist), memory read, `rdx_context`, and `rdx_probe`. Do not use shell or the code interpreter. General executes Live RDC mutate via shell after handoff.
3. Retrieve similar cases with `$knowledge-scout`. Persistent Knowledge writes stay human-confirmed. Do not create a Session Candidate unless the user asked.
4. Order interventions from highest expected gain and lowest correctness risk. Do not call the slowest pass the root bottleneck.
5. Write a versioned plan artifact that names: Baseline Qualification + Noise Floor, Frame Breakdown, Cost / Limiter / Mechanism, transactional Experiment class (Ablation / Equivalent / Trade-off), Replay Benchmark (A-B-A), Visual / Numerical Regression, Skeptic, and Report. Then durable-handoff to General (`send: true`).
6. When the plan needs a method, cite an on-demand skill. Do not preload them:
   `$capture-preflight`, `$capture-facts`, `$optimization-experiment`, `$cross-capture-alignment`, `$artifact-provenance`, `$renderdoc-execution`, `$skeptic-review`, `$report-composition`. Live RDC CLI stays on General via `$rdx-cli-shell`.

Use `investigation_*` for Experiments that include a real intervention and rollback. `intervention.type == none` is not a counterfactual (`S-CAUSAL-01`). An Optimizer mutate cannot close without rollback verify (`S-RDC-01`).

## Durable Handoff

Handoff is the existing `ProfileHandoffState` machine (`prepared` → `committed` → `consumed`). `send: true` auto-continues after commit. Each user root chain allows at most 3 handoffs. A process restart does not auto-fire an unconsumed handoff. Stop / Rewrite / branch / manual switch cancels the active handoff. Approvals do not inherit. Do not treat `AgentHandoffDefinition` as the durable record.

## Execution (General owns the tools)

After handoff, General expands the plan into a Task graph and collects evidence through the Settings-configured RDX CLI. Execute in order: Baseline Qualification + Noise Floor → Frame Breakdown → Cost / Limiter / Mechanism → transactional Experiment → Replay Benchmark (A-B-A) → Visual / Numerical Regression → Optimization Report. Experiment record shapes live in `$optimization-experiment`. Do not write those fields into Tasks, Profiles, or Messages.

## Experiment classes

- Ablation — isolate a cost; never ship as the optimization.
- Equivalent — semantics-preserving change under the named constraint.
- Trade-off — explicit quality or scope concession; record the concession in the Claim.

Every closed Experiment (`status` `recorded` or `rolled_back`) must have `intervention.type != none`, exclusive World States, `rollback.executed === true`, `rollback.baselineRestored === true`, and at least one resolvable verify Evidence id.

## Small Loop

Trigger: noise above threshold, missing visual check, a live alternative limiter, or undersampling. Do not replan the Mission.

1. Execution writes candidate Claims and Experiments.
2. Open an independent context and load `$skeptic-review`. Skeptic writes `ChallengeRecord`s.
3. For each `open` Challenge, General creates one follow-up Task with `task_create`. Subject quotes `challengeId` and `requiredFollowUp`.
4. Update the Iteration Memory `claim_set` and supersede the previous one.
5. Retry only the follow-up path.

## Big Loop

Trigger: wrong cost family, collapsed limiter assumption, missing capability, verifier repeating the same structural gap, changed user goal, or context nearly exhausted while the plan has drifted.

1. Write a resolvable `MissionCheckpoint`.
2. Handoff back to Optimizer with `checkpointId`. Consume one durable-handoff depth.
3. Optimizer re-retrieves Knowledge, writes a new plan version, and hands off to General again.

If the chain would exceed depth 3, stop and ask the user. After restart, wait for a manual continue.

## Delegation Capsule

When delegating a subagent, compile a capsule in the handoff / task prompt. Include: identity, Mission, Task, reason, accepted facts, competing hypotheses, related Challenges, current World State, input artifact ids, relevant Knowledge refs, falsified paths, experiments not to retry, output requirements, and recoverable Evidence refs. Offline subagents must set `requiresRdxLease: false`.

## Bounds

Do not write, edit, git-mutate, or manage files. Do not use shell or the code interpreter. Do not add unregistered tool tokens. Do not weaken `S-CLAIM-01` / `S-CAUSAL-01` / `S-RDC-01`. Embedding models stay out of the Agent picker. Mission uses `rdx_context` + `rdx_probe` only; General executes Live RDC mutate via the Settings-configured CLI after handoff. Debugger and Analyzer vertical slices are not this skill.
