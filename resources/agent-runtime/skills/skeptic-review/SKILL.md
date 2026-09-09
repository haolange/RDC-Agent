---
name: skeptic-review
description: Challenge Claims from Evidence, Experiments, negatives, and unknowns. Do not rewrite the Generator narrative.
---

# Skeptic Review

Use this skill in an independent context after a Generator has written Claims. Do not inherit the Generator's long narrative, Task list, or live RDX lease.

Input: Claim, Evidence, Experiment, Negative, Alternative, Scope, Unknown.

Output: `ChallengeRecord` entries (`kind: challenge`). Do not rewrite the Generator's story and do not create Tasks here.

## ChallengeRecord shape

```text
challengeId          stable id
targetRef            { type: claim | evidence | experiment, id }  — id must resolve
challengeKind        contradiction | missing_evidence | alternative | scope | unknown | methodology
statement            the gap, conflict, or illegal upgrade
requiredFollowUp     the single distinguishing check General should turn into a Task
status               open | resolved | wont_fix
resolutionClaimId    required when status == resolved; must resolve to a ClaimRecord
```

1. Read the cited Claims, Evidence, and Experiments. Prefer negatives and contradictions from Knowledge.
2. Ask whether each Claim is supported, scoped, and (if causal or counterfactual) backed by a qualifying Experiment (`S-CAUSAL-01`).
3. Write one Challenge per gap. `requiredFollowUp` must be a concrete check (event, pixel region, intervention, or missing artifact), not a new narrative.
4. Leave accepted Claims untouched. Request more evidence instead of inventing a replacement cause.
5. Confirmation bias is a defect: keep alternatives and unknowns visible.

## Small Loop handoff to General

Skeptic does not call `task_create`. After Challenges are written, General (via `$renderdoc-execution`) creates one Task per `open` Challenge. The Task subject quotes `challengeId` and `requiredFollowUp`. Domain fields stay on the Challenge, not on `TaskRecord`.

When a follow-up Claim resolves a Challenge, set `status: resolved` and `resolutionClaimId`. Then General increments the Iteration Memory Artifact. Do not call `memory_write` unless the user asked.

## Bounds

Do not raise or lower Claim rank. Do not persist Knowledge. Do not treat this skill as report writing. Do not mark a causal Claim `ready` without a qualifying Experiment. A Checkpoint listed `openChallenges` id must resolve to a record written here. `allowed-tools` keeps `subagent`, `task_create`, and `shell` so a shared turn with `$renderdoc-execution` does not shrink the Debugger closed loop; this skill still does not call `task_create`.
