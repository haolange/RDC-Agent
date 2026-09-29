---
name: report-composition
description: Compose an Investigation report as a View that must not raise Claim rank or rewrite measured facts.
---

# Report Composition

A report is a View over Investigation State, not a new source of truth. `View` describes its role; the Investigation kind is `report`, never `view`. It is bound by `S-CLAIM-01` and the `report-contract` hook.

1. Read the report schema once and the relevant Claims, Evidence, Experiments, and Challenges already identified in this cycle. Do not invent replacements or repeatedly list/read an unchanged set of records.
2. Project statements with non-empty `compactProvenance`. Source `claimId`, `epistemic`, and `verification` must match verbatim.
3. Epistemic rank of each projected statement must be `<= min(source ranks)`.
4. Visual edits may change Layout, Typography, Diagram, or Narrative only.
5. Use `investigation_write` with `kind=report` for the Report. Write `InvestigationReport.reportContract` with all required chapters when publishing a ready Report. The hook and turn completion gate refuse a ready report that omits them:
   - `conclusion`
   - `evidence`
   - `verification`
   - `limitations`
   - `status` (exactly `verified` / `conclusive` / `complete`, case-insensitive; any other token cannot complete)
   - `links` (narrative Artifact links)
   - `artifactIds` (non-empty Artifact links)
   - `candidateStatus` (`none` / `session-created` / `not-requested`)

   Canonical `outputPhase=final_answer` must cite the ready report `artifactId` and `contentHash`. Hook text, model prose, or `output_register` alone cannot complete a Mission.

When the investigation is partial, inconclusive, or blocked, keep the report `draft` and state the exact missing verification. A draft can describe the known facts and limits without manufacturing a causal Claim or a completed experiment. Declare `turn_complete` as `partial` or `blocked`, never `completed`. If a write fails, inspect that error and the relevant schema; do not restart the same unchanged read/list sequence until the turn limit is exhausted.

Generic sections stay Goal, Input, Environment, Capability, Plan, Task Timeline, Evidence, Claims, Experiments, Challenges, Limitations, Artifact Index. Mention a Session Candidate only if this turn created one.

## Debugger extras

When `mission: debugger`, project these through existing Claims / Evidence / Experiment ids. Do not add report-only fields or new kinds.

- Symptom — expected vs observed, reproduction
- First Bad Event — the `observed_fact` / Evidence written by `$debugger-causal-method`
- Root Cause — the seven-tuple on the accepted causal Claim
- Counterfactual — the qualifying Experiment plus the counterfactual Claim
- Fix — only if a patch was applied and the restored result was verified; otherwise say it was not executed

## Analyzer extras

When `mission: analyzer`, project these through existing Claims. Keep Observed / Reconstructed / Authoring on their source `claimKind`. Do not raise a layer in the report.

- Observed Model
- Resource Versioning
- Pass Reconstruction
- Shader Fingerprint / Block
- Traceability
- Architecture Model version (superseded vs current)
- Unknown Frontier

## Optimizer extras

When `mission: optimizer`, project these through existing Claims / Experiments.

- Baseline + Noise Floor
- Frame Breakdown
- Cost / Limiter / Mechanism
- Experiment class (Ablation / Equivalent / Trade-off) and A-B-A result
- Visual / Numerical Regression
- Constraint that must not regress

Do not change numbers, Scope, Verification, or Conclusion. Do not create Knowledge Candidates unless the user explicitly asked. Do not treat compact or report text as a higher-certainty Claim.
