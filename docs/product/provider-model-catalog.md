# RDC-Agent Provider Model Catalog

> 权威矩阵（2026-08-02）。Manifest 固化一手资料可确定的结构事实，credential-scoped discovery 决定账户可见性，真实 wire probe 验证 route / control / continuation；三者合并为 Effective Catalog。
> `Context Window` 表示常规上下文预算；`1M Max` 单独表示是否支持 1M / Max mode。  
> 「不清楚」或三角证据未齐 → fail-closed：manifest 用 `unknown` / `unsupported` / `none`（按证据选择）。Agent/Composer 可执行集合只纳入 source-backed `toolCalling.supported` 且具备已实现 structured-tool adapter 的模型；`unknown`/`unsupported` 仍留在 Settings catalog 供审计，但不作为 Agent 选择项。  
> 同名模型在不同 Provider surface 上的 Fast / 1M / 推理控件彼此独立，不可跨 surface 抄写。  
> 一手资料不能替代账号 entitlement 或 wire 证据；live discovery 也不能发明协议、控件或 continuation。source-backed 容量与真实满窗压测必须明确区分。

## 实现注册表（Implementation Registry）

当前 `implementationRegistry.ts` 包含 **16 个 adapter**，支持以下协议：

| 协议 | adapterId | 新增于 |
| --- | --- | --- |
| AnthropicMessages | `anthropic-messages` | — |
| AzureOpenAIChatCompletions | `azure-openai-chat` | — |
| AzureOpenAIResponses | `azure-openai-responses` | HAL Phase 7 |
| BedrockConverseStream | `bedrock-converse-stream` | HAL Phase 7 |
| GitLabDuo | `gitlab-duo` | — |
| GoogleInteractions | `google-interactions` | — |
| GoogleGemini | `google-gemini` | — |
| GoogleVertexAnthropic | `google-vertex-anthropic` | — |
| GoogleVertexGemini | `google-vertex-gemini` | — |
| MistralConversations | `mistral-conversations` | HAL Phase 7（adapter 保留，无 selectable surface） |
| OllamaOpenAICompatibleChatCompletions | `ollama-openai-compatible` | — |
| OpenAICompatibleChatCompletions | `openai-compatible` | — |
| OpenAIResponses | `openai-responses` | — |
| OpenRouterChatCompletions | `openrouter-chat` | — |
| SapAiCoreFoundationModels | `sap-ai-core-foundation-models` | — |
| SapAiCoreOrchestration | `sap-ai-core-orchestration` | — |

## 成本/定价字段（Cost/Pricing）

Model manifest 可声明每百万 token 美元定价（`cost` 字段）：

```json
{
  "cost": {
    "input": 3.0,
    "output": 15.0,
    "cacheRead": 0.30,
    "cacheWrite": 3.75
  }
}
```

- `input` / `output`：每百万 token 的美元价格。
- `cacheRead`：缓存读取折扣价（可选）。
- `cacheWrite`：缓存写入价格（可选；Anthropic 1h TTL 按 2× input 计算）。
- 无 `cost` 字段时 UI 不显示成本；用户可经 `models.json` 覆盖定价。

## Anthropic Direct API

| Name             | Context Window | Max Output | Fast Mode | 推理等级 | 状态 |
| ---------------- | --------------:| ----------:| --------- | -------- | ---- |
| `claude-opus-5`  | 1M             | 128K       | Direct API `speed=fast` + beta header；仅 `usage.speed=fast` 授权 | Off / Low / Medium / High / Extra / Max（默认 High） | 可用；Fast entitlement 需 probe |

Fast 是同一模型的 request binding，不是 `*-fast` 别名或独立模型。标准价格为 $5 / $25 每百万 input/output tokens；Fast 为 $10 / $50。Bedrock、Google Cloud、Microsoft Foundry 与 GitHub Copilot 不继承 Direct API Fast。

## ChatGPT Account

