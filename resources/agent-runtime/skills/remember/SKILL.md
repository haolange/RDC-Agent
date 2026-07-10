---
name: remember
description: Persist a user-approved fact or decision into explicit User or Project memory.
allowed-tools: [memory_search, memory_read, memory_write]
---

# Remember

Only use this skill when the user explicitly asks to remember something or approves a proposed memory write.

1. Search the selected scope for an existing equivalent record.
2. State the exact fact, decision, preference, or reusable learning to preserve.
3. Choose User scope for cross-project preferences and Project scope for project-specific decisions.
4. Call `memory_write` with the selected scope and concise Markdown content.

Do not infer memory intent from ordinary conversation and do not batch-extract unrelated facts.
