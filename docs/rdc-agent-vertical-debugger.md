# RdcAgent 垂直框架实现计划

## Context

### 问题背景
原RDC-Agent框架设计精良，但在通用Agent平台（Claude-Code/Codex/Code-Buddy等）上执行时存在核心问题：
- **Harness控制不足**：更像"结尾审计器"而非"过程控制器"，问题直到final-audit才暴露
- **模式声明与执行脱节**：multi_agent被声明但无dispatch证据
- **证据链缺失**：action_chain.jsonl中tool_execution为0
- **workflow_stage漂移**：停留在accepted_intake_initialized却已完成调查

### 解决方案
构建垂直化DebugAgent桌面应用，将Harness控制从"事后审计"升级为"过程控制"，实现严格的状态机驱动和证据链闭环。`Debugger` 主链必须真实命中已绑定的 LLM provider/model；provider、secret、route、model、LLM request 任一环节无效都必须进入 blocker，不能 silent fallback 到 tool-only 路径。

### 技术选型
- **桌面框架**: Electron
- **前端框架**: React + TypeScript
- **状态管理**: Zustand
- **LLM集成**: 多服务商API（OpenRouter必须支持，另支持OpenAI/Anthropic/xAI/Kimi/Gemini等）
- **工具层**: 复用RDC-Agent-Tools（CLI优先，MCP可扩展）
- **存储**: 文件系统（JSON/YAML），与原框架一致

---

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                     Electron Application                        │
├─────────────────────────────────────────────────────────────────┤
│  Renderer (React)                                               │
│  ┌─────────────┐ ┌─────────────┐ ┌─────────────────────────────┐│
│  │  Debugger   │ │  Analyzer   │ │       Optimizer             ││
│  │  (首发)     │ │  (占位)     │ │       (占位)                ││
│  └─────────────┘ └─────────────┘ └─────────────────────────────┘│
│  ┌─────────────────────────────────────────────────────────────┐│
│  │              Workflow State Panel (实时状态)                 ││
│  └─────────────────────────────────────────────────────────────┘│
├─────────────────────────────────────────────────────────────────┤
│  Main Process (Node.js)                                         │
│  ┌──────────────┐ ┌──────────────┐ ┌──────────────────────┐    │
│  │  Workflow    │ │   Harness    │ │    LLM Adapter       │    │
│  │  Engine      │ │  Controller  │ │   (OpenRouter+)      │    │
│  └──────────────┘ └──────────────┘ └──────────────────────┘    │
│  ┌──────────────┐ ┌──────────────┐ ┌──────────────────────┐    │
│  │  Context     │ │  Evidence    │ │   Tool Bridge        │    │
│  │  Manager     │ │  Chain       │ │   (CLI/MCP)          │    │
│  └──────────────┘ └──────────────┘ └──────────────────────┘    │
├─────────────────────────────────────────────────────────────────┤
│  RDC-Agent-Tools (复用现有实现)                                  │
│  ┌──────────────┐ ┌──────────────┐ ┌──────────────────────┐    │
│  │  CLI Entry   │ │  MCP Entry   │ │    rd.* Tools        │    │
│  └──────────────┘ └──────────────┘ └──────────────────────┘    │
└─────────────────────────────────────────────────────────────────┘
```

---

## Module Design

### 1. 前端模块 (src/renderer/)

```
src/renderer/
├── App.tsx
├── pages/
│   ├── Debugger/           # 首发实现
│   │   ├── index.tsx
│   │   ├── components/
│   │   │   ├── ConversationArea.tsx
│   │   │   ├── ToolOutputArea.tsx
│   │   │   ├── UserInputArea.tsx
│   │   │   └── WorkflowHeader.tsx
│   │   └── hooks/
│   ├── Analyzer/           # 占位
│   └── Optimizer/          # 占位
├── components/
│   ├── WorkflowPanel/      # 工作流状态面板
│   ├── AgentChat/          # Agent对话组件
│   ├── EvidencePanel/      # 证据链面板
│   └── ArtifactViewer/     # Artifact查看器
├── stores/
│   ├── workflowStore.ts    # 工作流状态
│   ├── evidenceStore.ts    # 证据状态
│   ├── settingsStore.ts    # 设置状态
│   └── conversationStore.ts
└── hooks/
    ├── useWorkflow.ts
    ├── useEvidence.ts
    └── useToolCall.ts
