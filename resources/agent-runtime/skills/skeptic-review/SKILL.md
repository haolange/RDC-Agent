---
name: skeptic-review
description: Challenge Claims from Evidence, Experiments, negatives, and unknowns. Do not rewrite the Generator narrative.
allowed-tools: [subagent_report, turn_complete, artifact_read, investigation_schema, investigation_read, investigation_write, investigation_list, knowledge_browse, knowledge_search, knowledge_read, knowledge_compile]
---

# Skeptic Review

Use this skill in an independent context after a Generator has written Claims. Do not inherit the Generator's long narrative, Task list, or live RDC lease.

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

1. Read the cited Claims, Evidence, and Experiments, including the dependencies the runtime granted with them.
2. Ask whether each Claim is supported, scoped, and (if causal or counterfactual) backed by a qualifying Experiment (`S-CAUSAL-01`).
3. Write one Challenge per gap. `requiredFollowUp` must be a concrete check (event, pixel region, intervention, or missing artifact), not a new narrative.
4. Leave accepted Claims untouched. Request more evidence instead of inventing a replacement cause.
5. Confirmation bias is a defect: keep alternatives and unknowns visible.

For a claimed direct resource-value edge, inspect the granted usage history across the producer-to-consumer interval and the relevant version or subresource, not just matching endpoint bindings. Check for intervening writes and incomplete, truncated, null or binding-only observations. A write does not by itself prove a complete overwrite; an unexamined interval does not prove unchanged content. Challenge an unsupported direct edge or request the specific missing history/grant, while retaining any narrower binding or ordering facts the evidence supports.

For `rd.resource.get_usage`, distinguish the requested resource to which the usage classification applies from the event's output attachments. Different output attachments do not negate a recorded read of the requested resource, and that recorded read alone does not prove a particular pixel's value or an uninterrupted value dependency.

`ChallengeRecord` is the `record` body, not the entire `investigation_write` envelope. For a `ready` Challenge, supply non-empty envelope `sourceRefs: [{ artifactId, expectedHash }]` from the granted Investigation artifacts actually read. `investigation_read` returns the manifest artifactId and exact contentHash; `investigation_list` returns the same identity/hash within the granted scope. A `targetRef`, `worldStateId`, or content URI alone does not supply manifest provenance. Keep the artifact readiness (`status: ready`) separate from the open review issue (`record.status: open`). Do not copy a native tool-output hash or guess a source hash. Granted content that is readable but whose metadata has not yet been read is a remaining retrieval step, not missing external input; reserve the metadata read before writing. If access is denied or the remaining budget cannot cover it, return Partial with the exact failed or unperformed step, without resetting the review budget.

If the supplied budget cannot cover the granted reads, the intended writes and `turn_complete`, report the exact missing step as partial/blocked; an unwritten Challenge is not the same as no warranted challenge. Prefer the exact supplied content URIs and hashes over broad searches.

## Small Loop handoff to General

A complete review may return an open Challenge: reviewing the evidence is distinct from accepting a claim or closing its record. Return coverage, findings and limitations after the assigned review is complete. Do not make parent-record updates a prerequisite of your review result, and do not supersede a read-granted parent record. General owns that update and its Task settlement remains subject to the normal execution owner. If the frozen assignment explicitly requires an unauthorized write, identify it before proceeding so the parent can use the existing plan revision path; do not silently drop the requirement.

Use the existing `investigation_read` / `investigation_list` metadata to check artifact identity, readiness, content hash and `supersedes`. The relation does not grant access to its target. Return a specific missing grant when needed; do not request an invented graph field or a new scientific experiment just to confirm a record update. For genuinely new observations, review their changed scope and dependencies instead of repeating unaffected work.

Whole-file byte/diff audit proves edit coverage, not semantic comprehension. Reuse an actually read, hash-bound baseline where applicable, inspect the complete current diff and necessary dependent source; require complete semantic coverage for global claims. Neither a stored full file nor a successful analysis dispatch proves a model read it. Check the actual supplied image bytes/region and conditions before fine-detail judgments; use granted original images or native regional observations if needed. Preserve explicit candidate-bound user feedback without replacing technical checks or adding a stricter appearance target.

For substantive multi-step quantitative claims, check the actual inputs, units, assumptions and calculation method. Use an authorized deterministic calculation when available, or review a granted calculation with its real inputs and execution output. Mental arithmetic or agreement with the Generator alone does not establish exact statistical intervals, significance or performance gains. If the required calculation cannot be checked within this read-only scope, qualify that precision and return the specific calculation and source needed for General to obtain under existing permissions; retain independently supported qualitative findings.

Skeptic does not call `task_create`. After Challenges are written, General (via `$renderdoc-execution`) creates one Task per `open` Challenge. The Task subject quotes `challengeId` and `requiredFollowUp`. Domain fields stay on the Challenge, not on `TaskRecord`.

General evaluates follow-up evidence and updates its own Challenge/Checkpoint records with resolutionClaimId, or writes a new version through the owning investigation. An independent reviewer creates new Challenge outputs and does not replace parent records. Do not call `memory_write` unless the user asked.

## Bounds

Do not raise or lower Claim rank. Do not persist Knowledge. Do not treat this skill as report writing. Do not mark a causal Claim `ready` without a qualifying Experiment. A Checkpoint listed `openChallenges` id must resolve to a record written here.

Use `subagent_report` only for meaningful progress, a blocker, or a required decision within the assigned scope. Do not send routine heartbeats or expand authority through messages. Finish with the structured result and evidence references.
