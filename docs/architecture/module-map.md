# Module Map

| Domain | Main files | Shared contract | IPC/API surface | Renderer surface | Verification |
| --- | --- | --- | --- | --- | --- |
| Agentic Trace | `src/main/agent-trace/*`, `src/main/workflow/debugger/TraceStateStore.ts` | `AgentRunPresentation`, `TraceEvent`, `TraceNode`, `ProgressTask`, `TraceArtifactRecord`, `TraceContextRecord` | `trace:getRun`, `trace:getEvents`, `trace:getProjection`, `trace:exportRun`, `trace:switchBranch`, `trace:projectionChanged` | `features/right-rail/TraceRightPanel`, Work Process transcript | typecheck, fidelity, browser-session smoke |
| Agent workbench | `src/main/workflow/debugger/AgentOrchestrator.ts`, `src/main/settings/AgentManifestService.ts`, `src/main/agent-runtime/*` | `.agent.md`, `AgentId`, `AgentManifestDefinition`, `WorkflowState`, `BUILTIN_AGENT_TOOL_IDS` / tool tokens | `conversation:sendMessage`, `agent:*`, `workflow:stop`, `workflow:getState`, `workflow:listRuns` | Composer, `features/transcript`, Settings > Agents, `features/right-rail` | typecheck, settings-agents, tool-system, browser smoke |
| RDX shell actions | `src/main/tools/RdxShellActionService.ts`, `ShellInvocationService.ts`, `src/main/sessions/RdxSessionService.ts` | `RdxActionSettingsMap`, `RdxRuntimeContext`, `OpenedCaptureState` | `capture:openProjectInput`, `context:get`, `context:openHumanPreview`, `tool:getRuntimeSummary` | Settings > Tools, capture library, session context, Activity | typecheck, shell/browser smoke |
| Settings/provider system | `src/main/settings/*` | `AppSettings`, provider catalog, routes, `ToolingSettings` | settings IPC | Settings modal | typecheck, provider-system tests |
| Sessions/captures | `src/main/sessions/*`, `src/main/captures/*` | `SessionRecord`, `RunSummary`, `OpenedCaptureState` | project/session/capture IPC | project tree, capture library, opened capture panels | typecheck, shell smoke |
| Reports/evidence | `src/main/reports/*` | `ArtifactRecord`, `EvidencePacket`, diagnostics | report/evidence IPC | Activity, artifacts, trace cards | typecheck |

Rules:

- Cross-layer contracts belong in `src/shared`.
- Main-process domains may depend on shared types and adjacent main services.
- Renderer code reaches main capabilities only through preload APIs.
- RDX CLI command details are Settings data, not module constants.
