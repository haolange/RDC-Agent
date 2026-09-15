---
name: cross-capture-alignment
description: Align facts across captures on explicit scope axes without over-generalizing.
---

# Cross Capture Alignment

Use this skill when two or more captures must be compared.

1. State the shared question and the scope axes that must match (API, GPU, pass, resolution, quality).
2. Align only those axes that have evidence in both captures.
3. Write differences as scoped Claims. Keep unknowns explicit.
4. Reuse Knowledge only as retrieval; do not promote a family-wide Pattern from one GPU axis.
5. For Analyzer, this is Traceability: answer the user's target path across events / resources / passes. Aligned facts stay on their original layers. Do not invent a shared World State.
6. For Optimizer, compare only after Baseline Qualification. Timing deltas below the noise floor are not gains.

Do not collapse "this Adreno" into "all Adreno". Do not treat a historical imported-case `fixed` status as verified. Do not invent a shared World State across captures.
