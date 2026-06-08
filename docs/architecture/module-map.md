# Module Map

| Domain | Main files | Shared contract | IPC/API surface | Renderer surface | Verification |
| --- | --- | --- | --- | --- | --- |
| Agentic Trace | `src/main/agent-trace/*`, `src/main/workflow/debugger/TraceStateStore.ts` | `AgentRunPresentation`, `TraceEvent`, `TraceNode`, `ProgressTask`, `TraceArtifactRecord`, `TraceContextRecord` | `trace:getRun`, `trace:getEvents`, `trace:getProjection`, `trace:exportRun`, `trace:switchBranch`, `trace:exportSession`, `trace:projectionChanged` | `src/renderer/stream/AgentRunView`, `TraceRightPanel`, renderer registry | typecheck, fidelity, browser-session smoke |
| Debugger workflow | `src/main/workflow/debugger/*` | `WorkflowState`, `DebugPlan`, `PlanApprovalState`, `TraceRevisionResult` | `workflow:start`, `workflow:getPlan`, `workflow:submitQuestions`, `workflow:approvePlan`, `workflow:restartRun`, `workflow:stopRun`, `workflow:getWorkflowState` | Composer, plan approval overlay, control panel | typecheck, shell/browser smoke |
| RDX CLI invocation | `src/main/tools/RdxCliInvokerService.ts`, `ShellInvocationService.ts` | `ToolCatalog`, `ToolCallResult`, `ToolRuntimeSummary`, `ToolTraceEntry`, `RdxCliInvokerSettings` | `tool:getCatalog`, `tool:getRuntimeSummary`, trace events | Settings > Agents, session capabilities panel, Activity | typecheck, shell smoke |
| Settings/provider system | `src/main/settings/*` | `AppSettings`, provider catalog, routes, `ToolingSettings` | settings IPC | Settings modal | typecheck, provider-system tests |
| Sessions/captures | `src/main/sessions/*`, `src/main/captures/*` | `SessionRecord`, `RunSummary`, `OpenedCaptureState` | project/session/capture IPC | project tree, capture library, opened capture panels | typecheck, shell smoke |
| Reports/evidence | `src/main/reports/*` | `ArtifactRecord`, `EvidencePacket`, diagnostics | report/evidence IPC | Activity, artifacts, trace cards | typecheck |

Rules:

- Cross-layer contracts belong in `src/shared`.
- Main-process domains may depend on shared types and adjacent main services.
- Renderer code reaches main capabilities only through preload APIs.
- RDX CLI command details are Settings data, not module constants.
