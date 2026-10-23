---
name: shader-ir-analysis
description: Analyze shader source or IR from hashed artifacts without promoting derived notes to observed facts.
---

# Shader IR Analysis

Use this skill for HLSL, SPIR-V, or other shader IR inspection.

1. Read the shader or IR through `artifact_read` / `read_file` and record a content hash.
2. Anchor findings to stable ids or source ranges. Keep large diffs external; do not inline them into Claim text.

Numeric IDs belong to the representation that defines them. An assembler may legally renumber source IDs. A SPIR-V header's `id_bound` concerns IDs in the assembled module, not the maximum numeric ID in the source text; a source-ID threshold requires an actually established preservation contract or mapping. A source comment is not a binary header, and a valid header alone is not full instruction or semantic validation. Keep exact submitted build-input bytes and target-resource provenance separate from native shader readback or device code; preserve unavailable mapping and validation as unknown rather than inventing either success or failure.

3. Write `derived` notes for IR reconstruction and `inferred` notes for semantic meaning.
4. Bind conclusions to the current World State. After a mutate, old shader evidence is stale.
5. For Analyzer Fingerprint / Block: L0 Exact Binary and L1 Normalized IR are Reconstructed (`derived_structure`). L2 Dataflow / CFG stays Reconstructed. L3 Semantic Block and L4 Engine / Material Hypothesis are Authoring (`semantic_inference` or `hypothesis`). Do not mark reconstructed IR as `observed`.
6. These records feed `$analyzer-architecture-method`. Cluster frequent shaders by hash / normalized IR, not by guessed material names.

Do not claim `observed` for reconstructed IR. Do not treat a source `fixed` Knowledge card as verified. Do not persist Knowledge from this skill.
