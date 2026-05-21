# Settings

设置、profile、provider、model route 和 secret 的领域入口。

当前实现仍由 `SettingsService`、`SecretStorageService`、`LLMAdapter` 和 `DebuggerLlmService` 共同承担。本目录用于后续拆分 provider/model route 失败路径与诊断边界。