| Name                  | Context Window | 1M Max      | Fast Mode                      | 推理等级                                         | 状态   |
| --------------------- | --------------:| ----------- | ------------------------------ | -------------------------------------------- | ---- |
| `gpt-5.6-sol`         | 256K           | 否           | API 参数：`service_tier=priority` | Low / Medium / High / Extra / Max（默认 Medium） | 可用   |
| `gpt-5.6-terra`       | 256K           | 否           | API 参数：`service_tier=priority` | Low / Medium / High / Extra / Max（默认 Medium） | 可用   |
| `gpt-5.6-luna`        | 256K           | 否           | API 参数：`service_tier=priority` | Low / Medium / High / Extra / Max（默认 Medium） | 可用   |
| `gpt-5.5`             | 256K           | 否           | API 参数：`service_tier=priority` | Low / Medium / High / Extra（默认 Medium）       | 可用   |
| `gpt-5.4-mini`        | 128K           | 否           | 否                              | Low / Medium / High / Extra（默认 Medium）       | 可用   |
| `gpt-5.4`             | 256K           | 是（Max mode） | API 参数：`service_tier=priority` | Low / Medium / High / Extra（默认 Medium）       | 可用   |
| `gpt-5.3-codex-spark` | 256K           | 否           | 否                              | Low / Medium / High / Extra（默认 Medium）       | 附加观测 |

## GitHub Copilot

| Name                     | Context Window | 1M Max  | Fast Mode             | 推理等级                                               | 状态          |
| ------------------------ | --------------:| ------- | --------------------- | -------------------------------------------------- | ----------- |
| `claude-sonnet-4.6`      | 账号默认窗口    | 可选扩展 1M | 否                     | 账号 `/models` 精确档位                                  | 账号目录决定 |
| `claude-opus-4.6`        | 账号默认窗口    | 可选扩展 1M | 否                     | 账号 `/models` 精确档位                                  | 账号目录决定 |
| `claude-opus-4.8`        | 账号默认窗口    | 可选扩展 1M | 否                     | 账号 `/models` 精确档位                                  | 账号目录决定 |
| `claude-opus-4.8-fast`   | 账号默认窗口    | 可选扩展 1M | 独立 model id          | 账号 `/models` 精确档位                                  | 账号目录决定 |
| `claude-sonnet-5`        | 账号默认窗口    | 可选扩展 1M | 否                     | 账号 `/models` 精确档位                                  | 账号目录决定 |
| `claude-fable-5`         | 账号默认窗口    | 可选扩展 1M | 否                     | 账号 `/models` 精确档位                                  | 账号目录决定 |
| `claude-opus-5`          | 1M             | 未验证     | 否                     | 未验证（UI=`Disabled`）                                  | 仅当前账户 discovery 精确返回 model id + agent endpoint 时可选 |
| `gpt-5.4-mini`           | 128K           | 否       | 否                     | Non / Low / Medium / High / Extra（默认 Medium）       | 可用          |
| `gpt-5.4`                | 256K           | 是       | 否                     | Non / Low / Medium / High / Extra（默认 Medium）       | 可用          |
| `gpt-5.5`                | 256K           | 是       | 否                     | Non / Low / Medium / High / Extra（默认 Medium）       | 可用          |
| `gpt-5.6-luna`           | 256K           | 是       | 否                     | Non / Low / Medium / High / Extra / Max（默认 Medium） | 可用          |
| `gpt-5.6-sol`            | 256K           | 是       | 否                     | Non / Low / Medium / High / Extra / Max（默认 Medium） | 可用          |
| `gpt-5.6-terra`          | 256K           | 是       | 否                     | Non / Low / Medium / High / Extra / Max（默认 Medium） | 可用          |
| `gemini-3.1-pro-preview` | 200K           | 是       | 否                     | Low / Medium / High（默认 Medium）                     | 可用          |
| `gemini-3.5-flash`       | 1M             | 是(只有1M) | 否                     | Minimal(对应Non) / Low / Medium / High（默认 Medium）    | 可用          |
| `kimi-k2.7-code`         | 256K           | 否       | 否                     | 不清楚（UI=`Disabled`）                                  | 可用          |

## Super Grok Account

| Name                           | Context Window | 1M Max | Fast Mode | 推理等级                           | 状态  |
| ------------------------------ | --------------:| ------ | --------- | ------------------------------ | --- |
| `grok-4.20-0309-non-reasoning` | 1M             | 是      | 否         | 不清楚（UI=`Disabled`）              | 可用  |
| `grok-4.20-0309-reasoning`     | 1M             | 是      | 否         | Just On                        | 可用  |
| `grok-4.20-multi-agent-0309`   | 1M             | 是      | 否         | Low / Medium / High / Extra    | 可用  |
| `grok-4.3`                     | 500K           | 是（Max → 1M） | 否     | Non / Low / Medium / High      | 可用  |
| `grok-4.5`                     | 500K           | 否      | 否         | Low / Medium / High（默认 Medium） | 可用  |
| `grok-build-0.1`               | 256K           | 否      | 否         | Just On                        | 可用  |

