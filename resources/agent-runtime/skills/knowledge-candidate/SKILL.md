---
name: knowledge-candidate
description: Create a session Knowledge Candidate only after explicit user intent. Never persist verified or promoted cards.
allowed-tools: [knowledge_candidate_create]
---

# Knowledge Candidate

Only use this skill when the user explicitly asks to propose a Knowledge Candidate.

1. State the exact card title, type, and body to propose.
2. Call `knowledge_candidate_create` with `explicitUserIntent: true`.
3. Treat the result as a session Candidate only. It is not verified, promoted, or written to user/project Knowledge.

Do not persist, promote, or treat `fixed` / source-status as verified. Persistent Knowledge writes remain human-only.
