---
name: capture-preflight
description: Check capture, CLI, and replay readiness before opening or mutating a .rdc.
---

# Capture Preflight

Use this skill before opening a capture, starting replay, or collecting first evidence.

1. Confirm the `.rdc` path, project authorization, and active session.
2. Confirm the Settings-configured RDX CLI is available through `rdx_context`. Do not guess a binary.
3. Read the available replay configuration. If the capture is not open, direct the user to select it and click Open capture in the Session Capture section. Ask only about a choice the user can meaningfully make; do not ask them to configure leases or diagnose replay ownership. Do not repeatedly search for an unavailable opener. Clarification can continue before replay is ready. Use turn_complete with blocked when waiting for the user, keeping the investigation unfinished.
4. List existing investigation artifacts so later writes do not overwrite silently.

Do not open or mutate a capture when CLI, path, or authorization is missing. Do not hardcode RenderDoc commands. Do not treat an old World State as current without a fresh check.
