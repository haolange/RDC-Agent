# Module Map

| Domain | Main files | Shared contract | IPC/API surface | Renderer surface | Verification |
| --- | --- | --- | --- | --- | --- |
| Agentic Trace | `src/main/agent-trace/*`, `src/main/workflow/debugger/TraceStateStore.ts` | `AgentRunPresentation`, `TraceEvent`, `TraceNode`, `ProgressTask`, `TraceArtifactRecord`, `TraceContextRecord` | `trace:getRun`, `trace:getEvents`, `trace:getProjection`, `trace:exportRun`, `trace:switchBranch`, `trace:projectionChanged` | `features/right-rail/SessionRightRail`, Work Process transcript | typecheck, fidelity, browser-session smoke |
| Agent workbench | `src/main/workflow/debugger/AgentOrchestrator.ts`, `src/main/settings/AgentManifestService.ts`, `src/main/agent-runtime/*` | `.agent.md`, `AgentId`, `AgentManifestDefinition`, `WorkflowState`, `BUILTIN_AGENT_TOOL_IDS` / tool tokens | `conversation:sendMessage`, `agent:*`, `workflow:stop`, `workflow:getState`, `workflow:listRuns` | Composer, `features/transcript`, Settings > Agents, `features/right-rail` | typecheck, settings-agents, tool-system, browser smoke |
| RDC runtime boundary | `src/main/tools/RdcCliInvokerService.ts`, `ShellInvocationService.ts`, `src/main/sessions/RdcSessionRuntime.ts` | `RdcRuntimeContext`, `OpenedCaptureState`, `RdcTurnBinding` | `capture:openProjectInput`, `context:get`, `capture:refreshFrame`, `tool:getRuntimeSummary` | Settings > Tools, capture library, session context, Activity | typecheck, shell/browser smoke |
| Settings/provider system | `src/main/settings/*` | `AppSettings`, provider catalog, routes, `ToolingSettings` | settings IPC | Settings modal | typecheck, provider-system tests |
| Sessions/captures | `src/main/sessions/*`, `src/main/captures/*` | `SessionRecord`, `RunSummary`, `OpenedCaptureState` | project/session/capture IPC | project tree, capture library, opened capture panels | typecheck, shell smoke |
| Reports/evidence | `src/main/reports/*` | `ArtifactRecord`, `EvidencePacket`, diagnostics | report/evidence IPC | Activity, artifacts, trace cards | typecheck |

Rules:

- Cross-layer contracts belong in `src/shared`.
- Main-process domains may depend on shared types and adjacent main services.
- Renderer code reaches main capabilities only through preload APIs.
- RDC-Tool CLI installation details are Settings data. Lifecycle operations and their argument construction are fixed in the main session boundary.

## Renderer 职责地图

`app/WorkbenchShell` 组装 feature 与 shell；`app/bootstrap/useIpcEventBridge` 单点安装、释放 conversation、session、capture 和 shell 订阅，投影身份检查仍位于原业务边界。Command Palette 的快捷键与业务动作由 app controller 拥有，pattern 仅接收状态与回调。

| 产品区域 | Canonical 入口与职责 | 状态与验证 |
| --- | --- | --- |
| Composer | `features/composer/Composer` 编排；`ComposerEditor` 书写区、`ComposerFooter` 底栏、`ComposerPendingRequest` 待处理请求；专属样式按 shell/editor/toolbar/controls/requests/motion 归属 | `useComposer` 保持发送与草稿协调；request selector 保持审批优先级；IME、菜单、生命周期和请求测试就近维护 |
| Transcript | `features/transcript/index` 组装消息；`workProcess*Presentation`、`workProcessToolContent` 等按轨迹、内容解释和决策行分工；CSS 按实际消息部件拆分 | main-owned transcript 为权威；解析为纯函数；滚动与虚拟列表测试覆盖定位、离底与内容尺寸变化 |
| Right Rail | `features/right-rail/RightRail` → `SessionRightRail` → 各卡；Capture 保持专属交互 | `session-projection` / `right-rail` 门禁；五卡次序和空态不变 |
| Sidebar / Terminal | feature 入口与专属 hooks 负责业务；就近维护布局、行操作、输出、输入及状态样式 | 继续使用既有 project/session、terminal store，shell 只负责 drawer 与 resize |
| Settings / Knowledge / Onboarding | 各 feature 入口负责导航与页面；编辑任务复用 TaskDialog | 维持单一查询/选择事实源；异步失效、未保存离开、弹层焦点与教程生命周期就近验证 |
| Context / Material | `patterns/ContextBreakdownPopover`、`MaterialContextEditor` / `Viewer` 负责展示；Material 使用共享 TaskDialog | Context 展开值和写入回调由 Composer owner 提供；pattern 不写业务 store |

各 feature README 说明局部边界。`pnpm run test:coverage:renderer` 单独输出 renderer 覆盖统计；它不替代真实工作台验收，也不改变 main/shared coverage ratchet。全局 CSS 不承载 feature/pattern 专属选择器；AST 分层门禁检查静态导入、重导出、动态导入与 pattern store 写入。
