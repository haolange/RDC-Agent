---
name: capture-facts
description: Record observed capture facts as Evidence and World State without promoting inferences.
allowed-tools: [investigation_read, investigation_write, investigation_list, artifact_read, rdx_context, knowledge_search, knowledge_read, shell, task_create, subagent]
---

# Capture Facts

Use this skill to write what the capture actually shows.

1. Bind facts to a resolvable `worldStateId`.
2. Write `EvidenceRecord` entries with source, parameters, and content hashes.
3. Mark epistemic `observed` only for direct tool or visual observations. Keep inferences `inferred` or `derived`.
4. For Debugger, the First Bad Event is an `observed` Evidence (and optional `observed_fact` Claim) naming the earliest diverging event or pixel. It is not a Hypothesis Matrix row and not a Counterfactual.
5. For Analyzer, Observed-layer Claims stay `claimKind: observed_fact` with `epistemic: observed` and `verification: observed`. They feed `$analyzer-architecture-method`. Do not name Engine / Material / RenderGraph here.
6. For Optimizer, record baseline timing, present, and environment facts before any mutate. Qualify the baseline and the noise floor before Frame Breakdown.
7. Cite prior artifacts through `investigation_read` / `session://`. Do not paste raw dumps into Claims.

Do not upgrade a guess to `observed`. Do not write these fields into Tasks, Profiles, or Messages. Do not persist Knowledge from this skill. Knowledge retrieval may inform scope; semantic `unavailable` / `stale` must be reported honestly.
