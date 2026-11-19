# Module Map

| Domain | Main files | Shared contract | IPC/API surface | Renderer surface | Verification |
| --- | --- | --- | --- | --- | --- |
| Agentic Trace | `src/main/agent-trace/*`, `src/main/agent-runtime/orchestration/TraceStateStore.ts` | `AgentRunPresentation`, `TraceEvent`, `TraceNode`, `ProgressTask`, `TraceArtifactRecord`, `TraceContextRecord` | `trace:getProjection`, `trace:projectionChanged` | `features/right-rail/SessionRightRail`, Work Process transcript | typecheck, fidelity, browser-session smoke |
| Agent workbench | `src/main/agent-runtime/orchestration/AgentOrchestrator.ts`, `src/main/settings/agent-manifests/AgentManifestService.ts`, `src/main/agent-runtime/*` | `.agent.md`, `AgentId`, `AgentManifestDefinition`, `WorkflowState`, `BUILTIN_AGENT_TOOL_IDS` / tool tokens | `conversation:*`, `session:applyDeclaredHandoff`, `workflow:stop`, `workflow:getState` | Composer, `features/transcript`, Settings > Agents, `features/right-rail` | typecheck, settings-agents, tool-system, browser smoke |
| RDC runtime boundary | `src/main/rdc/RdcCliInvokerService.ts`, `src/main/tools/ShellInvocationService.ts`, `src/main/rdc/RdcSessionRuntime.ts` | `RdcRuntimeContext`, `OpenedCaptureState`, `RdcTurnBinding` | `capture:openProjectInput`, `context:get`, `capture:refreshFrame`, `tool:verifyInstallation` | Settings > Tools, capture library, session context, Activity | typecheck, shell/browser smoke |
| Settings/provider system | `src/main/settings/settings-core`, `provider-catalog`, `provider-auth`, `agent-manifests` | `AppSettings`, provider catalog, routes, `ToolingSettings` | settings IPC | Settings modal | typecheck, provider-system tests |
| Sessions/captures | `src/main/sessions/store`, `sessions/run`, `sessions/artifacts`, `src/main/rdc/captures` | `SessionRecord` (`schemaVersion: '1'`, 旧文件 fail-closed), `RunSummary`, `OpenedCaptureState` | project/session/capture IPC | project tree, capture library, opened capture panels | typecheck, shell smoke |
| Scoped resources | `src/main/runtime/ScopedRuntimeService.ts` | Agent/Skill/MCP/Hook/policy documents | `rdc-runtime:*` | Settings resource editors | typecheck, scoped-resources |
| RDC 操作协调与恢复 | `src/main/rdc/RdcOperationCoordinator.ts`, `RdcOperationPolicy.ts`, `RdcOperationCatalog.ts`, `RdcCaptureRecovery.ts`, `RdcTurnBindings.ts`, `OwnedRdcDaemonRegistry.ts`, `RdcRemoteConnection.ts` | `RdcTurnBinding`, 操作回执 | 经 `shell.rdc` / `rdc_probe` 与 capture IPC | Capture 卡、session context | typecheck, shell smoke（契约见 `rdc-runtime.md`） |
| Investigation | `src/main/investigation/*`（`InvestigationArtifactService`, `InvestigationTools`） | Investigation Artifact / manifest 记录 | `investigation:list` 等 | Right Rail Artifacts | typecheck, investigation tests |
| Knowledge | `src/main/knowledge/*` | Knowledge candidate / index / export | knowledge IPC | `features/knowledge` | typecheck, knowledge tests |
| Hooks | `src/main/hooks/*`（`HookEngine`, `hookTrustStore`） | Hook 文档与 trust fingerprint | `rdc-runtime:*` | Settings > Hooks | typecheck, scoped-resources |
| Conversation | `src/main/conversation/*`（`ConversationService`, `ConversationTurnRunner`, `ConversationWorkTrace`） | `ConversationWorkTrace`, 附件与分支 | `conversation:*` | `features/composer`, `features/transcript` | typecheck, agent-runtime, work-process |
| Permissions | `src/main/agent-runtime/permissions/*`（`AgentPermissionPolicy`, `PolicyCompiler`） | 权限模式与 policy | `conversation:answerToolApproval` 等 | 审批卡、Settings > Policy | typecheck, 见 `contracts/permissions.md` |
| Tasks | `src/main/agent-runtime/tasks/*`（`TaskRegistry`, `TaskTools`, `taskProjection`） | `ProgressTask` | `task_*` 工具、trace 投影 | Right Rail Progress、Tasks 卡 | typecheck, agent-runtime |
| Provider adapters | `src/main/agent-runtime/providers/*` | `RequestPlan`, `EffectiveModel` | 无直接 IPC | 无 | typecheck, provider-system tests（见 `provider-architecture.md`） |
| Browser app bridge | `src/main/browserAppBridge/*` | `src/shared/renderer-api/` manifest | localhost HTTP/SSE | Browser 路径同一 renderer | `bridgeSecurity.test.ts`（见 `browser-qa-surface.md`） |
| Reports/evidence | `src/main/reports/*` | `ArtifactRecord`, `ActionEvent`, diagnostics | `evidence:getChain`, `evidence:eventAdded` | Activity, artifacts, trace cards | typecheck |

Rules:

- Cross-layer contracts belong in `src/shared`.
- Main-process domains may depend on shared types and adjacent main services.
- Renderer code reaches main capabilities only through preload APIs.
- RDC-Tool CLI installation details are Settings data. Lifecycle operations and their argument construction are fixed in the main session boundary.

## Renderer 职责地图

renderer 按 `app/`、`features/`（composer、transcript、right-rail、sidebar、terminal、settings、knowledge、onboarding、captures）、`patterns/`、`ui/`、`lib/` 分层；feature 的局部边界见各 feature 的 README。组件级职责、视觉与交互规则见 `docs/ui/`：

- [`docs/ui/README.md`](../ui/README.md)：UI 文档入口。
- [`docs/ui/workbench-and-transcript.md`](../ui/workbench-and-transcript.md)：Workbench、Composer、Transcript 与 Work Process。
- [`docs/ui/design-system.md`](../ui/design-system.md)：基础组件、patterns 与主题。
- [`docs/ui/knowledge-center.md`](../ui/knowledge-center.md)：Knowledge Center。

renderer 只通过 preload API 访问 main；AST 分层门禁检查静态导入、重导出、动态导入与 pattern store 写入。
