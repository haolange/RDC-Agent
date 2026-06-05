# 模块地图

本文是后续 agent 的定位入口：先查能力域，再进入对应源码、共享类型、IPC/preload API、UI 和测试。

## 主能力域

| 能力域 | main 入口 | shared 契约 | preload / IPC | renderer 入口 | 测试入口 |
| --- | --- | --- | --- | --- | --- |
| Agent Runtime Kernel | `src/main/agent-runtime/AgentRuntime.ts`, `ModelProviderRegistry.ts`, `ToolRegistry.ts`, `AgentRuntimeToolPolicy.ts` | `AgentEvent`, `ModelProviderCapabilityMatrix`, `ModelTurnEvent`, runtime profiles/task graph | conversation/workflow internal runtime events; no public bypass | Agent Workstream projection, Activity diagnostics, Browser fallback provider status | `agent-runtime-policy.spec.ts`, `agent-runtime-kernel.spec.ts` |
| Shell / Window / Dialog | `src/main/ipc/shellHandlers.ts`、`src/main/shell/` | `src/shared/types/electron/platform.ts` | `src/preload/api/shell.ts`、`app:*`、`window:*`、`dialog:*` | `src/renderer/app/`、`src/renderer/shell/`（TitleBar/布局原语） | workbench smoke |
| Project / Session / Run | `src/main/sessions/RdxSessionService.ts`、`StorageAdapter.ts`、`src/main/ipc/projectSessionHandlers.ts` | `ProjectRecord`、`SessionRecord`、`RunSummary` | `src/preload/api/projectSession.ts`、`project:*`、`session:*`、`run:*` | `src/renderer/features/projects/Sidebar`、`projectStore` / `sessionStore` | `session-lifecycle.spec.ts` |
| Capture / Device | `src/main/captures/ReplayDeviceService.ts`、`ContextService.ts`、`src/main/sessions/RdxSessionService.ts`、`src/main/ipc/captureDeviceHandlers.ts` | `CaptureDescriptor`、`OpenedCaptureState`、`ReplayDeviceEntry` | `src/preload/api/captureContext.ts`、`capture:*`、`device:*` | `src/renderer/features/captures/DeviceSelector`、`features/debugger/ControlPanel` | capture / workbench smoke |
| Conversation | `src/main/conversation/ConversationService.ts`、`DebuggerRuntime.requestStartFromConversation`、`src/main/ipc/conversationHandlers.ts` | `ConversationMessage`、`ConversationTurnResult`、`AppMode`、`ExecutableAppMode` | `src/preload/api/conversation.ts`、`conversation:*`、`conversation:event` | `src/renderer/features/debugger/AgentChat`、composer glue、默认 `Ask` | `mode-switch.spec.ts`、debugger plan intake smoke |
| Debugger Workflow | `src/main/workflow/debugger/DebuggerRuntime.ts`、`DebugWorkflowService.ts`、`RunExecutionService.ts`、`WorkflowProjectionPublisher.ts`、`src/main/ipc/workflowHandlers.ts` | `WorkflowState`、`DebugPlan.presentation`、`AskUserPrompt`、`HarnessTask` | `src/preload/api/workflow.ts`、`workflow:*` | `src/renderer/features/debugger/AgentChat`、`PlanIntakePanel`、`AskUserQuestionCard`、`ControlPanel` | `debugger-runtime-contract.spec.ts`、`debugger-plan-intake.spec.ts` |
| Agent Workstream | `src/main/workflow/debugger/AgentWorkstreamProjector.ts`、`WorkstreamStateStore.ts`、`DebugWorkflowService` approval/revision/export API | `AgentWorkstreamSession`、`AgentWorkstreamPresentation`、`TaskWorkstream`、`ProcessEvent`、`ProgressTask`、`WorkstreamArtifactRecord`、`WorkstreamContextRecord` | `workflow:getWorkstreamSession`、`workflow:requestPlanRevision`、`workflow:switchWorkstreamBranch`、`workflow:exportWorkstreamSession`、`workflow:workstreamChanged` | `src/renderer/features/debugger/AgentWorkstream`、`ComposerApprovalOverlay`、`WorkstreamRightPanel`、Browser fallback scenarios | `agent-workstream.spec.ts`、Browser Preview scenario smoke |
| Agent Runner | `src/main/workflow/debugger/AgentRunnerPort.ts`、`AgentRunnerRegistry.ts`、`adapters/*AgentSdkAdapter.ts` | `LLMConfig`、`ToolCatalog`、`ToolCallResult` | 经 workflow stage 内部调用，不公开 workflow 旁路 | `AgentWorkstreamProjector` 将 stage/tool events 投影到 Agent Workstream；Activity 保留 runtime log | runtime/SDK smoke |
| Tools | `src/main/tools/ToolBridge.ts`、`ToolBridgeAgentToolPort.ts`、`src/main/ipc/toolEvidenceHandlers.ts` | `ToolCatalog`、`ToolCallResult`、`ToolRuntimeSummary` | `src/preload/api/toolEvidence.ts`、`tool:*`、`tool:executionComplete` | capabilities panel、Activity | tool smoke / workflow smoke |
| Evidence / Reports | `src/main/reports/EvidenceLedger.ts`、`ArtifactStore.ts`、`ReportBundleService.ts`、`src/main/ipc/toolEvidenceHandlers.ts` | `ActionEvent`、`ArtifactRecord`、`Report` | `src/preload/api/toolEvidence.ts`、`evidence:*` | `src/renderer/features/debugger/EvidencePanel`、`ArtifactViewer` | workflow/report smoke |
| Settings / Profile / LLM | `src/main/settings/SettingsService.ts`、`ExecutionProfileService.ts`、`SecretStorageService.ts`、`ProviderAccountAuthService.ts`、`ProviderConnectionService.ts`、`LLMAdapter.ts`、`DebuggerLlmService.ts`、`src/main/ipc/settingsLlmHandlers.ts` | `AppSettings`、`LLMConfig`、`LlmProviderEntry`、`LlmProviderAccountStatus`、`ask_agent` 非执行 profile | `src/preload/api/settings.ts`、`settings:*`、`llm:*`、`app:selectAvatar` | `src/renderer/features/settings/SettingsModal`、`src/renderer/shell/UserMenu` | `settings-persistence.spec.ts` |
| Runtime / Terminal | `src/main/runtime/RuntimeLogService.ts`、`TerminalSessionService.ts`、`AppPathService.ts`、`src/main/ipc/runtimeTerminalHandlers.ts` | `RuntimeLogEntry`、`TerminalTabRecord` | `src/preload/api/runtime.ts`、`runtimeLog:*`、`terminal:*` | `src/renderer/features/terminal/TerminalDrawer`、Activity | terminal / workbench smoke |
| Browser fallback | `src/renderer/platform/browserElectronApi.ts`、`src/renderer/platform/browserFallback/BrowserElectronApiFallback.ts` | `ElectronAPI` | browser fallback implementation | browser preview / static smoke | browser fallback smoke |

