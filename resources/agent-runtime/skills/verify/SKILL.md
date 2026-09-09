---
name: verify
description: Verify a change through repository checks and the real product surface affected by it.
allowed-tools: [read_file, glob, grep, shell]
---

# Verify

Use read_file/glob/grep/shell to run the affected repository checks required by `AGENTS.md` and `DESIGN.md`, then exercise the real runtime surface affected by the change. For UI work, report any browser interaction or screenshot capability unavailable under this skill; the caller validates that surface in a separate authorized step. A static green result does not override a visible or runtime failure.
