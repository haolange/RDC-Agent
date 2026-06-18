# RDC Context
description: Summarize the active project, capture, and RenderDoc session context before deeper investigation.
type: prompt
promptTemplate: |
  Summarize the current RDC-Agent context for the active task.

  Include:
  - active project and selected session;
  - attached or opened .rdc capture;
  - current RenderDoc/RDX runtime state;
  - relevant user goal and constraints;
  - missing evidence that should be collected next.

  Keep the summary short, factual, and grounded in available state.
