# Workflow

Debugger 主链的领域入口。`src/main/workflow/debugger/DebuggerRuntime.ts` 是唯一顶层流程权威，负责对外承接 `workflow:start/getPlan/submitQuestions/approvePlan/restartRun/stopRun/getWorkflowState`，并控制 stage、gate、approval、blocker、state projection、evidence 和 finalization 的边界。

`src/main/services/DebugWorkflowService.ts` 只作为 Runtime 内部执行服务保留，不能再作为 IPC、conversation、preload 或 renderer 的公开旁路入口。OpenAI / Claude Agent SDK 统一经 `AgentRunnerPort` 作为 stage 内 runner 接入，工具调用只能通过 `AgentToolPort -> ToolBridge` 回到 RDC 工具层。

约束：

- 不改变 workflow 阶段语义。
- 不把 Analyzer / Optimizer 自动接入 Debugger harness。
- 不绕开 `ToolBridge` 执行 RenderDoc 工具。
- 不恢复旧的手动阶段推进、回退或 specialist 分发公开 workflow 旁路。
