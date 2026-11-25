# Module Map

| Domain | Main files | Shared contract | IPC/API surface | Renderer surface | Verification |
| --- | --- | --- | --- | --- | --- |
| Agentic Trace | `src/main/agent-trace/*`, `src/main/agent-runtime/orchestration/TraceStateStore.ts` | `AgentRunPresentation`, `TraceEvent`, `TraceNode`, `TaskRailItem`, `TraceArtifactRecord`, `TraceContextRecord` | `trace:getProjection`, `trace:projectionChanged` | `features/right-rail/SessionRightRail`, Work Process transcript | typecheck, qa-ids, browser-session smoke |
| Agent workbench | `src/main/agent-runtime/orchestration/AgentOrchestrator.ts`（façade；协作者由组合根 `src/main/agent-runtime/orchestration/agentRuntimeRoot.ts` 构造）, `src/main/settings/agent-manifests/AgentManifestService.ts`, `src/main/agent-runtime/*` | `.agent.md`, `AgentId`, `AgentManifestDefinition`, `WorkflowState`, `BUILTIN_AGENT_TOOL_IDS` / tool tokens | `conversation:*`, `session:applyDeclaredHandoff`, `workflow:stop`, `workflow:getState` | Composer, `features/transcript`, Settings > Agents, `features/right-rail` | typecheck, settings-agents, tool-system, browser smoke |
| RDC runtime boundary | `src/main/rdc/RdcCliInvokerService.ts`, `src/main/tools/ShellInvocationService.ts`, `src/main/rdc/RdcSessionRuntime.ts` | `RdcRuntimeContext`, `OpenedCaptureState`, `RdcTurnBinding` | `capture:openProjectInput`, `context:get`, `capture:refreshFrame`, `tool:verifyInstallation` | Settings > Tools, capture library, session context, Activity | typecheck, shell/browser smoke |
| Settings/provider system | `src/main/settings/settings-core`, `provider-catalog`, `provider-auth`, `agent-manifests` | `AppSettings`, provider catalog, routes, `ToolingSettings` | settings IPC | Settings modal | typecheck, provider-system tests |
| Sessions/captures | `src/main/sessions/store`（组合根 `sessions/store/sessionStores.ts` 创建共享 `StorageIo` 与各 store：`ProjectWorkspaceStore` 项目 registry 与选择、`SessionRecordStore` session/run 记录、`ConversationHistoryStore` 对话历史/分支/附件、`SessionContextStore` usage/shell/journal、`ExecutionOfferStore`；调用方直接依赖拥有数据的 store，无转发层）, `sessions/run`, `sessions/artifacts`, `src/main/rdc/captures` | `SessionRecord` (`schemaVersion: '1'`, 旧文件 fail-closed), `RunSummary`, `OpenedCaptureState` | project/session/capture IPC | project tree, capture library, opened capture panels | typecheck, shell smoke |
| Scoped resources | `src/main/settings/agent-manifests/ScopedRuntimeService.ts` | Agent/Skill/MCP/Hook/policy documents | `rdc-runtime:*` | Settings resource editors | typecheck, scoped-resources |
| RDC 操作协调与恢复 | `src/main/rdc/RdcOperationCoordinator.ts`, `RdcOperationPolicy.ts`, `RdcOperationCatalog.ts`, `RdcCaptureRecovery.ts`, `RdcTurnBindings.ts`, `OwnedRdcDaemonRegistry.ts`, `RdcRemoteConnection.ts` | `RdcTurnBinding`, 操作回执 | 经 `shell.rdc` / `rdc_probe` 与 capture IPC | Capture 卡、session context | typecheck, shell smoke（契约见 `rdc-runtime.md`） |
| Investigation | `src/main/investigation/*`（`InvestigationArtifactService`, `investigationRecordChecks`, `InvestigationTools`） | Investigation Artifact / manifest 记录 | `investigation:list` 等 | Right Rail Artifacts | typecheck, investigation tests |
| Knowledge | `src/main/knowledge/*` | Knowledge candidate / index / export | knowledge IPC | `features/knowledge` | typecheck, knowledge tests |
| Hooks | `src/main/hooks/*`（`HookEngine`；信任记录经 `src/main/runtime/TrustStore.ts`） | Hook 文档与 trust fingerprint | `rdc-runtime:*` | Settings > Hooks | typecheck, scoped-resources |
| Conversation | `src/main/conversation/*`（`ConversationService`, `ConversationTurnStarter`, `ConversationTurnRunner`）；work trace 与委派投影在 `src/main/agent-runtime/workTrace/*`，附件物化与工具图片预览在 `src/main/agent-runtime/attachments/*`，session context journal 在 `src/main/agent-runtime/context/SessionContextJournal.ts` | `ConversationWorkTrace`, 附件与分支 | `conversation:*` | `features/composer`, `features/transcript` | typecheck, agent-runtime, work-process |
| Permissions | `src/main/agent-runtime/permissions/*`（`AgentPermissionPolicy`, `PolicyCompiler`） | 权限模式与 policy | `conversation:answerToolApproval` 等 | 审批卡、Settings > Policy | typecheck, 见 `contracts/permissions.md` |
| Tasks | `src/main/agent-runtime/tasks/*`（`TaskRegistry` 生命周期变更，基于 `TaskExecutionLedger` 执行记账与 `TaskRegistryCore` 记录读取、依赖图与完成校验；`TaskTools`, `taskProjection`） | `TaskRailItem` | `task_*` 工具、trace 投影 | Right Rail Tasks、Tasks 历史卡 | typecheck, agent-runtime |
| Provider adapters | `src/main/agent-runtime/providers/*` | `RequestPlan`, `EffectiveModel` | 无直接 IPC | 无 | typecheck, provider-system tests（见 `provider-architecture.md`） |
| Browser app bridge | `src/main/browserAppBridge/*` | `src/shared/renderer-api/` manifest | localhost HTTP/SSE | Browser 路径同一 renderer | `bridgeSecurity.test.ts`（见 `browser-qa-surface.md`） |
| Reports/evidence | `src/main/reports/*` | `ArtifactRecord`, `ActionEvent`, diagnostics | `evidence:getChain`, `evidence:eventAdded` | Activity, artifacts, trace cards | typecheck |
| Host platform | `src/main/platform/*`（`host`、`paths`、`process`、`shell`、`secrets`、`rdcLayout`） | 无跨层类型 | 无 IPC；渲染层平台信息只经 `src/preload/index.ts` | `createRendererApi` 的 `isMac` / `isWindows` / `isLinux` | `check:host-platform`、`src/main/platform/*.test.ts`（见 `host-platform.md`） |

