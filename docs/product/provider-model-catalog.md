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
| `claude-fable-5-1` | 1M           | 128K       | 否 | Low / Medium / High / Extra / Max（默认 High；无 Off） | 可用；$10 / $50 |

Fast 是同一模型的 request binding，不是 `*-fast` 别名或独立模型。标准价格为 $5 / $25 每百万 input/output tokens；Fast 为 $10 / $50。Bedrock、Google Cloud、Microsoft Foundry 与 GitHub Copilot 不继承 Direct API Fast。

## ChatGPT Account

| Name                  | Context Window | 1M Max      | Fast Mode                      | 推理等级                                         | 状态   |
| --------------------- | --------------:| ----------- | ------------------------------ | -------------------------------------------- | ---- |
| `gpt-6-astra`         | 272K 默认；Max 872K | 是（Codex Max mode，不是 API 1,050,000） | Codex `service_tier=priority`（Fast） | Low / Medium / High / Extra / Max（默认 Low） | 账号 `/models` 出现时可用；窗口与 Fast 取 Codex `models.json` + 本机 ChatGPT Account `/models`，不抄 API 数字 |
| `gpt-5.6-sol`         | 256K           | 否           | API 参数：`service_tier=priority` | Low / Medium / High / Extra / Max（默认 Medium） | 可用   |
| `gpt-5.6-terra`       | 256K           | 否           | API 参数：`service_tier=priority` | Low / Medium / High / Extra / Max（默认 Medium） | 可用   |
| `gpt-5.6-luna`        | 256K           | 否           | API 参数：`service_tier=priority` | Low / Medium / High / Extra / Max（默认 Medium） | 可用   |
| `gpt-5.5`             | 256K           | 否           | API 参数：`service_tier=priority` | Low / Medium / High / Extra（默认 Medium）       | 可用   |

## GitHub Copilot

| Name                     | Context Window | 1M Max  | Fast Mode             | 推理等级                                               | 状态          |
| ------------------------ | --------------:| ------- | --------------------- | -------------------------------------------------- | ----------- |
| `claude-sonnet-4.6`      | 账号默认窗口    | 可选扩展 1M | 否                     | 账号 `/models` 精确档位                                  | 账号目录决定 |
| `claude-opus-4.8`        | 账号默认窗口    | 可选扩展 1M | 否                     | 账号 `/models` 精确档位                                  | 账号目录决定 |
| `claude-opus-4.8-fast`   | 待账号目录确认 | 否       | 独立 model id          | 账号 `/models` 精确档位                                  | 账号目录决定；无 1M |
| `claude-sonnet-5`        | 账号默认窗口    | 可选扩展 1M | 否                     | 账号 `/models` 精确档位                                  | 账号目录决定 |
| `claude-fable-5`         | 账号默认窗口    | 可选扩展 1M | 否                     | 账号 `/models` 精确档位                                  | 账号目录决定 |
| `claude-opus-5`          | 1M             | 未验证     | 否                     | 未验证（UI=`Disabled`）                                  | 仅当前账户 discovery 精确返回 model id + agent endpoint 时可选 |
| `gpt-5.4-mini`           | 128K           | 否       | 否                     | Non / Low / Medium / High / Extra（默认 Medium）       | 可用          |
| `gpt-5.5`                | 256K           | 是       | 否                     | Non / Low / Medium / High / Extra（默认 Medium）       | 可用          |
| `gpt-5.6-luna`           | 256K           | 是       | 否                     | Non / Low / Medium / High / Extra / Max（默认 Medium） | 可用          |
| `gpt-5.6-sol`            | 256K           | 是       | 否                     | Non / Low / Medium / High / Extra / Max（默认 Medium） | 可用          |
| `gpt-5.6-terra`          | 256K           | 是       | 否                     | Non / Low / Medium / High / Extra / Max（默认 Medium） | 可用          |
| `gemini-3.5-flash`       | 待账号目录确认 | 否       | 否                     | Minimal(对应Non) / Low / Medium / High（默认 Medium）    | 2026-10-02 前仍在 GA 列表 |
| `kimi-k2.7-code`         | 256K           | 否       | 否                     | 不清楚（UI=`Disabled`）                                  | 可用          |

## Super Grok Account

