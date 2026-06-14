# RDC/RDX Debugger Profile Overview

Debugger is the RDC/RDX-oriented executable profile inside the general RDC-Agent workbench. It is not the only execution path: Edit, Analyzer, and Optimizer are also profiles with their own instructions, tools, approval policy, and handoffs.

## User Flow

1. Open a project.
2. Open a `.rdc` capture through the application.
3. Select the Debugger profile when the task needs RenderDoc/RDC context.
4. Provide the debugging goal.
5. Review Work Process events, tool calls, approvals, diagnostics, and any handoff.
6. Let approved app entries execute through configured RDX shell actions / system CLI.
7. Review trace, evidence, artifacts, and report output.

## Product Boundaries

- Ask is read-only guidance and clarification.
- Plan researches, asks questions, and creates plan/handoff artifacts without direct implementation.
- Edit handles ordinary implementation work under approval policy.
- Debugger, Analyzer, and Optimizer are executable profiles; they are selected or invoked by profile visibility, handoffs, and tool policy rather than hardcoded mode branches.
- Prompt text that mentions a path does not open a capture; only application state can provide an opened capture context.

## Tooling Boundary

Debugger execution uses configured shell access and stable `RdxRuntimeContext`. RDX CLI commands, action recipes, and catalog path are Settings data, not built-in application constants.

Renderer UI displays state, approvals, trace, evidence, and artifacts. It does not execute arbitrary RDX tools.

## Validation

Debugger changes should pass typecheck and the relevant workflow, trace, browser-session, or shell smoke checks for the touched boundary.