Rules:

- Cross-layer contracts belong in `src/shared`.
- Main-process domains import only lower layers (`MAIN_DOMAIN_LAYERS` in `eslint.config.mjs`, described in `ARCHITECTURE.md`); primitives several domains share live in `src/main/runtime`, and a lower domain that needs a higher implementation declares a port that `src/main/index.ts` binds.
- Renderer code reaches main capabilities only through preload APIs.
- RDC-Tool CLI installation details are Settings data. Lifecycle operations and their argument construction are fixed in the main session boundary.

## Renderer 职责地图

renderer 按 `app/`、`features/`（composer、transcript、right-rail、sidebar、terminal、settings、knowledge、captures）、`patterns/`、`ui/`、`lib/` 分层；feature 的局部边界见各 feature 的 README。组件级职责、视觉与交互规则见 `docs/ui/`：

- [`docs/ui/README.md`](../ui/README.md)：UI 文档入口。
- [`docs/ui/workbench-and-transcript.md`](../ui/workbench-and-transcript.md)：Workbench、Composer、Transcript 与 Work Process。
- [`docs/ui/design-system.md`](../ui/design-system.md)：基础组件、patterns 与主题。
- [`docs/ui/knowledge-center.md`](../ui/knowledge-center.md)：Knowledge Center。

renderer 只通过 preload API 访问 main；AST 分层门禁检查静态导入、重导出、动态导入与 pattern store 写入。
