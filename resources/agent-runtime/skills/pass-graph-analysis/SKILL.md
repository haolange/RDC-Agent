---
name: pass-graph-analysis
description: Reconstruct pass graphs from capture structure and keep observed names separate from inferred ones.
---

# Pass Graph Analysis

Use this skill to explain how passes are ordered, fed, and consumed.

1. Collect structural evidence first (event order, outputs, attachments). Do not name a pass from memory.
2. Write observed topology as `derived_structure` only when the capture supports a deterministic reconstruction (`epistemic: derived`, `verification: reconstructed`). Directly seen draws stay `observed_fact`.
3. Keep semantic labels (`semantic_inference` / `hypothesis`) on the Authoring layer. They must not become `observed_fact`.
4. Link producer and consumer resources with resolvable artifact refs.
5. For Analyzer, this is Pass Reconstruction. The reconstructed graph feeds `$analyzer-architecture-method`. Missing debug tags still require a main pass graph plus an explicit Unknown Frontier.
6. For Optimizer, do not treat the slowest pass as the root bottleneck. Pass cost is an input to Cost / Limiter / Mechanism, not a conclusion.

Do not let the model invent pass names when the graph is missing. Do not upgrade inferred labels to observed. Knowledge may supply similar-case patterns; it is not capture evidence.
