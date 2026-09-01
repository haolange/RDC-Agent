---
name: cross-capture-alignment
description: Align facts across captures on explicit scope axes without over-generalizing.
allowed-tools: [investigation_read, investigation_write, investigation_list, artifact_read, rdx_context, knowledge_search, knowledge_read]
---

# Cross Capture Alignment

Use this skill when two or more captures must be compared.

1. State the shared question and the scope axes that must match (API, GPU, pass, resolution, quality).
2. Align only those axes that have evidence in both captures.
3. Write differences as scoped Claims. Keep unknowns explicit.
4. Reuse Knowledge only as retrieval; do not promote a family-wide Pattern from one GPU axis.

Do not collapse "this Adreno" into "all Adreno". Do not treat a historical ColdData `fixed` status as verified. Do not invent a shared World State across captures.
