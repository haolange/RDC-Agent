# 数据流

本文记录当前 `RDC-Agent` 的端到端数据流。目标是让后续改动能先判断自己触碰哪条链，再决定需要同步更新哪些层。

## Project / Session / Run

```mermaid
flowchart LR
  Sidebar["Sidebar / App hydration"]
  ElectronAPI["electronAPI.project / session / run"]
  IPC["project:* / session:* / run:*"]
  RdxSession["RdxSessionService"]
  Storage["StorageAdapter"]
  Workspace["workspace root/projects"]
  RendererStore["renderer stores / App state"]

  Sidebar --> ElectronAPI
  ElectronAPI --> IPC
  IPC --> RdxSession
  RdxSession --> Storage
  Storage --> Workspace
  IPC --> RendererStore
```

关键触点：

- 共享类型：`ProjectRecord`、`SessionRecord`、`RunSummary`、`SessionOutputRecord`。
- 主进程入口：`src/main/ipc/handlers.ts`、`RdxSessionService`、`StorageAdapter`。
- 渲染入口：`src/renderer/App.tsx`、`Sidebar`、`sessionStore`。
- 测试入口：`session-lifecycle.spec.ts`。

## Capture / Replay Device

```mermaid
sequenceDiagram
  participant UI as "ControlPanel / Capture Library"
  participant API as "electronAPI.capture / device"
  participant IPC as "capture:* / device:*"
  participant Session as "RdxSessionService"
  participant Device as "ReplayDeviceService"
  participant Context as "ContextService"
  participant Tool as "ToolBridge"

  UI->>API: device.list / capture.openProjectInput
  API->>IPC: IPC invoke
  IPC->>Device: resolve replay device
  IPC->>Session: open project input
  Session->>Tool: prepare preview / tool metadata
  Session->>Context: update context snapshot
  IPC-->>UI: OpenedCaptureState / ContextSnapshot
```

关键触点：

- 工具链边界保持为 `ToolBridge -> resources/tools/rdx.bat`。
- capture preview 依赖 `OpenedCaptureState`，不要只改 UI 展示而不改共享类型。
- 关键回归包括 opened capture preview、capture library、device selector。

## Debugger Workflow

```mermaid
flowchart TB
  Intake["Plan / Intake"]
  Questions["AskUserQuestion"]
  Approval["Approval"]
  Execution["Execution loop"]
  Verification["Verification / skeptic"]
  Curator["Curator / report"]
  AgentRunner["AgentRunnerPort / SDK adapter"]
  Projection["WorkflowProjectionPublisher"]
  Evidence["EvidenceLedger / ArtifactStore"]
  Activity["RuntimeLogService"]
  UI["Debugger UI"]

  Intake --> Questions
  Questions --> Approval
  Approval --> Execution
  Execution --> AgentRunner
  Execution --> Verification
  Verification --> Curator
  Execution --> Evidence
  Curator --> Evidence
  Evidence --> Projection
  Execution --> Activity
  Projection --> UI
  Activity --> UI
```

关键触点：

- 唯一顶层入口：`src/main/workflow/debugger/DebuggerRuntime.ts`。
- `DebugWorkflowService` 是 Runtime 内部执行服务，不再作为 IPC、conversation 或公开 workflow barrel 的入口。
- `WorkflowProjectionPublisher` 统一广播 `workflow:*`、`evidence:eventAdded`、`conversation:event` 等投影事件；Runtime 和 agent runner 不直接持有窗口引用。
- OpenAI / Claude Agent SDK 通过 `AgentRunnerPort` 运行，工具能力由 Runtime policy 生成 allowlist，再经 `AgentToolPort -> ToolBridge` 执行。
- 不新增阶段，不改变 Debugger harness 状态机，不把 Analyzer / Optimizer 并入该主链。

## Conversation

