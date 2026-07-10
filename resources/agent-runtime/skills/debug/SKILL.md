---
name: debug
description: Diagnose issues from reproducible evidence, isolate the responsible component, and verify the correction.
allowed-tools: [read_file, glob, grep, web_search]
---

# Debug

1. Reproduce the exact failure conditions.
2. Isolate the responsible component with source, logs, and runtime evidence.
3. Explain the code-level root cause.
4. Propose the smallest complete correction that removes the defective path.
5. Verify the positive and negative paths.

Do not claim a cause before reading the relevant implementation and evidence. Ask for missing external input when reproduction cannot be established.