## 新增或调整功能的触点

新增跨层能力时，按顺序检查：

1. `src/shared/types/*` 是否已有契约，是否需要增加字段或子类型。
2. `src/main/ipc/channels.ts` 是否需要登记 channel 所属域。
3. `src/main/ipc/*Handlers.ts` 是否有对应 handler 注册位置。
4. `src/preload/index.ts` 与 `src/preload/api/*` 是否保持 `window.electronAPI` 公开形状。
5. `src/renderer/platform/browserFallback/*` 是否需要 fallback。
6. 对应 UI 入口是否完整，测试定位符是否保持。
7. 文档是否需要同步 `overview.md`、`data-flow.md` 或本文。

## 热点拆分路线

| 热点文件 | 当前问题 | 拆分方向 | 约束 |
| --- | --- | --- | --- |
| `src/main/ipc/workbenchHandlers.ts` | 已收敛为 IPC 状态、广播、启动订阅和域注册组合入口 | 后续只允许增加上下文能力，不再把新 channel 直接写回组合入口 | 保持 channel 名不变 |
| `src/main/workflow/debugger/DebugWorkflowService.ts` | plan/intake、approval、execution、report、LLM parsing 仍较集中 | 继续拆 stage worker、validator、publication、payload normalization | 不恢复公开入口，不改阶段和工具行为 |
| `src/main/sessions/StorageAdapter.ts` | project/session/run repository 与 file store 仍在同一 facade 内 | 继续拆 workspace layout、project repository、session repository、run repository、JSON/YAML file store | 不改 workspace 数据格式 |
| `src/renderer/app/App.tsx` | `app/` + `bootstrap/*` + `composer/`；`main.tsx` 直连 `app/App` | 保持分域 store 与守卫 | DOM/CSS/test id 保真 |
| `src/renderer/platform/browserFallback/BrowserElectronApiFallback.ts` | 安装入口已收敛且本机绝对预览路径已移除；fallback state、fixtures、domain builders 仍集中 | 继续按 fixtures、event bus、domain API builders 拆分 | 浏览器预览数据完整 |
| `src/shared/types/electron.ts` | 总接口仍在单文件聚合 | 保持总接口，域类型已在 `src/shared/types/electron/*` 暴露 | 不删除现有类型 |

## 验证入口

- 静态：`npm run typecheck`
- 架构：`npm run check:architecture`
- 保真：`npm run check:fidelity`
- 共享导出：`npm run check:shared-exports`
- 构建：`npm run build`
- 关键 E2E：
  - `npm run test:e2e -- debugger-plan-intake.spec.ts`
  - `npm run test:e2e -- session-lifecycle.spec.ts`
  - `npm run test:e2e -- settings-persistence.spec.ts`
  - `npm run test:e2e -- workbench-visual.spec.ts`

运行 Electron E2E 前必须先执行 `npm run build`，因为 E2E 启动的是 `out/main/index.js` 与 `out/renderer`。
