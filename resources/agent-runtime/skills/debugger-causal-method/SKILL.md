---
name: debugger-causal-method
description: Write Debugger First Bad Event, Hypothesis Matrix, and Counterfactual records on existing rdc.investigation.v1 kinds.
---

# Debugger Causal Method

Use this skill during Debugger execution. Do not invent a new kind, Profile, or TaskStore. Write only `rdc.investigation.v1` Session Artifacts.

## First Bad Event

Shape: one `EvidenceRecord` (`kind: evidence`) plus an optional companion `ClaimRecord` (`claimKind: observed_fact`).

1. Name expected result, observed result, and the earliest event or pixel region where they diverge.
2. Collect the observation through the Settings-configured RDX CLI (`$rdx-cli-shell`) and `$pixel-forensics` / `$capture-facts`.
3. Write Evidence first: `mission: debugger`, `epistemicStatus: observed`, `region.kind` in `{event, pixel}`, `contentHashes` matching artifact bytes, `worldStateId` resolvable.
4. The companion Claim may repeat the event id in `scope.eventId`. It stays `observed_fact`. It must not set `declaresCounterfactual` or a causal `experimentId`.

A prose guess is not a First Bad Event. Do not mark `ready` without provenance (`$artifact-provenance`).

## Hypothesis Matrix

Shape: one `ClaimSet` (`kind: claim_set`) of competing `hypothesis` Claims.

1. Write at least two mutually distinguishable hypotheses. Each item is a `ClaimRecord` with `claimKind: hypothesis`, `epistemic: inferred`, `experimentId: null`, and a non-empty `scope`.
2. Link rivals with `supports` / `contradicts` using resolvable `claimId`s. Keep evidence-backed, distinguishable alternative explanations visible until checked; do not invent a driver-blame hypothesis.
3. Name the smallest check that would confirm one row and reject another. That check becomes a Task subject later; do not write the matrix into `TaskRecord`.

Do not promote a matrix row to `causal_conclusion` here.

## Counterfactual Artifact

Shape: one qualifying `ExperimentRecord` plus a Claim that is `claimKind: causal_conclusion` and/or `declaresCounterfactual: true`.

1. Design the Experiment against a matrix row (`hypothesisClaimId`). `intervention.type` must not be `none`. Bind exclusive World States for baseline / variant / restored.
2. Run the intervention through the configured RDX CLI. Record metrics and visual before / after / diff.
3. Rollback must set `executed === true`, `baselineRestored === true`, and `verifyEvidenceIds.length >= 1` (each resolvable). Status must be `recorded` or `rolled_back`.
4. Only then write the causal / counterfactual Claim with that `experimentId`. A Debugger root-cause Claim also fills the seven-tuple `rootCause` (Trigger · Fault Location · Failure Mechanism · Propagation · Manifestation · Scope · Counterfactual Evidence).

`S-CAUSAL-01` and `S-RDC-01` stay machine-enforced. A Claim without a qualifying Experiment must not become `ready`. Do not persist Knowledge. Do not call `memory_write` from this skill.
