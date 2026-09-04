---
name: knowledge-scout
description: Search, read, and compile scoped Knowledge into a sourced Brief or Pack without writing or promoting cards.
allowed-tools: [knowledge_browse, knowledge_search, knowledge_read, knowledge_compile]
---

# Knowledge Scout

Use this skill for Knowledge retrieval that is larger than a single deterministic lookup: multi-lane search, conflict synthesis, similar-case disambiguation, and historical evolution.

1. Search first with `knowledge_search` across the six markdown-first lanes: Identity/Path, Scope/Metadata, Lexical, Structural, Relation/Graph, Temporal/Version.
2. Follow with `grep` / `glob` / `read_file` / `read_image` only for full-text evidence that the lanes did not already surface.
3. Read only the cards needed to answer the question. Cite `cardId` and `contentHash` for every used card.
4. Compile a sourced Brief or Pack with match reasons and lane hits.
5. Return the Pack or card refs. Do not dump the full retrieval transcript.

Do not create session candidates from this skill. Do not persist or promote cards.
