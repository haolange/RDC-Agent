# RDC-Agent Provider Model Catalog

> 权威矩阵（Wave 1）。种子来自本机校验稿（2026-07-23），后续以仓库本文件为准。  
> `Context Window` 表示常规上下文预算；`1M Max` 单独表示是否支持 1M / Max mode。  
> 「不清楚」或三角证据未齐 → fail-closed：manifest 用 `unknown` / `unsupported` / `none`（按证据选择）；Composer UI 呈现灰掉的 `Disabled` / `禁用`，不发明档位。  
> 同名模型在不同 Provider surface 上的 Fast / 1M / 推理控件彼此独立，不可跨 surface 抄写。  
> 官方文档不可全信；需与 live discovery / 本机 probe / 交叉来源三角验证后再升级事实。

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
| `claude-sonnet-4.6`      | 1M             | 是(只有1M) | 否                     | Low / Medium / High / Max（默认 Medium）               | 可用          |
| `claude-opus-4.6`        | 1M             | 是(只有1M) | 否                     | Low / Medium / High / Max（默认 Medium）               | 不可用(订阅等级原因) |
| `claude-opus-4.8`        | 1M             | 是(只有1M) | 否（与 `*-fast` 关联关系未验证） | Low / Medium / High / Extra / Max（默认 Medium）       | 可用          |
| `claude-opus-4.8-fast`   | 1M             | 是(只有1M) | 独立变体 model；关联关系未验证    | Low / Medium / High / Extra / Max（默认 Medium）       | 可用          |
| `claude-sonnet-5`        | 1M             | 是(只有1M) | 否                     | Low / Medium / High / Extra / Max（默认 Medium）       | 可用          |
| `claude-fable-5`         | 1M             | 是(只有1M) | 否                     | Low / Medium / High / Extra / Max（默认 Medium）       | 可用          |
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

| Name                | Context Window | 1M Max  | Fast Mode | 推理等级                | 状态  |
| ------------------- | --------------:| ------- | --------- | ------------------- | --- |
| `deepseek-v4-pro`   | 1M             | 是(只有1M) | 否         | High / Max（默认 High） | 可用  |
| `deepseek-v4-flash` | 1M             | 是(只有1M) | 否         | High / Max（默认 High） | 可用  |

## Kimi Coding Plan

| Name                        | Context Window | 1M Max | Fast Mode                                                                        | 推理等级                                 | 状态     |
| --------------------------- | --------------:| ------ | -------------------------------------------------------------------------------- | ------------------------------------ | ------ |
| `kimi-for-coding`           | 256K           | 否      | 变体 model：`kimi-for-coding-highspeed`（账号 live catalog 缺目标时 Fast 可见但禁用，文案：当前账户不可用） | Always-on（`thinking_type=only`，锁 On） | 可用     |
| `kimi-for-coding-highspeed` | 256K           | 否      | 否（内部 Fast 目标，不出现在选择器）                                                            | Always-on（锁 On）                      | 账号可能缺席 |
| `k3`                        | 256K           | 是      | 否                                                                                | Low / High / Max                     | 可用     |

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

## 校对备注

1. **权威规则**：本表写清的单元格 = 本机测过的正确信息，manifest 必须对齐；仅「不清楚」才 fail-closed（UI=`Disabled`），不得用审计覆盖已写清事实。  
2. ChatGPT `gpt-5.4-mini`：Fast 保持 unsupported（不跟其它 gpt-5.x 盲抄 `service_tier=priority`）。  
3. Copilot `claude-opus-4.8` 不再绑定 Fast 开关；`claude-opus-4.8-fast` 为独立 primary 可选模型。  
4. Kimi Coding Plan：`kimi-for-coding` Always-on；账号缺 `highspeed` 时 Fast 可见但禁用；`k3` 档位可由 live `think_efforts` 投影。  
5. Grok `grok-4.3`：常规 500K + Max→1M（注）；推理 Non/Low/Medium/High；`grok-4.20-reasoning` / `grok-build-0.1` = Just On；multi-agent = L/M/H/Extra。  
6. DeepSeek / Volc DeepSeek：固定 1M + High/Max（默认 High），无 Off。  
7. Volc：Doubao Fast=否；Kimi K2.7=只有On；附加观测行推理未写清 → fail-closed。  
8. ClinePass：写清的档位已入结构控件；wire 待 probe；「不清楚」行保持 unknown。  
9. OpenCode Go：仅 `kimi-k3` 窗口/推理已写清；其余「不清楚」不宣称已测；Composer 关档统一 `Disabled`/`禁用`。