| Name                           | Context Window | 1M Max | Fast Mode | 推理等级                           | 状态  |
| ------------------------------ | --------------:| ------ | --------- | ------------------------------ | --- |
| `grok-4.20-0309-non-reasoning` | 1M             | 是      | 否         | 不清楚（UI=`Disabled`）              | 可用  |
| `grok-4.20-0309-reasoning`     | 1M             | 是      | 否         | Just On                        | 可用  |
| `grok-4.20-multi-agent-0309`   | 1M             | 是      | 否         | Low / Medium / High / Extra    | 可用  |
| `grok-4.3`                     | 500K           | 是（Max → 1M） | 否     | Non / Low / Medium / High      | 可用  |
| `grok-4.7`                     | 500K           | 否      | `service_tier=priority`（Fast） | Low / Medium / High / Extra（默认 High）；视觉 supported | 可用 |
| `grok-4.6`                     | 500K           | 否      | 否         | Low / Medium / High / Extra（默认 High）；视觉 supported | 可用  |
| `grok-4.5`                     | 500K           | 否      | 否         | Low / Medium / High（默认 Medium） | 可用  |
| `grok-build-0.1`               | 256K           | 否      | 否         | Just On                        | 可用  |

## DeepSeek

| Name             | Context Window | 1M Max  | Fast Mode | 推理等级                                   | Route | 状态  |
| ---------------- | --------------:| ------- | --------- | -------------------------------------- | ----- | --- |
| `deepseek-flash` | 1M             | 是(只有1M) | 否         | Off / Low / High / Max（默认 High） | Responses（默认）/ Chat Completions / Anthropic | DeepSeek-V4.1-Flash；原生视觉 |
| `deepseek-v4-pro` | 1M             | 是(只有1M) | 否         | Off / Low / High / Max（默认 High） | Responses（默认）/ Chat Completions / Anthropic | DeepSeek-V4-Pro；视觉 unsupported |

兼容输入 `minimal → low`、`medium/xhigh → high` 只在 wire 折叠，不渲染成额外档位。Thinking 开启时移除 `temperature`、`presence_penalty`、`frequency_penalty`；保留有效的 `top_p`（服务端有效范围 0.95–1）。Chat/Anthropic 的工具续传必须回放 `reasoning_content`；Responses 回放 raw reasoning item 与 function-call continuation，不使用 `previous_response_id`。`deepseek-v4-flash` / `deepseek-v4-flash-vision-exp` 已退役，不存在 alias。`deepseek-chat` / `deepseek-reasoner` 已于 2026-07-24 停用。

## Kimi Coding Plan

| Name                        | Context Window | 1M Max | Fast Mode                                                                        | 推理等级                                 | 状态     |
| --------------------------- | --------------:| ------ | -------------------------------------------------------------------------------- | ------------------------------------ | ------ |
| `kimi-for-coding`           | 1M             | 是(只有1M) | 变体 model：`kimi-for-coding-highspeed`（账号 live catalog 缺目标时 Fast 可见但禁用，文案：当前账户不可用） | Off / Low / High / Max（默认 Max） | K2.8 Preview；账号目录出现时可用 |
| `kimi-for-coding-highspeed` | 256K           | 否      | 否（内部 Fast 目标，不出现在选择器）                                                            | Always-on（锁 On）                      | 账号可能缺席 |
| `k3`                        | 256K 默认；最高 1M | 可选；按账号 entitlement | 否                                                                      | Low / High / Max（默认 High；无 Off） | 账号目录出现时可用 |
| `k3-256k`                   | 256K           | 否      | 否                                                                                | Low / High / Max（默认 High；无 Off） | 账号目录出现时可用 |

Kimi Coding Plan 的 Anthropic-compatible base URL 是 `https://api.kimi.com/coding/`，OpenAI-compatible base URL 是 `https://api.kimi.com/coding/v1`。`k3` 的 1M 是同一 model id 的 context tier，不存在 `k3[1m]`。官方明确指出 K3 关闭 Thinking 会路由到 K2.8 Preview，因此产品不为 K3 暴露 Off，避免“选择 K3、实际运行 K2.8 Preview”的身份漂移。

## Volcengine Ark Coding Plan

