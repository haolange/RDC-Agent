# Work Process Loop Semantics 探索 Brief

## 目的

本文整理 Work Process 评审中暴露出的产品与架构问题：RDC-Agent 应如何在专业 agent transcript 中表达 provider `thinking`、模型可见 `commentary/result`、`tool call`、`subagent`、`approval`、`ask_user` 和 `final_answer`。

这不是最终定稿的 implementation spec，而是一份探索型 brief。后续 agent 应阅读本文后检查当前代码、调研 provider protocol 和 agent transcript 设计模式、提出可选方案，并向用户提出少量关键问题来坍缩最终方案。

## 背景

本次讨论不假设后续 agent 能看到任何截图或第三方 UI。问题可以抽象成两类 transcript 元素：

```text
Agent Run
  [A] collapsible thinking block?
      provider reasoning artifact text

  [B] visible loop text
      short commentary/result emitted by the model
      tool call(s) or subagent action(s)
```

核心问题是：这两类内容是否都应该叫 `thinking`。

当前期望的判断是：

- `[A]` 只有在内容来自 provider reasoning artifact 时才属于 `thinking` 语义，例如 `raw thinking` 或 `thinking summary`。
- `[B]` 更可能是某次 `model loop` 的普通可见输出，也就是 `commentary` / `loop result`，不是 `thinking`。
- `tool call`、`tool result`、`approval`、`ask_user`、`subagent` 是 runtime evidence，不是模型思维链。

用户也认可一个大方向：底层数据必须严格保留 `model loop` 边界；UI 层可以把多个 loop 聚合成更可读的 semantic step。

## 不要以当前实现为标准

后续 agent 不应把当前仓库行为当作产品参考。当前实现只能作为需要审计的 implementation evidence。目标应来自：

- provider protocol；
- agent transcript 设计模式；
- 本文描述的产品目标；
- 用户后续确认。

已知当前 concern：RDC-Agent 能区分 `thinking` artifact 和 `llm_turn.result.text`，但还没有稳定的输出 phase，例如 `commentary` 与 `final_answer`。

## 基础术语

### User Turn

用户发出一次消息，以及 assistant 为这条消息生成的一次响应。

### Agent Run

一个 `user turn` 触发的完整 agent 执行过程。它可能包含多个 `model loop`、`tool round`、`subagent`、`approval`、`ask_user` 和最终回答。

### Model Loop / Model Turn

一次 LLM 调用。一次 `model loop` 可能产生：

- provider reasoning artifact；
- visible model text；
- 0 个或多个 `tool call`；
- stop metadata，例如 `tool_use`、`end_turn`、`max_tokens`、`refusal`、`error`。

### Tool Round

runtime 执行模型请求的 `tool call`，再把 `tool result` 喂回下一轮 LLM。

### UI Step / Step Group

UI 为了阅读体验做的 presentation grouping。一个 `step group` 可以包含多个 `model loop`，只要它们属于同一个 semantic phase，例如探索、修改、验证、联网、记忆、交互、协作。

重要限制：UI grouping 不能改写、重排或丢失 canonical loop data。

## Thinking 语义

`thinking` 类数据必须和 visible model text 分开处理。

候选类型：

- `raw`：provider 返回可读 raw thinking text。在 policy 允许时，UI 可以折叠展示。
- `summary`：provider 返回 reasoning summary / summarized thinking。它依然属于 `thinking` 语义，只是不是 raw thinking。
- `opaque`：provider 返回不可读 reasoning state，例如 encrypted reasoning、signed thinking、redacted thinking、continuation artifact。它可能用于 provider replay，但不应该作为 plaintext 展示。
- `hidden`：provider 内部可能使用 reasoning tokens，但不返回 plaintext thinking，也不返回可复用 artifact。
- `none`：本轮没有 thinking artifact。

边界必须明确：

- `raw` 和 `summary` 是可展示 thinking，前提是 policy 允许。
- `opaque`、`hidden`、`none` 不是可展示 thinking text。
- 应用自己根据 tool trace 拼出来的摘要不能叫 `thinking summary`，最多叫 `process summary`、`runtime summary`、`tool summary`。

## Visible Output 语义

visible model text 和 `thinking` 是不同 channel。至少需要考虑两个 phase：

- `commentary`：agent run 中间的可见短句，通常发生在 `tool call` 前后。上文 `[B]` 大概率属于此类。
- `final_answer`：assistant 最终回答用户的正文。它应该进入 assistant message body，不应该在 Work Process 中重复。

开放问题：是否还需要更多 phase，例如 `observation`、`candidate_final`、`interrupted`、`truncated`。