```

### 2. 后端模块 (src/main/)

```
src/main/
├── index.ts
├── ipc/
│   ├── handlers.ts
│   ├── workflow.ts
│   ├── tools.ts
│   └── llm.ts
├── services/
│   ├── WorkflowEngine.ts       # 工作流状态机（带受控回转）
│   ├── HarnessController.ts    # 过程控制器（前置Gate）
│   ├── ContextManager.ts       # Context统一管理
│   ├── EvidenceChain.ts        # 证据链记录与验证
│   ├── ToolBridge.ts           # 工具层桥接
│   └── AgentOrchestrator.ts    # Agent编排
└── adapters/
    ├── LLMAdapter.ts           # LLM统一适配
    ├── providers/
    │   ├── OpenRouterProvider.ts  # 必须
    │   ├── OpenAIProvider.ts
    │   ├── AnthropicProvider.ts
    │   ├── GeminiProvider.ts
    │   ├── KimiProvider.ts
    │   └── XAIProvider.ts
    ├── ToolAdapter.ts
    └── StorageAdapter.ts
```

### 3. 共享类型 (src/shared/)

```
src/shared/
├── types/
│   ├── workflow.ts          # WorkflowStage, WorkflowState
│   ├── evidence.ts          # ActionEvent, EvidenceChain
│   ├── llm.ts               # LLMMessage, LLMRequest, LLMResponse
│   ├── tool.ts              # ToolDefinition, ToolResult
│   └── agent.ts             # AgentRole, AgentState, AgentConfig
├── constants/
│   ├── stages.ts            # 12阶段常量
│   ├── blockers.ts          # 阻断码
│   └── agents.ts            # Agent角色定义
└── utils/
    ├── yaml.ts
    ├── jsonl.ts
    └── id.ts
```

---

## Core Improvements

### 1. Harness Controller改进（过程控制）

**从"结尾审计"到"过程控制"**:

```
┌─────────────────────────────────────────────────────────────────┐
│                 Harness Controller (过程控制模式)                │
├─────────────────────────────────────────────────────────────────┤
│  Pre-Gate Layer (前置Gate层)                                    │
│  ┌────────────┐ ┌────────────┐ ┌────────────┐ ┌────────────┐  │
│  │ EntryGate  │ │ IntakeGate │ │DispatchGate│ │ VerifyGate │  │
│  │ - .rdc检查 │ │ - 完整性   │ │ - 模式一致 │ │ - Schema   │  │
│  │ - fix_ref  │ │ - 参照契约 │ │ - 证据支撑 │ │ - 语义层   │  │
│  └────────────┘ └────────────┘ └────────────┘ └────────────┘  │
├─────────────────────────────────────────────────────────────────┤
│  Runtime Monitor Layer (运行时监控层)                           │
│  ┌─────────────────┐  ┌─────────────────┐                      │
│  │ Mode Consistency│  │ Stage Progress  │                      │
│  │ Checker         │  │ Tracker         │                      │
│  └─────────────────┘  └─────────────────┘                      │
│  ┌─────────────────┐  ┌─────────────────┐                      │
│  │ Tool Execution  │  │ Blocker Early   │                      │
│  │ Wrapper         │  │ Detection       │                      │
│  └─────────────────┘  └─────────────────┘                      │
├─────────────────────────────────────────────────────────────────┤
│  Final Audit Layer (只做Schema校验和存在性确认)                 │
└─────────────────────────────────────────────────────────────────┘
```

**关键改进点**:

| 原问题 | 新方案 |
|--------|--------|
| multi_agent声明无执行证据 | DispatchGate在dispatch时校验证据 |
| Stage漂移 | StageProgressTracker自动校验并推进 |
| tool_execution未写入 | ToolExecutionWrapper强制包装写入 |
| blocker暴露晚 | detectEarlyBlockers()实时检测 |
| skeptic/curator缺席 | SkepticGate/CuratorGate前置 |

### 2. 工作流状态机改进（带受控回转）

**新增阶段**:
- `validation_blocked`: 发现blocker时进入，允许写报告但不可strict finalize
- `awaiting_user_input`: 需要用户补充信息时进入

**回转规则**:

| 触发条件 | 从 | 到 | 最大重试 | 需用户确认 |
|----------|------|------|----------|------------|
| specialist_timeout | waiting_for_specialist_brief | waiting_for_specialist_brief | 3 | 否 |
| skeptic_rejected | specialist_briefs_collected | waiting_for_specialist_brief | 2 | 是 |
| triage_low_confidence | intake_gate_passed | intent_gate_passed | 1 | 是 |
| blocker_detected | any | validation_blocked | - | 否 |

### 3. Agent配置系统

**每个Agent独立配置**:

```typescript
interface AgentConfig {
  agentId: AgentRole;
  systemPrompt: string;        // 可自定义System Prompt
  modelProvider: string;       // openrouter, openai, anthropic, etc.
  modelName: string;           // 具体模型名称
  temperature?: number;
  maxTokens?: number;
}