```mermaid
sequenceDiagram
  participant Composer as "Composer"
  participant API as "electronAPI.conversation"
  participant IPC as "conversation:*"
  participant Service as "ConversationService"
  participant Runtime as "DebuggerRuntime"
  participant Store as "StorageAdapter"

  Composer->>API: sendMessage()
  API->>IPC: conversation:sendMessage
  IPC->>Service: sendMessage with fallback project/session/run
  Service->>Runtime: requestStartFromConversation()
  Service->>Store: persist messages
  Service-->>API: ConversationTurnResult
  API-->>Composer: render patched/completed events
```

关键触点：

- 流事件：`conversation:event`。
- 类型：`ConversationMessage`、`ConversationTurnResult`、`ConversationStreamEvent`。
- UI 入口：`AgentChat`、composer glue、`App.tsx`。

## Settings / Provider / Model Route

```mermaid
flowchart LR
  SettingsUI["SettingsModal"]
  API["electronAPI.settings / llm"]
  IPC["settings:* / llm:*"]
  SettingsSvc["SettingsService"]
  AccountAuth["ProviderAccountAuthService"]
  SDK["AgentRunnerPort / OpenAI / Claude SDK adapter"]
  Adapter["LLMAdapter"]
  DebuggerLLM["DebuggerLlmService"]
  Secrets["SecretStorageService"]
  Workspace["workspace root/settings + secrets"]

  SettingsUI --> API
  API --> IPC
  IPC --> SettingsSvc
  IPC --> AccountAuth
  AccountAuth --> Secrets
  AccountAuth --> SettingsSvc
  SettingsSvc --> Secrets
  SettingsSvc --> Workspace
  IPC --> SDK
  SDK --> Adapter
  Adapter --> DebuggerLLM
```

凭据来源由 provider auth mode 决定。API Key provider 存储 provider-scoped key；账号登录 provider 通过 `ProviderAccountAuthService` 自研 OAuth/device-flow 获取 token bundle，`settings.json` 只保存账号摘要、状态和模型列表；Bedrock/Vertex 这类 environment provider 不保存密钥，只把运行环境凭据交给 SDK adapter 使用。SDK adapter 内部可以向 SDK 注入 key、client 或环境凭据信号，但不能把裸 `OPENAI_API_KEY` / `ANTHROPIC_API_KEY` 作为 RDC-Agent 的通用配置来源。

模型列表也属于 settings 边界。标准 Provider 通过真实 `/models` 或等价接口发现模型；没有标准模型列表的 Anthropic-compatible / Azure endpoint 只能保存逐候选轻量请求验证成功的模型；OAuth 账号登录如果模型发现失败或返回空列表，必须保持未配置并向 UI 返回错误，不能保存 fallback 模型。renderer 二次打开 API Key detail 时只接收 `hasStoredSecret` 状态并显示固定星号占位，不能读取已存明文密钥。

## ToolBridge / Evidence / Runtime Log

```mermaid
sequenceDiagram
  participant Runtime as "DebuggerRuntime"
  participant Agent as "AgentRunnerPort"
  participant Tool as "ToolBridge"
  participant RDX as "rdx.bat"
  participant Evidence as "EvidenceLedger / StorageAdapter"
  participant Runtime as "RuntimeLogService"
  participant Renderer as "Renderer event subscribers"

  Runtime->>Tool: execute(toolName, args)
  Agent->>Tool: execute allowed SDK tool calls
  Tool->>RDX: spawn RenderDoc tool
  RDX-->>Tool: result / artifact / error
  Tool-->>Runtime: ToolTraceEntry
  Tool-->>Agent: ToolCallResult
  Runtime->>Evidence: append action event / artifact
  Runtime->>Runtime: append Activity log
  Runtime-->>Renderer: runtime:logAppended
  Evidence-->>Renderer: evidence:eventAdded
```

关键触点：

- IPC：`tool:*`、`evidence:*`、`runtimeLog:*`。
- 类型：`ToolTraceEntry`、`ToolRuntimeSummary`、`ActionEvent`、`RuntimeLogEntry`。
- 不绕开 `ToolBridge` 直接在 renderer 调工具。