| Name                       | Context Window | 1M Max  | Fast Mode                           | 推理等级                                           | 状态  |
| -------------------------- | --------------:| ------- | ----------------------------------- | ---------------------------------------------- | --- |
| `doubao-seed-2.1-lite`     | 131K           | 否       | 否                                   | Off / Minimal / Low / Medium / High（默认 Medium） | 可用  |
| `doubao-seed-2.1-pro`      | 131K           | 否       | 否                                   | Off / Minimal / Low / Medium / High（默认 Medium） | 可用  |
| `doubao-seed-2.1-code`     | 131K           | 否       | 否                                   | Off / Minimal / Low / Medium / High（默认 Medium） | 可用  |
| `doubao-seed-2.1-turbo`    | 131K           | 否       | 否                                   | Off / Minimal / Low / Medium / High（默认 Medium） | 可用  |
| `glm-5.3`                  | 1M             | 是(只有1M) | 否                                   | Off / High / Max（默认 High）                      | 可用  |
| `glm-5.2`                  | 1M             | 是(只有1M) | 否                                   | Off / High / Max（默认 High）                      | 可用  |
| `kimi-k2.7-code`           | 256K           | 否       | 变体 model：`kimi-k2.7-code-highspeed` | 只有On                                           | 可用  |
| `kimi-k2.7-code-highspeed` | 256K           | 否       | 否                                   | 只有On                                           | 内部 Fast 目标 |
| `minimax-m3`               | 204.8K         | 否       | 否                                   | 不清楚                                            | 可用  |

`doubao-seed-2.0-*`、`doubao-seed-code`、`deepseek-v4-pro`、`deepseek-v4-flash` 以及已确认不支持 Coding Plan 的 `minimax-m2.5` / `kimi-k2.5` / `glm-5.1` / `glm-4.7` 已从目录删除，不留 deprecated 占位。仍保留的附加现行项：`minimax-m2.7`、`kimi-k2.6`。

## ClinePass

> Live 来源：`GET /ai/cline/recommended-models` 的 `clinePass` 桶（2026-07-23）。
> 行内仅有 `id/name/description/tags`；无 effort / Fast wire。描述写明 `1M context window` 的模型按固定 1M 处理，其余保持既有窗口估计；推理列「不清楚」→ fail-closed（UI=`Disabled`）。

| Name                           | Context Window | 1M Max  | Fast Mode | 推理等级                      | 状态  |
| ------------------------------ | --------------:| ------- | --------- | ------------------------- | --- |
| `cline-pass/glm-5.3`           | 200K           | 否       | 否         | Off / High / Max（默认 High） | 可用  |
| `cline-pass/glm-5.3-flash`     | 200K           | 否       | 否         | Off / High / Max（默认 High） | 可用  |
| `cline-pass/glm-5.2`           | 200K           | 否       | 否         | Off / High / Max（默认 High） | 可用  |
| `cline-pass/kimi-k3`           | 256K           | 否       | 否         | Low / High / Max          | 可用  |
| `cline-pass/kimi-k2.7-code`    | 256K           | 否       | 否         | Just On                   | 可用  |
| `cline-pass/kimi-k2.6`         | 256K           | 否       | 否         | Off / On                  | 可用  |
| `cline-pass/deepseek-v4.1-flash` | 1M             | 是(只有1M) | 否         | High / Max（默认 High）       | 可用  |
| `cline-pass/mimo-v2.5`         | 128K           | 否       | 否         | 不清楚                       | 可用  |
| `cline-pass/mimo-v2.5-pro`     | 128K           | 否       | 否         | 不清楚                       | 可用  |
| `cline-pass/minimax-m3`        | 1M             | 是(只有1M) | 否         | 不清楚                       | 可用  |
| `cline-pass/qwen3.8-max`       | 1M             | 是(只有1M) | 否         | 不清楚                       | 可用  |
| `cline-pass/qwen3.7-max`       | 1M             | 是(只有1M) | 否         | 不清楚                       | 可用  |
| `cline-pass/qwen3.7-plus`      | 128K           | 否       | 否         | 不清楚                       | 可用  |

## OpenCode Go

> Live 来源：`GET https://opencode.ai/zen/go/v1/models`（2026-07-23，本机 2026-09-15 复核）。
> 当前 live 行仅有 `id/object/created/owned_by`，无 context / effort / protocol 字段。
> 除已固化的 `kimi-k3` 外：`Fast`/`1M` unsupported；推理列标「不清楚」的保持 fail-closed（UI=Disabled）。
> 窗口列标「不清楚」的：不宣称已测死；manifest 可保留可发送的工作估计值，不得写成已验证事实。
> 退役 DeepSeek id（`deepseek-v4-flash` / `deepseek-v4-pro` / `deepseek-v4-flash-*`）admission 直接丢弃，不加 alias。聊天请求带 `x-opencode-session`。