UI 不应该用代码“理解并总结”任意 visible output。普通模型文本千变万化，程序无法稳定知道哪些内容应该保留。可以探索的方式：

- 通过 system prompt 要求中间 `commentary` 保持短句；
- 原样显示模型文本；
- 对超长文本做可逆 disclosure，而不是静默截断；
- 当 runtime 能证明某段文本是 final answer 时，把它放到 final answer body。

## Final Answer 判定

agent loop 通常不应仅靠文本形态判断 `final_answer`。更稳的判定应综合：

- 当前 model response 没有 `tool call`；
- provider stop reason 表示正常结束，例如 `end_turn` 或等价语义；
- stop reason 不是 `max_tokens`、length、truncated、pause、approval、user-input interruption；
- 没有 pending tool、approval、subagent continuation；
- 如果采用 explicit final-output schema/tool，则 schema/tool 已满足。

不要只依赖“本轮没有 tool call”。这通常是必要条件，但不是充分条件。

关键风险：如果 runtime 没有 output phase 和 stop-reason metadata，UI 就会被迫猜测 `result.text` 是 `commentary` 还是 `final_answer`。

## Data 与 UI 的关系

推荐方向：

```text
Canonical data:
  Run
    Loop 1
      thinking?
      visible output?
      tool calls[]
    Loop 2
      thinking?
      visible output?
      tool calls[]

Presentation:
  Step Group 1
    one or more loops
  Step Group 2
    one or more loops
```

canonical data 必须严格、真实、可 replay。UI projection 可以做 semantic grouping。

composer/context builder 应使用 canonical loop data 和 provider replay rules，而不是 UI group 的结果。UI grouping 只服务人类阅读，不能改变 LLM replay order 或 provider protocol。

## Context Replay 与 Token Construction

这个问题和多轮 loop 后 composer 组装下一轮 LLM request 有直接关系。

构造下一轮 LLM request 时：

- visible `commentary` 和 `final_answer` 可以按普通 conversation context 规则进入上下文；
- `tool call` 和 `tool result` 必须按 provider 要求的 tool-use protocol 放入上下文；
- `raw thinking` 不能随便当普通 prompt text 粘进去，除非 provider protocol 明确支持 thinking block replay；
- `thinking summary` 可以用于 UI 展示，但是否 replay 要看 provider protocol 和产品策略；
- `opaque` artifact 如果 provider 需要，应作为 provider-native artifact 原样 replay，而不是展示或转成文本；
- `hidden` 和 `none` 没有 plaintext artifact 可 replay。

UI 不能暴露 hidden chain-of-thought，也不能 fabricate reasoning content。

## UI Aggregation 问题

已认可的高层方向：

- 底层保留严格 `loop` 边界。
- 默认 UI 可以把多个 loop 聚合成可读的 `step group`。
- 可以提供 raw/detail 模式暴露 loop-level 结构，方便 debugging。

候选 group 类型：

- `explore`：`read_file`、`glob`、`grep`、`memory_read`。（注：`search_codebase` 已移除，改用 glob/grep。）
- `web`：`web_search`、`web_fetch`。
- `change`：`write_file`、`edit_file`、`move_file`、`copy_file`、`delete_file`、git mutation。
- `verify`：`bash`、tests、build、browser checks。
- `interaction`：`approval`、`ask_user`。
- `collaboration`：`subagent`、`task`、`handoff`、`skills`。
- `memory`：`memory_write`、`memory_delete`、memory management。
- `diagnostic`：provider/runtime/RDX issues。

候选切组边界：

- 主动作类别发生大变化；
- 出现 `user_input` 或 `approval` pause；
- `subagent` start/end；
- error 或 blocked state；
- `final_answer` 开始；
- group 内 loop 数超过上限；
- group 内 action 数超过上限；
- 时间跨度过长；
- model commentary 明确提示阶段切换，例如“现在开始修改”“接下来验证”。

不变量：

- `tool call` 必须留在产生它的 loop 下。
- `tool result` 必须留在对应 `tool call` 下。
- UI projection 不能把 action 跨 loop 移动，即使多个 loop 被视觉上聚合在一个 group 内。

## Aggregated UI 中的 Thinking 放置

如果一个 UI step group 包含多个 `model loop`，需要探索几种 thinking layout：

### 1. Per-loop thinking

每个 loop 如果有自己的 `raw` 或 `summary` thinking，就在该 loop 的 `commentary` 前显示可折叠 thinking。

现实情况：多数 loop 可能没有 displayable thinking artifact。

### 2. Group-level thinking summary

如果 provider 只给了一个覆盖较大阶段的 summary thinking，可以放在 group 顶部。

