---
name: verify
description: Verify a change through repository checks and the real product surface affected by it.
allowed-tools: [read_file, glob, grep, bash]
---

# Verify

Run the repository checks required by `AGENTS.md` and `DESIGN.md`, then exercise the real runtime surface affected by the change. UI work requires the real browser-app session, screenshots, interaction checks, and console/main-process logs. A static green result does not override a visible or runtime failure.
