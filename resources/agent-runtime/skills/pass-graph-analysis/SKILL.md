---
name: pass-graph-analysis
description: Reconstruct pass graphs from capture structure and keep observed names separate from inferred ones.
allowed-tools: [investigation_read, investigation_write, investigation_list, artifact_read, rdx_context, knowledge_search, knowledge_read]
---

# Pass Graph Analysis

Use this skill to explain how passes are ordered, fed, and consumed.

1. Collect structural evidence first (event order, outputs, attachments). Do not name a pass from memory.
2. Write observed topology as `derived_structure` or `observed_fact` only when the capture supports it.
3. Keep semantic labels (`inferred`) separate from graph facts.
4. Link producer and consumer resources with resolvable artifact refs.

Do not let the model invent pass names when the graph is missing. Do not treat the slowest pass as the root bottleneck. Do not upgrade inferred labels to observed. Knowledge may supply similar-case patterns; it is not capture evidence.
