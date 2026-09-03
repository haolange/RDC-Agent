---
name: knowledge-scout
description: Search, read, and compile scoped Knowledge into a sourced Brief or Pack without writing or promoting cards.
allowed-tools: [knowledge_browse, knowledge_search, knowledge_read, knowledge_compile]
---

# Knowledge Scout

Use this skill for Knowledge retrieval that is larger than a single deterministic lookup: multi-lane search, conflict synthesis, similar-case disambiguation, and historical evolution.

1. Browse spaces or search with an explicit query and scope.
2. Read only the cards needed to answer the question.
3. Compile a sourced Brief or Pack with match reasons and lane availability.
4. Return the Pack or card refs. Do not dump the full retrieval transcript.

Do not create session candidates from this skill. Do not persist, promote, or claim semantic results when the semantic lane is `unavailable` or `stale`.
