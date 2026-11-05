# Provider model catalog

当前模型目录以编译后的 provider manifest 和 `src/shared/provider-catalog/implementationRegistry.ts` 为准。账号可见性来自 credential-scoped discovery，route、控件和 continuation 以 wire review 为准。三者合成 Effective Catalog。

历史 surface 复核表已收进 [`acceptance-ledger.md`](acceptance-ledger.md)。本文件不再复制模型清单。


Settings 支持对全部已配置 Provider 或当前 Provider 准备批量能力探测。开始前显示模型与请求数；调用消耗账号额度，每项只发最小请求，不做长输入压力测试。默认、Fast、Max 以及独立组合 binding 分项呈现；未验证明确保留原因，不能等同不支持。固定 Max 与默认请求合并，禁用模型不自动启用；取消会等待当前请求释放。重试只针对上一批未通过项。

ChatGPT OAuth 已维护精确型号 `gpt-6.1-terra`。模型公开窗口、当前账号服务窗口、输入预算、输出上限及压缩阈值不得互换；字段裁决及证据见 [Provider 架构](../architecture/provider-architecture.md)。

ChatGPT 登录的 Codex 已退役 `gpt-5.5`，因此该型号退出 ChatGPT OAuth 活动目录。历史会话保留原模型记录，继续使用时需重选模型。Fast 开关表示可请求 Priority，探测结果另列请求档位和服务端实际档位。[OpenAI 退役公告](https://learn.chatgpt.com/docs/changelog?date=2026-10-15#gpt-55-retirement-in-codex)

Grok 订阅使用 Grok Build 的当前账号目录。完整目录缺席的模型在 Settings 显示原因，从 Composer 可选项和批量实际请求中排除。目录无法完整刷新时显示错误并保留最近一次成功观察的证据。
