---
name: simplify
description: Review the current change for reuse, clarity, efficiency, and correct abstraction level.
allowed-tools: [read_file, glob, grep, artifact_read, subagent_report, turn_complete]
---

# Simplify

Review the active change for clear, non-speculative improvements in reuse, duplication, control flow, allocations, testability, and abstraction boundaries. Trace every recommendation to the current diff or a directly coupled call site. Do not introduce flexibility without a current requirement.

For delegated read-only review, read the exact granted artifacts and return your own result through the existing report/completion tools. This tool declaration does not grant workspace paths, artifact references or write access; the frozen runtime intersection and per-artifact authorization still apply.
