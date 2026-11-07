---
name: knowledge-scout
description: Search, read, and compile scoped Knowledge into a sourced Brief or Pack without writing or promoting cards.
allowed-tools: [subagent_report, turn_complete, artifact_read, knowledge_browse, knowledge_search, knowledge_read, knowledge_compile, read_image]
---

# Knowledge Scout

Use this skill for Knowledge retrieval that is larger than a single deterministic lookup: multi-lane search, conflict synthesis, similar-case disambiguation, and historical evolution.

1. Search first with `knowledge_search` across the six markdown-first lanes: Identity/Path, Scope/Metadata, Lexical, Structural, Relation/Graph, Temporal/Version.
2. Read the versioned preview or relevant sections first and the full card when needed. For `knowledge_read`, an unversioned first read must use `mode: summary`; section, range and full require the current `contentHash` from search or summary. Use the returned headings and line count to select source ranges. If the version changed, search or read the summary again. Follow pagination with the returned index revision. Declared images include scoped `read_image` arguments; pixels remain unobserved until that call succeeds.
3. Read only the cards needed to answer the question. Cite `cardId` and `contentHash` for every used card.
4. Compile a sourced Brief or Pack with match reasons and lane hits.
5. Return the source versions, applicability, counterexamples and concrete checks that distinguish the relevant mechanisms. Do not dump the full retrieval transcript.

Do not create session candidates from this skill. Do not persist or promote cards.

Use `subagent_report` only for meaningful progress, a blocker, or a required decision within the assigned scope. Do not send routine heartbeats or expand authority through messages. Finish with the structured result and evidence references.
