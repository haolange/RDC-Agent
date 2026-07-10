---
name: simplify
description: Review the current change for reuse, clarity, efficiency, and correct abstraction level.
allowed-tools: [read_file, glob, grep]
---

# Simplify

Review the active change for clear, non-speculative improvements in reuse, duplication, control flow, allocations, testability, and abstraction boundaries. Trace every recommendation to the current diff or a directly coupled call site. Do not introduce flexibility without a current requirement.
