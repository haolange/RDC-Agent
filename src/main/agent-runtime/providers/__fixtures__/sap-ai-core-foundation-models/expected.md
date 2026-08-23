# sap-ai-core-foundation-models — expected stream shape

Transport: AI SDK JSONL chunks consumed by `AiSdkStreamingProvider`.

Happy path (text + tool_call):

1. `text-start` / `text-delta` / `text-end` accumulate assistant text.
2. `tool-input-start` + `tool-input-delta` + `tool-call` carry `toolName` and structured `input`.
3. `finish.finishReason` is `tool-calls` when a native tool is requested.

HTTP operation URL is `/inference/deployments/{deploymentId}/chat/completions`. Deployment id is a connection value, not a catalog secret.