限制：必须标成 group summary，不能假装它属于每个 loop。

### 3. No thinking

如果没有 displayable artifact，不显示 fake thinking row。

此时只显示 `commentary` 和 actions。

用户倾向于：只有 `thinking` 使用明确的 collapse/expand affordance。普通 `commentary` 如果短，就直接展示。

## Product Constraints

- 不暴露 hidden chain-of-thought。
- 不把 application-generated summaries 标成 provider thinking。
- 不在 Work Process 中重复 final answer body。
- 不用任意文本截断冒充 semantic compacting。
- 不让 UI 靠文本内容猜 `final_answer`。
- 不让 UI grouping 影响 provider replay 或 composer token construction。
- 不丢失 `tool call` 顺序、`tool result` 顺序、approval decisions、subagent boundaries。

## 可调研的协议与设计方向

这些只是调研方向，不是 rigid requirement，也不要求复制任何第三方 UI：

- OpenAI Responses / reasoning models：reasoning summaries、hidden/non-raw reasoning 与 visible output 需要分开处理。
- OpenAI Agents SDK：agent loop 执行 tools，并返回 `final_output`；tool-use behavior 会影响 run 何时停止。
- Anthropic Claude Messages：`tool_use`、`end_turn`、`max_tokens` 等 stop reasons 决定继续、finalize、还是标记 truncated。
- Anthropic extended thinking：thinking blocks 与 provider-native thinking artifacts 在 tool-use continuation 中可能需要保留。

参考链接：

- https://developers.openai.com/api/docs/guides/reasoning
- https://developers.openai.com/api/docs/guides/function-calling
- https://developers.openai.com/api/docs/guides/agents
- https://openai.github.io/openai-agents-python/results/
- https://openai.github.io/openai-agents-python/agents/
- https://platform.claude.com/docs/en/build-with-claude/handling-stop-reasons
- https://docs.aws.amazon.com/bedrock/latest/userguide/claude-messages-extended-thinking.html

## 需要向用户确认的问题

后续 agent 在实现前应向用户提出少量关键问题：

1. 默认 UI 是否采用 semantic grouped view，并提供 developer/detail toggle 查看 exact loop boundaries？
2. 普通 `commentary` 是否永远不折叠，还是长文本时允许 reversible disclosure？
3. 如果 `commentary` 变长，应该 UI 展开全文，还是加强 system prompt 约束模型少说？
4. `opaque` reasoning state 在普通 UI 中是否完全隐藏，还是显示一个轻量状态 indicator？
5. 中文 UI label 应如何命名 `thinking`、`thinking summary`、`commentary`、`actions`、`final_answer`？
6. 多个 loop 被聚合时，是否允许 group-level thinking summary？
7. `final_answer` 应该是 explicit runtime phase、structured output item，还是基于 provider stop metadata 推断？
8. Work Process 默认高度、密度、展开层级的接受范围是什么？

## 建议探索计划

1. 收集代表性 trace：
   - 支持 raw thinking 的 provider；
   - summary-only thinking；
   - opaque/hidden reasoning；
   - no thinking；
   - 多轮 tool loop；
   - 单轮多个 tool calls；
   - subagent 和 ask-user；
   - max-token/truncated。

2. 定义或修正 canonical data fields：
   - model loop id；
   - output phase/kind；
   - provider stop reason；
   - thinking artifact kind/source/visibility/replay policy；
   - tool-call association；
   - final answer boundary。

3. 建立 pure projection layer：
   - input: canonical trace；
   - output: semantic step groups；
   - deterministic；
   - fully unit-tested。

4. 原型化 UI variants：
   - strict loop view；
   - semantic grouped view；
   - grouped view with raw/detail expansion。

5. 验证 composer replay：
   - UI grouping 不改变 replay order；
   - thinking artifacts 只按 provider protocol replay；
   - final answer 不重复写入 Work Process trace。

6. 带选项回到用户：
   - 给出 ASCII sketch 或 live browser examples；
   - 列清 tradeoffs；
   - 只问能坍缩方案的关键问题。

## 期望验收形态

一个合格实现最终应能证明：

- 清晰区分 `thinking`、visible `commentary`、runtime actions、`final_answer`；
- 稳定处理 `raw`、`summary`、`opaque`、`hidden`、no-thinking；
- 使用 provider/runtime metadata 判断 `final_answer`，不靠脆弱文本猜测；
- semantic grouping 像专业 agent transcript，但仍保留 loop truth；
- projection rules 和边界情况有测试；
- desktop 与 narrow viewport 经过真实浏览器验证；
- 不泄漏 hidden chain-of-thought，不生成 fake thinking rows。
