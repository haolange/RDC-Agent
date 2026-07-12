# RDX Runtime

RDX Runtime 是 RDC-Agent 的资源解析、Prompt 构建与运行期可观测性边界。产品与工程决策以根目录 `DESIGN.md` 为 SSOT；本文描述对应的稳定实现契约。

## Scope 与存储边界

- User Scope 固定为 `~/.rdx`。
- Project Scope 固定为 `<project-root>/.rdx`。
- 应用内部状态位于 `${userData}/state`，Secret、日志和缓存位于 OS `userData` 下。
- Project `inputs/`、`artifacts/`、`memory/` 与 runtime state 默认不进入 Git。
- RDX CLI 与 shell actions 是 User/Device 配置，Project 资源不能覆盖本机执行入口。

`ScopedResourceResolver` 对 Agent、Skill、MCP、Hook 使用 `builtin < user < project` 的 whole-resource override，同 ID 的 Project disabled resource 可以隐藏继承项。Policy 只允许收紧；放宽、无效或不可比较的配置 fail-closed。

每项 resolved resource 携带 `scope`、`sourcePath`、`sourceHash`、`overriddenSource` 与 `effectiveStatus`。Renderer 通过 `rdxRuntime` preload API 获取这些信息，不直接访问文件系统、Secret 或任意 shell。

## Project Instructions

`ScopedInstructionResolver` 按确定性顺序加载：

1. `~/.rdx/RDX.md`
2. Project 根目录 `RDX.md`
3. 从 Project 根到目标目录逐级出现的 `RDX.md`

目标目录来自 session cwd、附件或当前 capture。带路径的工具调用会重新解析新增目录链。越界、symlink escape、解析错误和预算截断进入诊断，不静默忽略。不自动读取 `AGENTS.md` 或 `CLAUDE.md`。

## Agent、Skill、MCP 与 Hook

- `.agent.md` 是 Agent Profile 的唯一来源，使用 YAML frontmatter + Markdown。
- Skill 使用 `<skill-id>/SKILL.md` 与可选的 `scripts/`、`references/`、`assets/`。
- Profile `skills` 在首次 LLM 调用前完整 preload；其余 Skill 只进入 metadata catalog，并通过 `skill_read` 渐进加载。
- MCP 由 scoped `.mcp.json` 与 effective Agent 的 `mcp-servers` 决定，Project 切换时重新 reconcile。
- Hook 使用 `.hook.yml`、结构化 command/args、`shell: false`、timeout 与 `block | warn` failure policy。
- Project Hook 按 `project + content hash` 授信，内容变化或资源删除自动撤销授信。

## Prompt 与请求管线

```text
Scoped Runtime Resolution
  -> PromptPlanBuilder
  -> Context / Message Transformation
  -> RequestEnvelopeBuilder
  -> Provider Adapter
  -> Provider Wire Request
```

`PromptPlan` 的每个 segment 都保存 kind、scope、path、hash、precedence、content 与 token estimate。`RequestEnvelopeBuilder` 负责 provider-neutral 的完整合并；Provider Adapter 只映射 wire protocol。

每次 `llm_turn` 保存脱敏 `RequestEnvelopeSnapshot`，包含 effective instructions、messages、tools、resource provenance、provider/model/protocol、usage 与 redaction metadata。Credential、capture binary 和 provider protected payload 不落盘；protected payload 只保留 hash 与脱敏原因。Request Inspector 组件可保留为代码层调试能力，但不得挂到默认 Session/Trace 右侧面板，也不得嵌入 Work Process 消息流。

## Memory 与 Reasoning

Memory 只有 `memory_search`、`memory_read`、`memory_write`、`memory_delete` 四个 scoped tool。Write 需要明确用户意图或批准，Delete 需要确认；没有自动抽取、turn counter、consolidation 或全索引 Prompt 注入。

Reasoning 使用 `raw | summary | opaque | none | unknown`。语义来自 Provider/Model contract，不从 OpenAI/Anthropic compatibility protocol 推断。App-managed 且有文档证据的 DeepSeek / Kimi / GLM / MiniMax / MiMo 等解析为 `raw`；真正未核实的第三方路由才是 `unknown`。Work Process 顶层用「工作中 / 工作过程」，loop thinking 用「正在思考 / 已思考 · {duration}」（前置 quiet icon，不用「深度思考」），不展示「语义未验证」。commentary 渲染为 markdown 散文（`proseText`），永不顶 thinking 槽；最终答案仅在 assistant message body 中以 full-bleed prose 呈现，不用 raised bubble。

## 受控 API

`rdxRuntime` preload domain 提供：

- scoped resource overview / validate / upsert / delete / reveal
- Hook trust / revoke / test
- Request snapshot list / detail

Memory 使用独立 scoped preload domain。Renderer 不获得任意 tool execute、任意 shell、Secret 或 provider protected payload 接口。
