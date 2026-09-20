# RDC/RDC Debugger Profile Overview

Debugger is a planning profile alongside Analyzer and Optimizer. General owns execution; declared handoffs and a human-approved plan connect the profiles.

## User Flow

1. Open a project.
2. Open a `.rdc` capture through the application.
3. Select the Debugger profile when the task needs RenderDoc/RDC context.
4. Provide the debugging goal.
5. Review Work Process events, tool calls, approvals, diagnostics, and any handoff.
6. Let approved app entries execute through configured RDC shell actions / system CLI.
7. Review trace, evidence, artifacts, and report output.

## Product Boundaries

- General handles ordinary work and approved execution.
- Debugger, Analyzer and Optimizer plan and evaluate investigations. Their execution handoff requires an approved plan and explicit user action.
- Prompt text that mentions a path does not open a capture; only application state can provide an opened capture context.

## Tooling Boundary

Settings selects an independent RDC-Tool installation. Main validates its bundled Python/CLI pair and complete catalog. Each execution turn freezes the binding and owning lease; operation recipes live in Skills, not configurable lifecycle command templates.

Renderer UI displays state, approvals, trace, evidence, and artifacts. It does not execute arbitrary RDC tools.

## Validation

Debugger changes should pass typecheck and the relevant workflow, trace, browser-session, or shell smoke checks for the touched boundary.