## DeepSeek

| Name                | Context Window | 1M Max  | Fast Mode | 推理等级                                   | Route | 状态  |
| ------------------- | --------------:| ------- | --------- | -------------------------------------- | ----- | --- |
| `deepseek-v4-pro`   | 1M             | 是(只有1M) | 否         | Off / High / Max（默认 High） | Chat Completions / Anthropic | Preview；Responses 尚未开放 |
| `deepseek-v4-flash` | 1M             | 是(只有1M) | 否         | Off / Low / High / Max（默认 High） | Responses（默认）/ Chat Completions / Anthropic | Public Beta |

Flash 映射：`low/high/xhigh/max → low/high/high/max`；Pro 当前映射：`low/high/xhigh/max → high/high/max/max`。Thinking 开启时移除 `temperature`、`top_p`、`presence_penalty`、`frequency_penalty`。Chat/Anthropic 的工具续传必须回放 `reasoning_content`；Responses 回放 raw reasoning item 与 function-call continuation，不使用 `previous_response_id`。`deepseek-chat` / `deepseek-reasoner` 已于 2026-07-24 停用，不存在 alias 或兼容 shim。

## Kimi Coding Plan

| Name                        | Context Window | 1M Max | Fast Mode                                                                        | 推理等级                                 | 状态     |
| --------------------------- | --------------:| ------ | -------------------------------------------------------------------------------- | ------------------------------------ | ------ |
| `kimi-for-coding`           | 256K           | 否      | 变体 model：`kimi-for-coding-highspeed`（账号 live catalog 缺目标时 Fast 可见但禁用，文案：当前账户不可用） | Always-on（`thinking_type=only`，锁 On） | 可用     |
| `kimi-for-coding-highspeed` | 256K           | 否      | 否（内部 Fast 目标，不出现在选择器）                                                            | Always-on（锁 On）                      | 账号可能缺席 |
| `k3`                        | 256K 默认；最高 1M | 可选；按账号 entitlement | 否                                                                      | Low / High / Max（默认 High；无 Off） | 账号目录出现时可用 |
| `k3-256k`                   | 256K           | 否      | 否                                                                                | Low / High / Max（默认 High；无 Off） | 账号目录出现时可用 |

Kimi Coding Plan 的 Anthropic-compatible base URL 是 `https://api.kimi.com/coding/`，OpenAI-compatible base URL 是 `https://api.kimi.com/coding/v1`。`k3` 的 1M 是同一 model id 的 context tier，不存在 `k3[1m]`。官方明确指出 K3 关闭 Thinking 会路由到 K2.6，因此产品不为 K3 暴露 Off，避免“选择 K3、实际运行 K2.6”的身份漂移。

## Volcengine Ark Coding Plan

| Name                       | Context Window | 1M Max  | Fast Mode                           | 推理等级                                           | 状态  |
| -------------------------- | --------------:| ------- | ----------------------------------- | ---------------------------------------------- | --- |
| `doubao-seed-2.1-lite`     | 131K           | 否       | 否                                   | Off / Minimal / Low / Medium / High（默认 Medium） | 可用  |
| `doubao-seed-2.1-pro`      | 131K           | 否       | 否                                   | Off / Minimal / Low / Medium / High（默认 Medium） | 可用  |
| `doubao-seed-2.1-code`     | 131K           | 否       | 否                                   | Off / Minimal / Low / Medium / High（默认 Medium） | 可用  |
| `glm-5.2`                  | 1M             | 是(只有1M) | 否                                   | Off / High / Max（默认 High）                      | 可用  |
| `deepseek-v4-pro`          | 1M             | 是(只有1M) | 否                                   | High / Max（默认 High）                            | 可用  |
| `deepseek-v4-flash`        | 1M             | 是(只有1M) | 否                                   | High / Max（默认 High）                            | 可用  |
| `kimi-k2.7-code`           | 256K           | 否       | 变体 model：`kimi-k2.7-code-highspeed` | 只有On                                           | 不可用 |
| `kimi-k2.7-code-highspeed` | 256K           | 否       | 否                                   | 只有On                                           | 不可用 |

附加观测（本机 Volc Coding Plan 仍列出，旧表未覆盖）：`doubao-seed-code`、`minimax-m2.7`、`minimax-m2.5`、`kimi-k2.6`、`kimi-k2.5`、`glm-5.1`、`glm-4.7`。

