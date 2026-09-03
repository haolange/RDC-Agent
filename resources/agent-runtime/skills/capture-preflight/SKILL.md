---
name: capture-preflight
description: Check capture, CLI, and replay readiness before opening or mutating a .rdc.
allowed-tools: [rdx_context, rdx_probe, read_file, investigation_list, investigation_read, investigation_write, plan_artifact, agent_handoff, ask_user, shell, task_create, subagent]
---

# Capture Preflight

Use this skill before opening a capture, starting replay, or collecting first evidence.

1. Confirm the `.rdc` path, project authorization, and active session.
2. Confirm the Settings-configured RDX CLI is available through `rdx_context`. Do not guess a binary.
3. Confirm replay device and exclusive World State needs. Ask when any of those are missing.
4. List existing investigation artifacts so later writes do not overwrite silently.

Do not open or mutate a capture when CLI, path, or authorization is missing. Do not hardcode RenderDoc commands. Do not treat an old World State as current without a fresh check.
