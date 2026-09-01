---
name: shader-ir-analysis
description: Analyze shader source or IR from hashed artifacts without promoting derived notes to observed facts.
allowed-tools: [investigation_read, investigation_write, investigation_list, artifact_read, read_file, knowledge_search, knowledge_read, shell, task_create, subagent]
---

# Shader IR Analysis

Use this skill for HLSL, SPIR-V, or other shader IR inspection.

1. Read the shader or IR through `artifact_read` / `read_file` and record a content hash.
2. Anchor findings to stable ids or source ranges. Keep large diffs external; do not inline them into Claim text.
3. Write `derived` notes for IR reconstruction and `inferred` notes for semantic meaning.
4. Bind conclusions to the current World State. After a mutate, old shader evidence is stale.
5. For Analyzer Fingerprint / Block: L0 Exact Binary and L1 Normalized IR are Reconstructed (`derived_structure`). L2 Dataflow / CFG stays Reconstructed. L3 Semantic Block and L4 Engine / Material Hypothesis are Authoring (`semantic_inference` or `hypothesis`). Do not mark reconstructed IR as `observed`.
6. These records feed `$analyzer-architecture-method`. Cluster frequent shaders by hash / normalized IR, not by guessed material names.

Do not claim `observed` for reconstructed IR. Do not treat a source `fixed` Knowledge card as verified. Do not persist Knowledge from this skill.
