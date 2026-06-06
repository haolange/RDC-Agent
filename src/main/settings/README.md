# Settings

## Provider / Account Runtime Boundary

- `ProviderAccountAuthService` 统一 ChatGPT Account、Claude Account、GitHub Copilot、Grok Account、Gemini Account、Qwen Account 的 account login/status/test/logout 状态机。
- Grok/Gemini/Qwen 当前交付为 mock-verifiable account adapters：`RDC_AGENT_TEST_MODE=1` 可完成 start/finish/model catalog；非测试环境返回 live OAuth contract blocker，不伪装真实 OAuth 已完成。
- `SettingsService` 只把 runtime credential 解析给主进程 provider adapter，renderer-facing settings 不回传 API key、OAuth token 或 account secret。
- `ModelProviderRegistry` 是 runtime capability matrix 入口；OpenAI-compatible/local/environment provider 都必须通过该能力边界与 runtime policy 连接。

设置、profile、provider、model route 和 secret 的领域入口。

当前实现仍由 `SettingsService`、`SecretStorageService`、`LLMAdapter` 和 `DebuggerLlmService` 共同承担。本目录用于后续拆分 provider/model route 失败路径与诊断边界。