| Name                | Context Window | 1M Max      | Fast Mode | 推理等级                                               | 状态  |
| ------------------- | --------------:| ----------- | --------- | -------------------------------------------------- | --- |
| `kimi-k3`           | 256K           | 是（Max mode） | 否         | Always-on（锁 Max）                                   | 可用  |
| `kimi-k2.7-code`    | 不清楚            | 否           | 否         | 不清楚                                                | 可用  |
| `kimi-k2.6`         | 不清楚            | 否           | 否         | 不清楚                                                | 可用  |
| `kimi-k2.5`         | 不清楚            | 否           | 否         | 不清楚                                                | 可用  |
| `deepseek-v4.1-flash` | 不清楚            | 否           | 否         | 不清楚                                                | 可用  |
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
| `grok-4.5`          | 不清楚            | 否           | 否         | 不清楚                                                | 可用  |

## 本机资格验证快照（2026-08-02）

此节是 credential-scoped 验收记录，不是 manifest 基线真值，也不持久化 secret：

- 本机仍保存 8 个 enabled Provider 配置；本次在最新 Browser/main process 上逐一执行 Provider Test。ChatGPT Account、DeepSeek、ClinePass、Kimi Coding Plan、OpenCode Go、Volcengine Coding Plan 通过；GitHub Copilot 与 Super Grok Account 的当前 OAuth 凭据未通过，UI 因而显示 `Unconfigured`，不得继续把缓存目录计作当前可用模型。
- Kimi authoritative discovery 返回 4 个协议模型；产品选择器投影为 `kimi-for-coding`、`k3`、`k3-256k` 三个 primary 模型，`kimi-for-coding-highspeed` 仅作为 Fast execution target。旧伪身份 `k3[1m]` 已删除；`k3` 的 1M 是账户级 context tier，不是另一个 model id。
- 该日期的 DeepSeek 模型记录仅作为历史凭据测试来源，不据此判断当前模型退役；2026-09-22 的公开事实校正见上方模型表和下方来源表。
- 本次 Provider Test 只证明凭据、目录和默认 route 可用，不等价于聊天成功。`/models` verified 不能代替真实 chat/capability probe。历史全模型 probe 结果不得冒充当前资格；模型级可用性必须由新的 model probe / execution evidence 单独续期。
- Direct Anthropic / Kimi Fast 仍未得到 `usage.speed=fast`，因此不标记当前账户 Fast entitled。1M 只验证真实 activation wire 与官方/manifest 数值，没有伪称完成百万 token 满窗压力测试。

## 校对备注

1. **权威规则**：manifest 是结构能力基线；公开资料校对、历史运行观察和当前账号资格分别记录。表格不代表所有字段都经本机模型调用验证，未证实字段 fail-closed（UI=`Disabled`）。
2. ChatGPT OAuth 不再收录 `gpt-5.4-mini`、`gpt-5.3-codex-spark` 与已明确退役的 `gpt-5.4`。仍在 Codex `models.json` 中的模型，`input_modalities` 含 `image` 时视觉为 supported。
3. Copilot `claude-opus-5` 只作为 `account-entitled` 候选；当前账户 discovery 缺席时不可选，且不继承 Anthropic Direct API Fast。`claude-opus-4.8` 不再绑定 Fast 开关；`claude-opus-4.8-fast` 为独立 primary 可选模型。
4. Kimi Coding Plan：`kimi-for-coding` 固定 1M，推理 Off/Low/High/Max（默认 Max）；账号缺 `highspeed` 时 Fast 可见但禁用；`k3` / `k3-256k` 只接受 Low/High/Max，目录缺席即不可选。
5. Grok `grok-4.3`：常规 500K + Max→1M（注）；推理 Non/Low/Medium/High；`grok-4.6` = L/M/H/Extra（默认 High）；`grok-4.20-reasoning` / `grok-build-0.1` = Just On；multi-agent = L/M/H/Extra。
6. DeepSeek Direct：`deepseek-flash`（V4.1 Flash）与 `deepseek-v4-pro` 均固定 1M、Responses 默认，可见 Off/Low/High/Max；仅 Flash 支持原生视觉。价格基线采用非高峰档，不代表实时账单，高峰档为其两倍。退役 id 不加 alias。Volc/ClinePass/OpenCode 是独立 surface，使用各自平台 id，不得抄 Direct route。
7. Volc：Doubao Fast=否；Kimi K2.7=只有On；附加观测行推理未写清 → fail-closed。
8. ClinePass：写清的档位已入结构控件；wire 待 probe；「不清楚」行保持 unknown。
9. OpenCode Go：仅 `kimi-k3` 窗口/推理已写清；其余「不清楚」不宣称已测；Composer 关档统一 `Disabled`/`禁用`。