## ClinePass

> Live 来源：`GET /ai/cline/recommended-models` 的 `clinePass` 桶（2026-07-23）。  
> 行内仅有 `id/name/description/tags`；无 effort / Fast wire。描述写明 `1M context window` 的模型按固定 1M 处理，其余保持既有窗口估计；推理列「不清楚」→ fail-closed（UI=`Disabled`）。

| Name                           | Context Window | 1M Max  | Fast Mode | 推理等级                      | 状态  |
| ------------------------------ | --------------:| ------- | --------- | ------------------------- | --- |
| `cline-pass/glm-5.2`           | 200K           | 否       | 否         | Off / High / Max（默认 High） | 可用  |
| `cline-pass/kimi-k3`           | 256K           | 否       | 否         | Low / High / Max          | 可用  |
| `cline-pass/kimi-k2.7-code`    | 256K           | 否       | 否         | Just On                   | 可用  |
| `cline-pass/kimi-k2.6`         | 256K           | 否       | 否         | Off / On                  | 可用  |
| `cline-pass/deepseek-v4-pro`   | 1M             | 是(只有1M) | 否         | High / Max（默认 High）       | 可用  |
| `cline-pass/deepseek-v4-flash` | 1M             | 是(只有1M) | 否         | High / Max（默认 High）       | 可用  |
| `cline-pass/mimo-v2.5`         | 128K           | 否       | 否         | 不清楚                       | 可用  |
| `cline-pass/mimo-v2.5-pro`     | 128K           | 否       | 否         | 不清楚                       | 可用  |
| `cline-pass/minimax-m3`        | 1M             | 是(只有1M) | 否         | 不清楚                       | 可用  |
| `cline-pass/qwen3.7-max`       | 1M             | 是(只有1M) | 否         | 不清楚                       | 可用  |
| `cline-pass/qwen3.7-plus`      | 128K           | 否       | 否         | 不清楚                       | 可用  |

## OpenCode Go

> Live 来源：`GET https://opencode.ai/zen/go/v1/models`（2026-07-23）。  
> 当前 live 行仅有 `id/object/created/owned_by`，无 context / effort / protocol 字段。  
> 除已固化的 `kimi-k3` 外：`Fast`/`1M` unsupported；推理列标「不清楚」的保持 fail-closed（UI=Disabled）。  
> 窗口列标「不清楚」的：不宣称已测死；manifest 可保留可发送的工作估计值，不得写成已验证事实。

| Name                | Context Window | 1M Max      | Fast Mode | 推理等级                                               | 状态  |
| ------------------- | --------------:| ----------- | --------- | -------------------------------------------------- | --- |
| `kimi-k3`           | 256K           | 是（Max mode） | 否         | Always-on（锁 Max）                                   | 可用  |
| `kimi-k2.7-code`    | 不清楚            | 否           | 否         | 不清楚                                                | 可用  |
| `kimi-k2.6`         | 不清楚            | 否           | 否         | 不清楚                                                | 可用  |
| `kimi-k2.5`         | 不清楚            | 否           | 否         | 不清楚                                                | 可用  |
| `deepseek-v4-pro`   | 不清楚            | 否           | 否         | 不清楚                                                | 可用  |
| `deepseek-v4-flash` | 不清楚            | 否           | 否         | 不清楚                                                | 可用  |
| `glm-5.2`           | 不清楚            | 否           | 否         | 不清楚                                                | 可用  |
| `glm-5.1`           | 不清楚            | 否           | 否         | 不清楚                                                | 可用  |
| `glm-5`             | 不清楚            | 否           | 否         | 不清楚                                                | 可用  |
| `minimax-m3`        | 不清楚            | 否           | 否         | 不清楚                                                | 可用  |
| `minimax-m2.7`      | 不清楚            | 否           | 否         | 不清楚                                                | 可用  |
| `minimax-m2.5`      | 不清楚            | 否           | 否         | 不清楚                                                | 可用  |
| `qwen3.7-max`       | 不清楚            | 否           | 否         | 不清楚                                                | 可用  |
| `qwen3.7-plus`      | 不清楚            | 否           | 否         | 不清楚                                                | 可用  |
| `qwen3.6-plus`      | 不清楚            | 否           | 否         | 不清楚                                                | 可用  |
| `qwen3.5-plus`      | 不清楚            | 否           | 否         | 不清楚                                                | 可用  |
| `mimo-v2-pro`       | 不清楚            | 否           | 否         | 不清楚                                                | 可用  |
| `mimo-v2-omni`      | 不清楚            | 否           | 否         | 不清楚                                                | 可用  |
| `mimo-v2.5-pro`     | 不清楚            | 否           | 否         | 不清楚                                                | 可用  |
| `mimo-v2.5`         | 不清楚            | 否           | 否         | 不清楚                                                | 可用  |
| `hy3`               | 不清楚            | 否           | 否         | 不清楚                                                | 可用  |
| `hy3-preview`       | 不清楚            | 否           | 否         | 不清楚                                                | 可用  |
| `grok-4.5`          | 不清楚            | 否           | 否         | 不清楚                                                | 可用  |

