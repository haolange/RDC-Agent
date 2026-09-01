---
name: report-composition
description: Compose an Investigation report as a View that must not raise Claim rank or rewrite measured facts.
allowed-tools: [investigation_read, investigation_write, investigation_list, artifact_read]
---

# Report Composition

A report is a View over Investigation State, not a new source of truth. It is bound by `S-CLAIM-01`.

1. Read accepted Claims, Evidence, Experiments, and Challenges. Do not invent replacements.
2. Project statements with non-empty `compactProvenance`. Source `claimId`, `epistemic`, and `verification` must match verbatim.
3. Epistemic rank of each projected statement must be `<= min(source ranks)`.
4. Visual edits may change Layout, Typography, Diagram, or Narrative only.

Do not change numbers, Scope, Verification, or Conclusion. Do not create Knowledge Candidates unless the user explicitly asked. Do not treat compact or report text as a higher-certainty Claim.
