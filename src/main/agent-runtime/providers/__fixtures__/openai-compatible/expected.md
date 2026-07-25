# openai-compatible — expected stream shape

Transport: SSE (`data:` lines, terminal `[DONE]`).

Happy path (text + tool_call):

1. `choices[0].delta.content` string deltas accumulate assistant text.
2. `choices[0].delta.tool_calls[]` carries `id`, `function.name`, `function.arguments` (JSON string fragments).
3. Terminal choice sets `finish_reason` (`tool_calls` / `stop`); optional `usage` on the last chunk.
4. Parser stops at `data: [DONE]`.

RequestPlan must not carry secret headers (`authorization`, `*api-key*`, cookies); wire URL is `/chat/completions`.
