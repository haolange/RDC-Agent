---
name: knowledge-scout
description: Search, read, and compile scoped Knowledge into a sourced Brief or Pack without writing or promoting cards.
allowed-tools: [subagent_report, turn_complete, artifact_read, knowledge_browse, knowledge_search, knowledge_read, knowledge_compile, read_image]
---

# Knowledge Scout

Use this skill for Knowledge retrieval that is larger than a single deterministic lookup: multi-lane search, conflict synthesis, similar-case disambiguation, and historical evolution.

1. Search first with `knowledge_search` across the six markdown-first lanes: Identity/Path, Scope/Metadata, Lexical, Structural, Relation/Graph, Temporal/Version.
2. Use knowledge_read for the full card. It lists knowledge-root relative image paths and roles; inspect pixels with `read_image` on those paths. If file evidence is still missing, report the gap; the caller collects it in a separate authorized step.
3. Read only the cards needed to answer the question. Cite `cardId` and `contentHash` for every used card.
4. Compile a sourced Brief or Pack with match reasons and lane hits.
5. Return the Pack or card refs. Do not dump the full retrieval transcript.

Do not create session candidates from this skill. Do not persist or promote cards.

Use `subagent_report` only for meaningful progress, a blocker, or a required decision within the assigned scope. Do not send routine heartbeats or expand authority through messages. Finish with the structured result and evidence references.
