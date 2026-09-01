---
name: renderdoc-execution
description: Execute approved RenderDoc investigation work with existing tools and session-owned artifacts.
allowed-tools: [investigation_read, investigation_write, investigation_list, artifact_read, rdx_context, shell, task_create, task_update, task_get, task_list, knowledge_browse, knowledge_search, knowledge_read]
---

# RenderDoc Execution

Use this skill after a Mission plan is handed to General. Execute the planned capture work. Do not invent a new investigation runtime.

1. Restate the planned check in one sentence.
2. Load only the method skill required for that check (`$capture-facts`, `$pass-graph-analysis`, `$shader-ir-analysis`, `$pixel-forensics`, `$resource-versioning`, `$cross-capture-alignment`, `$optimization-experiment`, `$artifact-provenance`, `$skeptic-review`, `$report-composition`, `$rdx-cli-shell`).
3. Write Evidence / Claim / Experiment / Challenge only through `investigation_*` into `rdc.investigation.v1` Session Artifacts.
4. Cite artifacts with `session://` or `investigation_read`. Mark `ready` only when provenance holds.
5. Verify the planned result before claiming done.

Do not write investigation fields into Tasks, Profiles, or Messages. Do not hardcode RenderDoc/RDX CLI paths; use the Settings-configured RDX shell action. Persistent Knowledge writes stay human-confirmed. Embedding models stay out of the Agent picker. Causal claims need a qualifying Experiment (`S-CAUSAL-01`). Report and compact projections must not raise Claim rank (`S-CLAIM-01`).