## 本机资格验证快照（2026-08-02）

此节是 credential-scoped 验收记录，不是 manifest 基线真值，也不持久化 secret：

- 本机仍保存 8 个 enabled Provider 配置；本次在最新 Browser/main process 上逐一执行 Provider Test。ChatGPT Account、DeepSeek、ClinePass、Kimi Coding Plan、OpenCode Go、Volcengine Coding Plan 通过；GitHub Copilot 与 Super Grok Account 的当前 OAuth 凭据未通过，UI 因而显示 `Unconfigured`，不得继续把缓存目录计作当前可用模型。
- Kimi authoritative discovery 返回 4 个协议模型；产品选择器投影为 `kimi-for-coding`、`k3`、`k3-256k` 三个 primary 模型，`kimi-for-coding-highspeed` 仅作为 Fast execution target。旧伪身份 `k3[1m]` 已删除；`k3` 的 1M 是账户级 context tier，不是另一个 model id。
- DeepSeek V4 Flash 已完成一条真实 Responses 请求，得到 canonical final `OK`、thinking 与 Last actual usage。其可见 reasoning 档固定为 Off / Low / High / Max；Pro 固定为 Off / High / Max。兼容输入 `xhigh` 只在 planner 内折叠映射，不得渲染成额外滑槽档位。
- 本次 Provider Test 只证明凭据、目录和默认 route 可用，不等价于对每个目录模型完成独立请求。历史全模型 probe 结果不得冒充当前资格；模型级可用性必须由新的 model probe / execution evidence 单独续期。
- Direct Anthropic / Kimi Fast 仍未得到 `usage.speed=fast`，因此不标记当前账户 Fast entitled。1M 只验证真实 activation wire 与官方/manifest 数值，没有伪称完成百万 token 满窗压力测试。

## 校对备注

1. **权威规则**：本表写清的单元格 = 本机测过的正确信息，manifest 必须对齐；仅「不清楚」才 fail-closed（UI=`Disabled`），不得用审计覆盖已写清事实。  
2. ChatGPT `gpt-5.4-mini`：Fast 保持 unsupported（不跟其它 gpt-5.x 盲抄 `service_tier=priority`）。  
3. Copilot `claude-opus-5` 只作为 `account-entitled` 候选；当前账户 discovery 缺席时不可选，且不继承 Anthropic Direct API Fast。`claude-opus-4.8` 不再绑定 Fast 开关；`claude-opus-4.8-fast` 为独立 primary 可选模型。
4. Kimi Coding Plan：`kimi-for-coding` Always-on；账号缺 `highspeed` 时 Fast 可见但禁用；`k3` / `k3-256k` 只接受 Low/High/Max，目录缺席即不可选。
5. Grok `grok-4.3`：常规 500K + Max→1M（注）；推理 Non/Low/Medium/High；`grok-4.20-reasoning` / `grok-build-0.1` = Just On；multi-agent = L/M/H/Extra。  
6. DeepSeek Direct：固定 1M；Flash 可见 Off/Low/High/Max，Pro 可见 Off/High/Max，兼容 effort 输入走 model-specific 折叠映射。Flash 默认 Responses 且为 Public Beta，Pro 仍是 Preview 且禁止 Responses。Volc/ClinePass 是独立 surface，不得抄 Direct route 或 Off 能力。
7. Volc：Doubao Fast=否；Kimi K2.7=只有On；附加观测行推理未写清 → fail-closed。  
8. ClinePass：写清的档位已入结构控件；wire 待 probe；「不清楚」行保持 unknown。  
9. OpenCode Go：仅 `kimi-k3` 窗口/推理已写清；其余「不清楚」不宣称已测；Composer 关档统一 `Disabled`/`禁用`。
