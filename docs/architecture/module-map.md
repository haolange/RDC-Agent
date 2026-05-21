# 模块地图

本文是后续 agent 的定位入口：先查能力域，再进入对应源码、共享类型、IPC/preload API、UI 和测试。

## 主能力域

| 能力域 | main 入口 | shared 契约 | preload / IPC | renderer 入口 | 测试入口 |
| --- | --- | --- | --- | --- | --- |
| Shell / Window / Dialog | `src/main/ipc/shellHandlers.ts`、`src/main/shell/` | `ElectronAPI.appMeta/appShell/windowControls` | `src/preload/api/shell.ts`、`app:*`、`window:*`、`dialog:*` | `App.tsx`、标题栏/用户菜单 | workbench smoke |
| Project / Session / Run | `RdxSessionService`、`StorageAdapter`、`src/main/sessions/` | `ProjectRecord`、`SessionRecord`、`RunSummary` | `project:*`、`session:*`、`run:*` | `Sidebar`、`sessionStore`、`App.tsx` | `session-lifecycle.spec.ts` |
| Capture / Device | `ReplayDeviceService`、`RdxSessionService`、`ContextService` | `CaptureDescriptor`、`OpenedCaptureState`、`ReplayDeviceEntry` | `capture:*`、`device:*` | `ControlPanel`、`DeviceSelector`、opened capture preview | capture / workbench smoke |
| Conversation | `ConversationService`、`DebuggerRuntime.requestStartFromConversation` | `ConversationMessage`、`ConversationTurnResult` | `conversation:*`、`conversation:event` | `AgentChat`、composer glue | debugger plan intake smoke |
| Debugger Workflow | `DebuggerRuntime`、`DebugWorkflowService` 内部执行服务、`RunExecutionService`、`WorkflowProjectionPublisher` | `WorkflowState`、`DebugPlan`、`AskUserPrompt`、`HarnessTask` | `workflow:*` | `PlanIntakePanel`、`WorkflowPanel`、`ControlPanel` | `debugger-runtime-contract.spec.ts`、`debugger-plan-intake.spec.ts` |
| Agent Runner | `AgentRunnerPort`、`AgentRunnerRegistry`、`OpenAiAgentSdkAdapter`、`ClaudeAgentSdkAdapter` | `LLMConfig`、`ToolCatalog`、`ToolCallResult` | 经 workflow stage 内部调用，不公开 workflow 旁路 | Agent timeline、conversation stream | runtime/SDK smoke |
| Tools | `ToolBridge`、`ToolBridgeAgentToolPort`、`src/main/tools/` | `ToolCatalog`、`ToolCallResult`、`ToolRuntimeSummary` | `tool:*`、`tool:executionComplete` | capabilities panel、Activity | tool smoke / workflow smoke |
| Evidence / Reports | `EvidenceLedger`、`ArtifactStore`、`ReportBundleService`、`src/main/reports/` | `ActionEvent`、`ArtifactRecord`、`Report` | `evidence:*` | `EvidencePanel`、artifact/report views | workflow/report smoke |
| Settings / Profile / LLM | `SettingsService`、`SecretStorageService`、`LLMAdapter`、`DebuggerLlmService`、`src/main/settings/` | `AppSettings`、`LLMConfig`、`LlmProviderEntry` | `settings:*`、`llm:*`、`app:selectAvatar` | `SettingsModal`、`UserMenu` | `settings-persistence.spec.ts` |
| Runtime / Terminal | `RuntimeLogService`、`TerminalSessionService`、`src/main/runtime/` | `RuntimeLogEntry`、`TerminalTabRecord` | `runtimeLog:*`、`terminal:*` | `TerminalDrawer`、Activity | terminal / workbench smoke |
| Browser fallback | `src/renderer/platform/browserElectronApi.ts`、`browserElectronApiDomains.ts` | `ElectronAPI` | fallback implementation | browser preview / static smoke | browser fallback smoke |

## 新增或调整功能的触点

新增跨层能力时，按顺序检查：

1. `src/shared/types/*` 是否已有契约，是否需要增加字段或子类型。
2. `src/main/ipc/channels.ts` 是否需要登记 channel 所属域。
3. `src/main/ipc/*Handlers.ts` 是否有对应 handler 注册位置。
4. `src/preload/index.ts` 与 `src/preload/api/*` 是否保持 `window.electronAPI` 公开形状。
5. `src/renderer/platform/browserElectronApi.ts` 是否需要 fallback。
6. 对应 UI 入口是否完整，测试定位符是否保持。
7. 文档是否需要同步 `overview.md`、`data-flow.md` 或本文。

## 热点拆分路线

| 热点文件 | 当前问题 | 拆分方向 | 约束 |
| --- | --- | --- | --- |
| `src/main/ipc/handlers.ts` | 多个 API 域集中注册 | 按 shell、conversation、workflow、session、capture、settings、tool、runtime 分 handler 模块 | 保持 channel 名不变 |
| `src/main/services/DebugWorkflowService.ts` | plan/intake、approval、execution、report、LLM parsing 仍较集中 | 保持为 `DebuggerRuntime` 内部执行服务，继续向 `workflow/debugger/*` 拆 stage worker / validator / projection | 不恢复公开入口，不改阶段和工具行为 |
| `src/renderer/App.tsx` | shell layout、hydration、事件订阅、composer glue 集中 | 拆 `renderer/shell`、`features/debugger`、无副作用 patterns | DOM/CSS/test id 保真 |
| `src/renderer/platform/browserElectronApi.ts` | 浏览器 fallback 覆盖多个 API 域 | 按 API 域拆 builder，保留总 fallback | 浏览器预览数据完整 |
| `src/shared/types/electron.ts` | 单一总接口可读性弱 | 保持总接口，补按域类型导出 | 不删除现有类型 |

## 验证入口

- 静态：`npm run typecheck`
- 构建：`npm run build`
- 关键 E2E：
  - `npm run test:e2e -- debugger-plan-intake.spec.ts`
  - `npm run test:e2e -- session-lifecycle.spec.ts`
  - `npm run test:e2e -- settings-persistence.spec.ts`
  - `npm run test:e2e -- workbench-visual.spec.ts`

运行 Electron E2E 前必须先执行 `npm run build`，因为 E2E 启动的是 `out/main/index.js` 与 `out/renderer`。