// 默认模型路由建议
const DEFAULT_MODEL_ROUTING = {
  'rdc-debugger': { provider: 'openrouter', model: 'anthropic/claude-3-opus' },  // 规划监控
  'triage_agent': { provider: 'openrouter', model: 'anthropic/claude-3-sonnet' },
  'pixel_forensics_agent': { provider: 'openrouter', model: 'google/gemini-pro-1.5' },  // 多模态
  'shader_ir_agent': { provider: 'openrouter', model: 'anthropic/claude-3-sonnet' },
  'skeptic_agent': { provider: 'openrouter', model: 'openai/gpt-4o' },  // 审查
  'curator_agent': { provider: 'openrouter', model: 'anthropic/claude-3-sonnet' },
};
```

---

## File Structure

```
RdcAgent/
├── package.json
├── tsconfig.json
├── electron-builder.json
├── src/
│   ├── main/                   # 主进程
│   ├── renderer/               # 渲染进程
│   ├── shared/                 # 共享类型
│   └── resources/              # 静态资源
├── resources/
│   └── tools/                  # RDC-Agent-Tools复制品
└── workspace/                  # 运行时工作区（与原框架兼容）
    ├── cases/
    └── common/
        ├── knowledge/
        ├── config/
        └── skills/
```

---

## Implementation Phases

### Phase 1: Core Framework (基础框架)
- [ ] Electron + React项目搭建
- [ ] TypeScript配置
- [ ] 基础目录结构
- [ ] IPC通信层

### Phase 2: Tool Integration (工具层集成)
- [ ] ToolAdapter实现（CLI子进程调用）
- [ ] 工具目录加载（tool_catalog.json）
- [ ] 基础工具调用与结果解析

### Phase 3: Storage Layer (存储层)
- [ ] StorageAdapter实现
- [ ] workspace目录结构创建
- [ ] YAML/JSONL读写工具

### Phase 4: Workflow Engine (工作流引擎)
- [ ] WorkflowEngine核心实现
- [ ] 12阶段状态机
- [ ] 受控回转逻辑（完整实现）
- [ ] HarnessController（前置Gate + 运行时监控）
- [ ] EvidenceChain管理

### Phase 5: LLM Integration (LLM集成)
- [ ] LLMAdapter核心
- [ ] OpenRouterProvider（必须）
- [ ] 其他Provider
- [ ] AgentOrchestrator
- [ ] Agent配置系统（System Prompt + Model选择）

### Phase 6: UI Implementation (UI实现)
- [ ] WorkflowPanel组件
- [ ] AgentChat组件
- [ ] EvidencePanel组件
- [ ] Debugger页面完整实现
- [ ] Analyzer/Optimizer占位页面

### Phase 7: Testing & Polish (测试与完善)
- [ ] 完整流程测试
- [ ] 错误处理优化
- [ ] 性能优化
- [ ] 打包与分发

---

## Key Files

### 需要新创建的核心文件
1. `RdcAgent/src/main/services/HarnessController.ts` - 过程控制Harness
2. `RdcAgent/src/main/services/WorkflowEngine.ts` - 带受控回转的状态机
3. `RdcAgent/src/main/adapters/LLMAdapter.ts` - LLM统一适配层
4. `RdcAgent/src/main/adapters/providers/OpenRouterProvider.ts` - OpenRouter适配
5. `RdcAgent/src/main/services/AgentOrchestrator.ts` - Agent编排器
6. `RdcAgent/src/renderer/components/WorkflowPanel/index.tsx` - 工作流状态面板

### 需要复用的原框架文件
1. `RDC-Agent-Tools/` - 整包复制到resources/tools/
2. `RDC-Agent-Frameworks/debugger/common/agents/*.md` - 角色Prompt参考
3. `RDC-Agent-Frameworks/debugger/common/knowledge/` - 知识库
4. `RDC-Agent-Frameworks/debugger/common/config/*.json` - 配置参考

---

## Verification Plan

### 单元测试
- [ ] WorkflowEngine状态转换测试
- [ ] HarnessController Gate校验测试
- [ ] EvidenceChain事件记录测试
- [ ] LLMAdapter各Provider测试

### 集成测试
- [ ] 完整Debug流程测试（从intake到finalized）
- [ ] 回转场景测试（specialist timeout、skeptic reject）
- [ ] blocker检测与validation_blocked状态测试

### 端到端测试
1. 启动应用，上传.rdc文件
2. 观察WorkflowPanel实时状态更新
3. 验证各Agent按序执行
4. 检查action_chain.jsonl完整性
5. 确认final audit通过

---

## Constraints

1. **原框架只读**: RDC-Agent-Tools和RDC-Agent-Frameworks仅作参考，不修改
2. **数据格式兼容**: 新框架生成的artifact与原框架格式兼容
3. **三个入口**: Debugger首发实现，Analyzer/Optimizer占位
4. **垂直化简化**: coordination_mode只支持staged_handoff，orchestration_mode只支持multi_agent
