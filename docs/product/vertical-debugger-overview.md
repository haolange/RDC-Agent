# Vertical Debugger Overview

Debugger is the current execution-oriented mode for RenderDoc `.rdc` capture analysis.

## User Flow

1. Open a project.
2. Open a `.rdc` capture through the application.
3. Enter Debugger mode.
4. Provide the debugging goal.
5. Review and approve the generated plan.
6. Let the workflow execute through the configured RDX CLI.
7. Review trace, evidence, artifacts, and report output.

## Product Boundaries

- Ask mode is read-only guidance and clarification.
- Debugger mode is the execution chain.
- Analyzer and Optimizer are product modes, but they are not auto-wired into the Debugger harness.
- Prompt text that mentions a path does not open a capture; only application state can provide an opened capture context.

## Tooling Boundary

Debugger execution uses the configured RDX CLI invoker. The CLI command and catalog path are Settings data, not built-in application constants.

Renderer UI displays state, approvals, trace, evidence, and artifacts. It does not execute arbitrary RDX tools.

## Validation

Debugger changes should pass typecheck and the relevant workflow, trace, browser-session, or shell smoke checks for the touched boundary.
