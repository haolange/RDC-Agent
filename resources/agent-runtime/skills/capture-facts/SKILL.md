---
name: capture-facts
description: Record observed capture facts as Evidence and World State without promoting inferences.
allowed-tools: [investigation_read, investigation_write, investigation_list, artifact_read, rdx_context, knowledge_search, knowledge_read]
---

# Capture Facts

Use this skill to write what the capture actually shows.

1. Bind facts to a resolvable `worldStateId`.
2. Write `EvidenceRecord` entries with source, parameters, and content hashes.
3. Mark epistemic `observed` only for direct tool or visual observations. Keep inferences `inferred` or `derived`.
4. Cite prior artifacts through `investigation_read` / `session://`. Do not paste raw dumps into Claims.

Do not upgrade a guess to `observed`. Do not write these fields into Tasks, Profiles, or Messages. Do not persist Knowledge from this skill. Knowledge retrieval may inform scope; semantic `unavailable` / `stale` must be reported honestly.
