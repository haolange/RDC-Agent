# gitlab-duo — expected stream shape

Transport: AI SDK JSONL chunks consumed by `AiSdkStreamingProvider`.

Happy path (text + tool_call):

1. `text-start` / `text-delta` / `text-end` accumulate assistant text.
2. `tool-input-start` + `tool-input-delta` + `tool-call` carry `toolName` and structured `input`.
3. `finish.finishReason` is `tool-calls` when a native tool is requested.

SDK operation URL is the GitLab Duo agentic-chat websocket path. Secret tokens stay in the credential lease, not RequestPlan headers.