## 2026-09-22 事实复核来源

本次复核以改动前 `6b1c2a520fb2c55a04cb194246607c84668bc91a` 为源码基线；最终提交与工程/运行验收另见 acceptance-ledger。下表是公开事实与适用范围，不代表模型调用成功。Manifest 的 `factSources` / `fieldFactSourceIds` 记录字段归属，166 个 models.dev identity 的固定 revision 不变。

| Surface | 字段与裁决 | 官方来源及交叉来源 |
| --- | --- | --- |
| grok-account / xai | 两个 surface 均独立维护 4.7 的 500K、视觉/工具/结构化输出与 Low/Medium/High/Extra。两者各自拥有 `service_tier=priority` Fast binding，entitlement 不跨 surface 继承；OAuth/Builder 当前按用户确认的 Grok 4.7 Fast 能力收敛。 | [模型页](https://docs.x.ai/developers/models/grok-4.7)、[发布](https://x.ai/news/grok-4-7)、[推理](https://docs.x.ai/developers/model-capabilities/text/reasoning)、[Priority](https://docs.x.ai/developers/advanced-api-usage/priority-processing)、[Responses协议](https://docs.x.ai/developers/rest-api-reference/inference/responses)；交接中的9/22账号缓存只作当时资格观察。 |
| xai | 4.6/4.5默认预算500K、4.3预算1M；删除code-fast-1退役入口，按用户要求不保留浮动别名。4.5的Extra在模型页与推理指南冲突，不新增档位。 | [4.6](https://docs.x.ai/developers/models/grok-4.6)、[4.5](https://docs.x.ai/developers/models/grok-4.5)、[退役与4.3规格](https://docs.x.ai/developers/migration/may-15-retirement)、[推理指南](https://docs.x.ai/developers/model-capabilities/text/reasoning) |
| deepseek | Flash原生视觉，Pro无视觉；均支持Responses/Chat/Anthropic、Off/Low/High/Max；Pro继续提供服务。top_p在思考模式有效，不能剥离。价格采用非高峰基线。 | [价格与模型](https://api-docs.deepseek.com/quick_start/pricing/)、[Responses参数枚举](https://api-docs.deepseek.com/api/create-response/)、[Pro正式版](https://api-docs.deepseek.com/news/news260813/)、[Thinking](https://api-docs.deepseek.com/guides/thinking_mode/)、[Anthropic](https://api-docs.deepseek.com/guides/anthropic_api/) |
| chatgpt-account | 当前Astra、三款5.6和5.5支持图像。5.4的retirement_at为2026-08-31，移除OAuth入口；缺席不是本次删除的唯一理由。discovery只收窄账号资格，不覆盖结构能力。 | [Codex目录](https://raw.githubusercontent.com/openai/codex/main/codex-rs/models-manager/models.json)及9/22本机Codex目录缓存交叉；缓存不是实时请求证明，不包含凭据。 |
| openai / openai-us / openai-eu | 5.2-Codex在API退役；5.3-Codex有视觉；5.6仍为Sol现行API别名。 | [退役公告](https://developers.openai.com/api/docs/deprecations)、[5.3规格](https://developers.openai.com/api/docs/models/gpt-5.3-codex)、[Sol与别名](https://developers.openai.com/api/docs/models/gpt-5.6-sol)；Codex目录仅交叉模型模态，不移植OAuth资格。 |
| azure | 恢复5.2-Codex推荐；Azure独立退役时间2027-07-13，不继承OpenAI直连退役。 | [Azure生命周期](https://learn.microsoft.com/en-au/azure/ai-foundry/concepts/model-lifecycle-retirement?view=azureml-api-2)、[Azure规格](https://learn.microsoft.com/en-ie/azure/ai-foundry/foundry-models/concepts/models-sold-directly-by-azure?pivots=azure-direct-others&view=foundry-classic) |
| anthropic | Fable5.1上下文/输出/价格/推理及其它修改字段确认；5.1不支持forced tool use，当前请求链不发送强制tool_choice。 | [5.1规格](https://platform.claude.com/docs/en/models/fable-5-1/overview)、[Effort](https://platform.claude.com/docs/en/build-with-claude/effort)、[价格](https://platform.claude.com/docs/en/about-claude/pricing)、[输出上限](https://platform.claude.com/docs/zh-CN/build-with-claude/thinking) |
| google-ai-studio | 3.8 Flash为1,048,576/65,536；3.7不接受minimal；旧模型补输出上限；删除gemini-pro错误别名。稳定v1 Interactions有效。 | [3.8](https://ai.google.dev/gemini-api/docs/models/gemini-3.8-flash)、[接线指南](https://ai.google.dev/gemini-api/docs/latest-model)、[3.7](https://ai.google.dev/gemini-api/docs/models/gemini-3.7-flash)、[v1 API](https://ai.google.dev/api/interactions-api-v1) |
| github-copilot | Opus4.6与Gemini3.1 Pro于9/1退役；Opus4.8-fast/Gemini3.5不提供1M。精确200K未证实，保留未知窗口，由账号目录提供正数预算后才能执行。 | [支持与退役表](https://docs.github.com/en/copilot/reference/ai-models/supported-models)、[退役公告](https://github.blog/changelog/2026-08-31-selected-github-copilot-models-deprecated/)、[官方原文](https://raw.githubusercontent.com/github/docs/main/content/copilot/reference/ai-models/supported-models.md) |
| groq | Scout/Qwen3-32B通用服务退役有企业合同例外，恢复为account-entitled候选，不能全局删除。 | [退役例外](https://console.groq.com/docs/deprecations)、[通用目录](https://console.groq.com/docs/models) |
| cerebras | Scout与Coder480B已退役，删除，不猜替代型号。 | [退役表](https://inference-docs.cerebras.ai/support/deprecation)、[更新记录](https://inference-docs.cerebras.ai/support/change-log) |
| opencode-go | 清理用户明确授权删除的历史hy3-preview拒绝占位；不称当前模型退役。9/22公开models仍有该ID，与产品文档不一致，本轮未做付费推理重测。 | [公开目录](https://opencode.ai/zen/go/v1/models)、[Go文档](https://opencode.ai/docs/go/) |
| glm-global / glm-global-coding-plan | 5.3/Flash规格与推理确认；删除冗余lockedSelection和无执行映射的sonnet/opus/haiku推荐。 | [5.3](https://docs.z.ai/guides/llm/glm-5.3)、[Flash](https://docs.z.ai/guides/vlm/glm-5.3-flash)、[Thinking](https://docs.z.ai/guides/capabilities/thinking)、[Plan](https://docs.z.ai/devpack/overview) |
| glm-cn / glm-cn-coding-plan | 国内目录及API确认ID、工具、Low/High/Max默认Max；未取得国内独立上下文/视觉/结构化输出证据，新增模型这些字段保持unknown，预算0时拒绝执行，不挪用全球规格。 | [国内Plan](https://docs.bigmodel.cn/cn/coding-plan/overview)、[国内API](https://docs.bigmodel.cn/api-reference/模型-api/对话补全)；详情页多次获取失败。 |
| MiniMax四面 | M3的1M、视觉、工具确认；结构化输出未双源确认，unknown。两协议默认思考状态不同，现有Chat wire不能表达adaptive，推理保持unknown且不发猜测参数；Settings显示未知，不误标关闭。 | [国内目录](https://platform.minimax.cn/docs/guides/models-intro)、[全球目录](https://platform.minimax.io/docs/guides/models-intro)、[发布](https://www.minimax.io/blog/minimax-m3)、[Plan](https://platform.minimax.io/docs/token-plan/intro)、[Anthropic](https://platform.minimax.io/docs/api-reference/text-anthropic-api)、[Chat](https://platform.minimax.io/docs/api-reference/text-openai-api) |
| kimi-coding-plan | kimi-for-coding对应K2.8 Preview，1M、Off/Low/High/Max默认Max；K3关闭思考会换到K2.8 Preview，仍不暴露Off。 | [模型配置](https://www.kimi.com/code/docs/en/kimi-code/models.html)、[OpenCode配置](https://www.kimi.com/code/docs/en/third-party-tools/opencode.html)、[更新](https://www.kimi.com/code/docs/en/kimi-code/whats-new.html) |

文档链接修复只改 `docsUrl`：custom-endpoint、evroc、inferx、morph、privatemode-ai、wafer.ai、wandb、v0、routing-run、crof。未改这些surface的endpoint/protocol；Crof官网重定向Nahcrof不等于API地址变更。v0官方搜索可见文档，直接抓取工具报错，不宣称现场页面读取通过。discovery-only不新增猜测模型，暂缓的Qwen/火山/ClinePass/SAP等事实仍保持原边界。
