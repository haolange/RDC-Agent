---
name: debugger-causal-method
description: Write Debugger First Bad Event, Hypothesis Matrix, and Counterfactual records on existing rdc.investigation.v1 kinds.
---

# Debugger Causal Method

Use this skill during Debugger execution. Do not invent a new kind, Profile, or TaskStore. Write only `rdc.investigation.v1` Session Artifacts.

## First Bad Event

Shape: one `EvidenceRecord` (`kind: evidence`) and a companion `ClaimRecord` (`claimKind: observed_fact`).

1. Find the first proven regional symptom via same-capture target/control and prior writes, even without reference; record appearance and coverage, not assumed correctness.
2. Collect observations with `$rdc-tool-shell`, `$pixel-forensics` and `$capture-facts`. Read `$pixel-forensics` before interpreting per-fragment values or test flags: native history may be reconstructed or format-limited.
3. Persist the WorldState for the observed state before its Evidence, following `$artifact-provenance` record dependencies; raw observations may be collected first. Do not bind fresh observations to a historical WorldState merely to make the reference resolve. Then write Evidence before any companion Claim: `mission: debugger`, `epistemicStatus: observed`, `region.kind` in `{event, pixel}`, `artifactRefs` with their actual content hashes, and a resolvable `worldStateId`. Unknown fields remain honest under the schema; a draft does not assert safety or completed future observations.
4. The companion Claim may repeat the event id in `scope.eventId`. It stays `observed_fact`. It must not set `declaresCounterfactual` or a causal `experimentId`.

A prose guess is not a First Bad Event. Do not mark `ready` without provenance (`$artifact-provenance`).

## Hypothesis Matrix

Shape: one `ClaimSet` (`kind: claim_set`) of competing `hypothesis` Claims.

1. Check the plan's bounded Knowledge retrieval. If absent or over-constrained, search separate short object, symptom or domain terms; read relevant hits or record empty/failed searches. Map leads to testable features and applicability conditions matched, unknown or contradicted here; they are not current evidence. Keep distinguishable hypotheses; one suffices if evidence excludes the rest. Each is a `ClaimRecord` with `claimKind: hypothesis`, `epistemic: inferred`, `experimentId: null`, and non-empty `scope`.
2. Link rivals with `supports` / `contradicts` using resolvable `claimId`s. Keep evidence-backed, distinguishable alternative explanations visible until checked; do not invent a driver-blame hypothesis.
3. Name the smallest distinguishing check with consistent supporting and disconfirming predictions. When intervention or matching trace is unavailable, inspect each path's required bindings and parameters before deferring: an observed disabled prerequisite can exclude that path; enablement alone does not prove contribution. Matching a prediction supports, not proves; retain uncertainty if outcomes do not distinguish rows. The check becomes a Task subject, not the matrix.

Do not promote a matrix row to `causal_conclusion` here.

## Counterfactual Artifact

Shape: one qualifying `ExperimentRecord` plus a Claim that is `claimKind: causal_conclusion` and/or `declaresCounterfactual: true`.

1. Design the Experiment against a persisted matrix row (`hypothesisClaimId`). `intervention.type` must not be `none`. Resolve all required WorldState references before persisting the design, following `$artifact-provenance`; future variant/restored anchors remain explicitly unknown/unmeasured until observed. Actual baseline / variant / restored states must satisfy the exclusivity and qualification contract before they can support a qualifying Experiment. Planning anchors or resolvable IDs alone do not prove those conditions.
2. Run the intervention through the configured RDC-Tool CLI. Record metrics and visual before / after / diff.
3. Rollback must set `executed === true`, `baselineRestored === true`, and `verifyEvidenceIds.length >= 1` (each resolvable). Status must be `recorded` or `rolled_back`.
4. Only then write the causal / counterfactual Claim with that `experimentId`. A Debugger root-cause Claim also fills the seven-tuple `rootCause` (Trigger · Fault Location · Failure Mechanism · Propagation · Manifestation · Scope · Counterfactual Evidence).

`S-CAUSAL-01` and `S-RDC-01` stay machine-enforced. A Claim without a qualifying Experiment must not become `ready`. Do not persist Knowledge. Do not call `memory_write` from this skill.
