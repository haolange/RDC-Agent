# 工作区 API

<cite>
**本文引用的文件**
- [workbenchHandlers.ts](file://src/main/ipc/workbenchHandlers.ts)
- [projectSessionHandlers.ts](file://src/main/ipc/projectSessionHandlers.ts)
- [planHandlers.ts](file://src/main/ipc/planHandlers.ts)
- [conversationHandlers.ts](file://src/main/ipc/conversationHandlers.ts)
- [ProjectWorkspaceStore.ts](file://src/main/sessions/ProjectWorkspaceStore.ts)
- [PlanReviewStateStore.ts](file://src/main/sessions/PlanReviewStateStore.ts)
- [sessionPlanReference.ts](file://src/main/sessions/sessionPlanReference.ts)
- [planFilePersistence.ts](file://src/main/sessions/planFilePersistence.ts)
- [ConversationPlanReviewEvents.ts](file://src/main/conversation/ConversationPlanReviewEvents.ts)
- [ReadFileTool.ts](file://src/main/agent-runtime/tools/primitives/ReadFileTool.ts)
- [WriteFileTool.ts](file://src/main/agent-runtime/tools/primitives/WriteFileTool.ts)
- [MoveFileTool.ts](file://src/main/agent-runtime/tools/file/MoveFileTool.ts)
- [workflowHandlers.ts](file://src/main/ipc/workflowHandlers.ts)
- [usePlanReviewActions.ts](file://src/renderer/features/transcript/usePlanReviewActions.ts)
- [projectStore.ts](file://src/renderer/stores/projectStore.ts)
- [workflowStore.ts](file://src/renderer/stores/workflowStore.ts)
- [sessionSwitchHygiene.ts](file://src/renderer/stores/sessionSwitchHygiene.ts)
- [storesReset.ts](file://src/renderer/app/storesReset.ts)
- [planReview.ts](file://src/shared/types/planReview.ts)
- [conversation.ts](file://src/shared/types/conversation.ts)
</cite>

## 更新摘要
**变更内容**
- 新增计划审查功能：完整的计划读取、保存、导出与审批令牌机制
- 扩展 IPC 接口：新增 plan:read、plan:issueApprovalToken、plan:saveToProject、plan:export 等通道
- 增强对话能力：新增 conversation:answerPlanReview 方法支持计划审批响应
- 新增状态管理：PlanReviewStateStore 提供计划审查状态的持久化存储
- 完善安全机制：计划文件写入的权限验证、路径校验与原子写保障

## 目录
1. [简介](#简介)
2. [项目结构](#项目结构)
3. [核心组件](#核心组件)
4. [架构总览](#架构总览)
5. [详细组件分析](#详细组件分析)
6. [依赖关系分析](#依赖关系分析)
7. [性能考量](#性能考量)
8. [故障排查指南](#故障排查指南)
9. [结论](#结论)
10. [附录](#附录)

## 简介
本参考文档面向"工作区 API"，覆盖与项目、会话、运行以及界面状态相关的主要操作方法，包括：
- 项目文件操作（读取、写入、移动等）
- 会话管理（创建、选择、重命名、删除、输入资源导入刷新）
- **计划审查功能**（计划读取、审批令牌、保存到项目、导出文件）
- 运行生命周期（列表、状态变更广播）
- 界面状态控制（渲染端 store 重置与切换卫生）

文档提供每个方法的参数类型、返回值与异步行为说明，并给出完整示例、错误处理模式与性能优化建议。

## 项目结构
工作区能力由主进程 IPC 层统一暴露，后端通过存储适配器与持久化层交互，前端通过 Electron IPC 调用并更新本地 store。关键入口与职责如下：
- 主进程 IPC 组合根：注册所有领域处理器，维护当前工作区上下文（项目、会话、运行）。
- 项目与会话处理器：提供项目 CRUD、会话 CRUD、运行列表等能力。
- **计划审查处理器**：提供计划文件的读取、审批令牌发放、保存到项目和导出功能。
- 工作区存储：负责项目注册表、选择态、输入资源扫描与导入。
- **计划审查状态存储**：管理计划审查的生命周期状态，包括等待、批准、拒绝和替代状态。
- Agent 工具：提供工作区内文件读写的细粒度能力，带权限与大小限制。
- 渲染端 Store：维护项目、会话、工作流等 UI 状态，并在切换时执行清理与激活。

```mermaid
graph TB
subgraph "主进程"
A["IPC 组合根<br/>workbenchHandlers.ts"]
B["项目与会话处理器<br/>projectSessionHandlers.ts"]
C["计划审查处理器<br/>planHandlers.ts"]
D["工作区存储<br/>ProjectWorkspaceStore.ts"]
E["计划审查状态存储<br/>PlanReviewStateStore.ts"]
F["Agent 文件工具<br/>Read/Write/Move"]
G["工作流处理器<br/>workflowHandlers.ts"]
H["对话处理器<br/>conversationHandlers.ts"]
end
subgraph "渲染端"
I["项目 Store<br/>projectStore.ts"]
J["工作流 Store<br/>workflowStore.ts"]
K["计划审查动作<br/>usePlanReviewActions.ts"]
L["会话切换卫生<br/>sessionSwitchHygiene.ts"]
M["应用级重置<br/>storesReset.ts"]
end
A --> B
A --> C
A --> G
A --> H
B --> D
C --> E
C --> D
F --> D
G --> D
H --> D
A -.IPC 事件.-> I
A -.IPC 事件.-> J
K --> A
L --> I
L --> J
M --> I
M --> J
```

**图表来源**
- [workbenchHandlers.ts:260-283](file://src/main/ipc/workbenchHandlers.ts#L260-L283)
- [planHandlers.ts:66-122](file://src/main/ipc/planHandlers.ts#L66-L122)
- [PlanReviewStateStore.ts:40-99](file://src/main/sessions/PlanReviewStateStore.ts#L40-L99)
- [conversationHandlers.ts:174-180](file://src/main/ipc/conversationHandlers.ts#L174-L180)

**章节来源**
- [workbenchHandlers.ts:260-283](file://src/main/ipc/workbenchHandlers.ts#L260-L283)
- [planHandlers.ts:66-122](file://src/main/ipc/planHandlers.ts#L66-L122)
- [PlanReviewStateStore.ts:40-99](file://src/main/sessions/PlanReviewStateStore.ts#L40-L99)

## 核心组件
- 工作区存储 ProjectWorkspaceStore
  - 职责：初始化工作区、项目注册表读写、选择态管理、输入资源扫描与导入、路径解析与元数据写入。
  - 关键点：原子写、目录锁、预算限制（深度/条目数）、规范化路径。
- IPC 组合根 workbenchHandlers
  - 职责：注册各域处理器、维护当前项目/会话/运行上下文、广播事件到渲染端。
- 项目与会话处理器 projectSessionHandlers
  - 职责：项目与会话的增删改查、输入资源导入/刷新、运行列表查询、会话选择恢复。
- **计划审查处理器 planHandlers**
  - 职责：计划文件读取、审批令牌发放、保存到项目、导出文件，包含权限验证与安全检查。
- **计划审查状态存储 PlanReviewStateStore**
  - 职责：管理计划审查的生命周期状态，支持开始修订、标记决策、状态持久化。
- Agent 文件工具 Read/Write/Move
  - 职责：在工作区范围内安全地读取/写入/移动文件，包含大小限制、权限标记与失败关闭策略。
- 工作流处理器 workflowHandlers
  - 职责：获取工作流状态、恢复中断运行、停止运行等。
- 对话处理器 conversationHandlers
  - 职责：发送消息、分支切换、历史获取、附件预览、**计划审批响应**。
- 渲染端 Store 与切换卫生
  - 职责：维护项目/会话/工作流等 UI 状态；在会话切换时进行清理与激活；应用级重置用于新用例或测试。

**章节来源**
- [ProjectWorkspaceStore.ts:15-510](file://src/main/sessions/ProjectWorkspaceStore.ts#L15-L510)
- [workbenchHandlers.ts:260-283](file://src/main/ipc/workbenchHandlers.ts#L260-L283)
- [planHandlers.ts:66-122](file://src/main/ipc/planHandlers.ts#L66-L122)
- [PlanReviewStateStore.ts:40-99](file://src/main/sessions/PlanReviewStateStore.ts#L40-L99)
- [conversationHandlers.ts:174-180](file://src/main/ipc/conversationHandlers.ts#L174-L180)

## 架构总览
工作区 API 采用"主进程 IPC + 存储适配 + Agent 工具"的分层设计。IPC 层仅做参数校验、上下文管理与事件广播；业务逻辑下沉至存储与工具层；渲染端通过 store 订阅变化并驱动 UI。

```mermaid
sequenceDiagram
participant UI as "渲染端 UI"
participant IPC as "主进程 IPC"
participant PS as "项目与会话处理器"
participant PH as "计划审查处理器"
participant WS as "工作区存储"
participant PRS as "计划审查状态存储"
participant AG as "Agent 文件工具"
participant WF as "工作流处理器"
UI->>IPC : "project : list / session : create / run : list"
IPC->>PS : 转发请求(参数校验)
PS->>WS : 读取/写入项目与会话数据
WS-->>PS : 返回结果
PS-->>IPC : 封装响应
IPC-->>UI : 返回数据/触发事件
UI->>IPC : "plan : read / issueApprovalToken"
IPC->>PH : 计划审查请求
PH->>PRS : 读取计划状态
PH->>WS : 访问计划文件
PRS-->>PH : 返回状态
WS-->>PH : 返回计划内容
PH-->>IPC : 返回计划信息
IPC-->>UI : 设置计划审查 UI
UI->>IPC : "conversation : answerPlanReview"
IPC->>IPC : 处理审批响应
IPC-->>UI : 更新计划状态
UI->>IPC : "read_file / write_file / move_file"
IPC->>AG : 调用工具(权限/大小限制)
AG-->>IPC : 返回结果
IPC-->>UI : 返回结果/触发事件
UI->>IPC : "workflow : getState"
IPC->>WF : 获取工作流状态
WF-->>IPC : 返回状态
IPC-->>UI : 设置工作流 store
```

**图表来源**
- [planHandlers.ts:67-122](file://src/main/ipc/planHandlers.ts#L67-L122)
- [PlanReviewStateStore.ts:49-87](file://src/main/sessions/PlanReviewStateStore.ts#L49-L87)
- [conversationHandlers.ts:174-180](file://src/main/ipc/conversationHandlers.ts#L174-L180)
- [projectSessionHandlers.ts:69-403](file://src/main/ipc/projectSessionHandlers.ts#L69-L403)

## 详细组件分析

### 项目与会话管理（IPC 方法）
- 项目
  - project:list
    - 参数：无
    - 返回：{ projects: ProjectRecord[] }
    - 异步：否
  - project:add
    - 参数：{ rootPath: string }
    - 返回：{ success: boolean, project?: ProjectRecord, error?: string }
    - 异步：是
  - project:select
    - 参数：{ projectId: string }
    - 返回：{ success: boolean, project?: ProjectRecord, currentSession?: SessionRecord, currentRun?: RunSummary, error?: string }
    - 异步：是
  - project:rename
    - 参数：{ projectId: string, newName: string }
    - 返回：{ success: boolean, project?: ProjectRecord, error?: string }
    - 异步：否
  - project:remove
    - 参数：{ projectId: string }
    - 返回：{ success: boolean, error?: string }
    - 异步：是
  - project:inputs:list
    - 参数：{ projectId: string }
    - 返回：{ inputs: ProjectInputRecord[] }
    - 异步：是
  - project:inputs:refresh
    - 参数：{ projectId: string }
    - 返回：{ inputs: ProjectInputRecord[] }
    - 异步：是
  - project:inputs:import
    - 参数：{ projectId: string }
    - 返回：{ success: boolean, inputs: ProjectInputRecord[], error?: string }
    - 异步：是
  - project:inputs:importPaths
    - 参数：{ projectId: string, filePaths: string[] }
    - 返回：{ success: boolean, inputs: ProjectInputRecord[], error?: string }
    - 异步：是

- 会话
  - session:list
    - 参数：{ projectId?: string }
    - 返回：{ sessions: SessionRecord[] }
    - 异步：是
  - session:create
    - 参数：{ projectId: string, title: string }
    - 返回：{ success: boolean, session?: SessionRecord, error?: string }
    - 异步：是
  - session:rename
    - 参数：{ id: string, title: string }
    - 返回：{ success: boolean, session?: SessionRecord, error?: string }
    - 异步：是
  - session:remove
    - 参数：{ id: string }
    - 返回：{ success: boolean, nextSession?: SessionRecord, nextRun?: RunSummary, error?: string }
    - 异步：是
  - session:select
    - 参数：{ id: string }
    - 返回：{ success: boolean, session?: SessionRecord, currentRun?: RunSummary, error?: string }
    - 异步：是
  - session:setModelOverride
    - 参数：{ id: string, modelOverride?: { providerId: string, modelId: string } }
    - 返回：{ success: boolean, session?: SessionRecord, error?: string }
    - 异步：是
  - session:setAgentId
    - 参数：{ id: string, agentId: string }
    - 返回：{ success: boolean, session?: SessionRecord, error?: string }
    - 异步：是

- 运行
  - run:list
    - 参数：{ sessionId: string }
    - 返回：{ runs: RunSummary[] }
    - 异步：是

- 工作流
  - workflow:getState
    - 参数：无
    - 返回：WorkflowState | null
    - 异步：是

- 对话
  - conversation:sendMessage
    - 参数：ConversationSendRequest
    - 返回：ConversationSendResult
    - 异步：是
  - **conversation:answerPlanReview**
    - 参数：{ sessionId?, turnId: string, toolCallId: string, decision: PlanReviewDecision }
    - 返回：{ success: boolean, error?: string }
    - 异步：是

**章节来源**
- [projectSessionHandlers.ts:69-403](file://src/main/ipc/projectSessionHandlers.ts#L69-L403)
- [workflowHandlers.ts:18-33](file://src/main/ipc/workflowHandlers.ts#L18-L33)
- [conversationHandlers.ts:174-180](file://src/main/ipc/conversationHandlers.ts#L174-L180)

### 计划审查管理（新增功能）
- 计划读取
  - plan:read
    - 参数：{ planId: string, revision: number, sessionId: string, uri: string, expectedHash: string }
    - 返回：{ markdown: string, uri: string, hash: string }
    - 异步：是
    - 行为：从会话历史中验证计划引用，读取对应的 Markdown 内容
- 审批令牌
  - plan:issueApprovalToken
    - 参数：{ planId, revision, sessionId, uri, expectedHash, action: 'plan.saveToProject' | 'plan.export' }
    - 返回：{ token?: string, targetPath?: string, cancelled?: boolean, error?: string }
    - 异步：是
    - 行为：验证当前会话权限，显示确认对话框，生成一次性审批令牌
- 保存到项目
  - plan:saveToProject
    - 参数：{ ...PlanReadRequest, approvalToken: string }
    - 返回：{ success: boolean, path?: string, error?: string }
    - 异步：是
    - 行为：验证审批令牌，将计划保存到项目 plans 目录，添加 YAML frontmatter
- 导出文件
  - plan:export
    - 参数：{ ...PlanReadRequest, targetPath: string, approvalToken: string }
    - 返回：{ success: boolean, path?: string, error?: string }
    - 异步：是
    - 行为：验证审批令牌，将计划导出到指定路径

**章节来源**
- [planHandlers.ts:67-122](file://src/main/ipc/planHandlers.ts#L67-L122)
- [planReview.ts:59-96](file://src/shared/types/planReview.ts#L59-L96)

### 计划审查状态管理（新增功能）
- beginRevision
  - 作用：开始新的计划修订周期，生成新的 planId 或递增 revision
  - 参数：sessionId: string
  - 返回：{ planId: string, revision: number, newCycle: boolean }
  - 异步：否
- markDecision
  - 作用：标记计划审查决策（批准或拒绝），冻结计划内容
  - 参数：sessionId: string, status: 'approved' | 'rejected', extras?: { approvedHash?, frozenUri?, approvedHandoff? }
  - 返回：PlanReviewStateDocument
  - 异步：否
- read
  - 作用：读取会话的计划审查状态
  - 参数：sessionId: string
  - 返回：PlanReviewStateDocument | null
  - 异步：否

**章节来源**
- [PlanReviewStateStore.ts:54-87](file://src/main/sessions/PlanReviewStateStore.ts#L54-L87)

### 工作区存储（ProjectWorkspaceStore）
- initializeWorkspace
  - 作用：确保数据目录、项目目录、全局知识目录存在，恢复对话提交。
  - 异步：是
- listProjects
  - 作用：列出项目并按更新时间倒序排序。
  - 异步：否
- createProject
  - 作用：创建项目、构建资源布局、收集输入资源、写入元数据、设置当前项目。
  - 参数：rootPath: string
  - 返回：ProjectRecord
  - 异步：是
- renameProject / removeProject / getProjectById
  - 作用：重命名、删除、按 ID 查找项目。
  - 异步：否
- listProjectInputs / refreshProjectInputs / importProjectInputs
  - 作用：列举、刷新、导入 .rdc 输入资源；导入时复制文件并去重命名。
  - 异步：是
- getCurrentProjectId / setCurrentProjectId / getCurrentSessionId / setCurrentSessionId
  - 作用：读写选择态（项目/会话），保证一致性。
  - 异步：部分为是（会话选择）
- collectProjectInputs
  - 作用：递归扫描输入目录，限制最大深度与条目数，定期让出事件循环。
  - 异步：是
- 其他：registry/selection 读写、原子写、目录锁、路径规范化与元数据写入。

**章节来源**
- [ProjectWorkspaceStore.ts:15-510](file://src/main/sessions/ProjectWorkspaceStore.ts#L15-L510)

### Agent 文件工具（工作区文件操作）
- read_file
  - 参数：path: string, offset?: number, limit?: number
  - 返回：{ content: [{ type: 'text', text }], details: { path, totalLines, offset, limit, truncated } }
  - 行为：文本文件分段读取，二进制/.rdc/超大文件拒绝；支持中止信号。
  - 异步：是
- write_file
  - 参数：path: string, content: string
  - 返回：{ content: [{ type: 'text', text }], details: { path, bytesWritten, created, overwritten } }
  - 行为：父目录不存在则创建；内容大小受限；拒绝写入目录路径；可覆盖。
  - 异步：是
- move_file
  - 参数：source: string, destination: string
  - 返回：{ content: [{ type: 'text', text }], details: { source, destination, overwritten: false } }
  - 行为：目标已存在则拒绝；自动创建父目录；支持中止信号。
  - 异步：是

**章节来源**
- [ReadFileTool.ts:33-136](file://src/main/agent-runtime/tools/primitives/ReadFileTool.ts#L33-L136)
- [WriteFileTool.ts:27-95](file://src/main/agent-runtime/tools/primitives/WriteFileTool.ts#L27-L95)
- [MoveFileTool.ts:18-51](file://src/main/agent-runtime/tools/file/MoveFileTool.ts#L18-L51)

### 界面状态控制（渲染端）
- 会话切换卫生 applySessionSwitchHygiene
  - 作用：切换会话时清理对话、工作流、捕获、使用量快照等状态，并激活新会话。
  - 参数：previousSessionId?, nextSessionId?
  - 异步：否
- 应用级重置 resetWorkbenchStores
  - 作用：重置项目、会话、对话、证据、工作流、投影等 store，用于新建用例或测试。
  - 参数：无
  - 异步：否
- 计划审查动作 usePlanReviewActions
  - 作用：提供计划读取、复制到剪贴板、保存到项目、导出计划的前端操作封装。
  - 方法：readPlan, copyPlan, saveToProject, exportPlan
  - 异步：是
- 项目与工作流 Store
  - 作用：维护当前项目/会话、右侧面板目标、项目输入资源；工作流状态与呈现。
  - 异步：否（store 更新同步）

**章节来源**
- [sessionSwitchHygiene.ts:8-38](file://src/renderer/stores/sessionSwitchHygiene.ts#L8-L38)
- [storesReset.ts:11-40](file://src/renderer/app/storesReset.ts#L11-L40)
- [usePlanReviewActions.ts:5-35](file://src/renderer/features/transcript/usePlanReviewActions.ts#L5-L35)
- [projectStore.ts:25-98](file://src/renderer/stores/projectStore.ts#L25-L98)
- [workflowStore.ts:5-24](file://src/renderer/stores/workflowStore.ts#L5-L24)

## 依赖关系分析
- IPC 组合根依赖各域处理器，并通过 context 共享当前项目/会话/运行状态。
- 项目与会话处理器依赖存储适配器与持久化层（ProjectWorkspaceStore）。
- **计划审查处理器依赖计划审查状态存储、会话计划引用解析与文件持久化。**
- Agent 文件工具依赖文件系统与安全校验，受权限与大小限制约束。
- 渲染端 store 通过 IPC 事件与主进程保持同步；会话切换时执行清理与激活。

```mermaid
graph LR
WH["workbenchHandlers.ts"] --> PSH["projectSessionHandlers.ts"]
WH --> PH["planHandlers.ts"]
WH --> WFH["workflowHandlers.ts"]
WH --> CH["conversationHandlers.ts"]
PSH --> PWS["ProjectWorkspaceStore.ts"]
PH --> PRS["PlanReviewStateStore.ts"]
PH --> SPR["sessionPlanReference.ts"]
PH --> PFP["planFilePersistence.ts"]
PWS --> FS["文件系统"]
CH --> PWS
WFH --> PWS
RSP["renderer stores"] <-- IPC 事件 --> WH
UPRA["usePlanReviewActions.ts"] --> PH
```

**图表来源**
- [workbenchHandlers.ts:260-283](file://src/main/ipc/workbenchHandlers.ts#L260-L283)
- [planHandlers.ts:66-122](file://src/main/ipc/planHandlers.ts#L66-L122)
- [PlanReviewStateStore.ts:40-99](file://src/main/sessions/PlanReviewStateStore.ts#L40-L99)
- [sessionPlanReference.ts:11-33](file://src/main/sessions/sessionPlanReference.ts#L11-L33)
- [planFilePersistence.ts:8-43](file://src/main/sessions/planFilePersistence.ts#L8-L43)

**章节来源**
- [workbenchHandlers.ts:260-283](file://src/main/ipc/workbenchHandlers.ts#L260-L283)
- [planHandlers.ts:66-122](file://src/main/ipc/planHandlers.ts#L66-L122)
- [PlanReviewStateStore.ts:40-99](file://src/main/sessions/PlanReviewStateStore.ts#L40-L99)

## 性能考量
- 文件读取
  - 使用行窗口流式读取，避免整文件入内存；限制输出字节与行数，防止大文件阻塞。
- 输入资源扫描
  - 限制最大深度与条目数；每固定数量让出事件循环，避免长时间阻塞 UI。
- 原子写与目录锁
  - 注册表与选择态使用原子写与目录锁，减少并发竞争与损坏风险。
- **计划文件写入**
  - 使用原子写与 fsync 确保数据完整性，写入后验证内容一致性，失败时回滚。
- **计划引用验证**
  - 从持久化会话历史中解析计划引用，避免依赖可变状态，确保引用有效性。
- 会话切换
  - 切换时批量清理与激活，避免残留状态影响 UI；按需缓存与回灌。
- 工作流状态
  - 仅在必要时拉取与广播，减少不必要的数据传输。

## 故障排查指南
- 常见错误与定位
  - 项目不存在/路径无效：检查 project:select 与 createProject 的参数与返回值中的 error 字段。
  - 会话不存在/名称为空：检查 session:rename 与 session:select 的错误信息。
  - 文件写入失败：检查 write_file 的内容大小限制与目标是否为目录。
  - 文件移动冲突：move_file 对目标已存在会拒绝覆盖。
  - 输入资源导入失败：确认文件扩展名与路径有效性。
  - **计划引用无效**：PLAN_REFERENCE_DENIED - 检查 planId、revision、uri、expectedHash 是否匹配。
  - **计划状态缺失**：PLAN_REVIEW_STATE_MISSING - 检查会话是否存在计划审查状态。
  - **审批令牌无效**：PLAN_APPROVAL_TOKEN_INVALID - 检查令牌是否过期或被消费。
  - **计划路径无效**：PLAN_TARGET_INVALID - 检查目标路径是否为绝对路径且不是符号链接。
- 调试建议
  - 查看 IPC 返回值中的 success/error 字段。
  - 关注主进程日志与运行时日志（工具调用成功/失败、时长）。
  - 使用会话切换卫生与应用级重置恢复异常状态。
  - **检查计划审查状态文件**：位于会话目录下的 plan-state.json。
  - **验证计划文件完整性**：检查 plans 目录下的 plan.md 文件与 YAML frontmatter。

**章节来源**
- [projectSessionHandlers.ts:74-403](file://src/main/ipc/projectSessionHandlers.ts#L74-L403)
- [planHandlers.ts:48-122](file://src/main/ipc/planHandlers.ts#L48-L122)
- [PlanReviewStateStore.ts:73-95](file://src/main/sessions/PlanReviewStateStore.ts#L73-L95)
- [planFilePersistence.ts:8-43](file://src/main/sessions/planFilePersistence.ts#L8-L43)
- [sessionPlanReference.ts:11-33](file://src/main/sessions/sessionPlanReference.ts#L11-L33)

## 结论
工作区 API 以 IPC 为统一入口，结合稳健的存储层与安全的 Agent 工具，提供了完整的项目、会话、运行与文件操作能力。**新增的计划审查功能**通过完整的审批流程、状态管理和安全机制，确保了计划文件的可信性和可追溯性。通过严格的参数校验、权限与大小限制、原子写与目录锁，以及渲染端的会话切换卫生机制，确保了系统的可靠性与用户体验。建议在大规模文件操作与输入资源扫描中充分利用限流与让出机制，以获得更佳的性能表现。

## 附录

### 完整示例：文件浏览、会话切换与计划审查
- 文件浏览
  - 调用 read_file 指定路径与可选 offset/limit，获取分页文本内容；若 truncated 为真，继续读取后续片段。
- 会话切换
  - 调用 session:select 切换到目标会话；渲染端调用 applySessionSwitchHygiene 清理旧状态并激活新会话；根据返回的 currentRun 更新工作流 store。
- **计划审查流程**
  - 调用 plan:read 读取计划内容，验证哈希值确保完整性。
  - 调用 plan:issueApprovalToken 获取审批令牌，显示用户确认对话框。
  - 调用 plan:saveToProject 或 plan:export 执行计划保存或导出操作。
  - 调用 conversation:answerPlanReview 响应计划的审批请求。
- 界面更新
  - 监听 IPC 事件（如 workflow:runStatusChanged、project:inputsChanged）；在主进程广播后，渲染端更新对应 store（如 workflowStore、projectStore）。

```mermaid
sequenceDiagram
participant UI as "渲染端"
participant IPC as "主进程 IPC"
participant PH as "计划审查处理器"
participant PRS as "计划审查状态存储"
participant PS as "项目与会话处理器"
participant WS as "工作区存储"
participant AG as "Agent 文件工具"
UI->>IPC : "plan : read(planId, revision)"
IPC->>PH : 读取计划
PH->>PRS : 验证计划状态
PH->>WS : 读取计划文件
PRS-->>PH : 返回状态
WS-->>PH : 返回计划内容
PH-->>IPC : 返回计划信息
IPC-->>UI : 显示计划审查卡片
UI->>IPC : "plan : issueApprovalToken(action)"
IPC->>PH : 申请审批令牌
PH->>PH : 显示确认对话框
PH-->>IPC : 返回令牌
IPC-->>UI : 授权完成
UI->>IPC : "plan : saveToProject(token)"
IPC->>PH : 保存计划到项目
PH->>WS : 写入计划文件
WS-->>PH : 写入完成
PH-->>IPC : 返回保存结果
IPC-->>UI : 更新计划状态
UI->>IPC : "conversation : answerPlanReview(decision)"
IPC->>IPC : 处理审批响应
IPC-->>UI : 更新计划状态
```

**图表来源**
- [planHandlers.ts:67-122](file://src/main/ipc/planHandlers.ts#L67-L122)
- [PlanReviewStateStore.ts:54-87](file://src/main/sessions/PlanReviewStateStore.ts#L54-L87)
- [conversationHandlers.ts:174-180](file://src/main/ipc/conversationHandlers.ts#L174-L180)

### 计划审查状态流转
- 状态定义：awaiting（等待审批）、approved（已批准）、rejected（已拒绝）、superseded（被替代）
- 生命周期：beginRevision 开始新修订 -> awaiting 状态 -> 用户决策 -> approved/rejected 状态
- 冻结机制：批准时冻结计划内容，记录 approvedHash 和 frozenUri，确保不可篡改
- 版本管理：每次修订递增 revision 号，支持多版本计划并存

**章节来源**
- [planReview.ts:3-48](file://src/shared/types/planReview.ts#L3-L48)
- [PlanReviewStateStore.ts:54-87](file://src/main/sessions/PlanReviewStateStore.ts#L54-L87)