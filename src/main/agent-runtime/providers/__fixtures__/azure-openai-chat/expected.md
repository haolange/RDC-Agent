# azure-openai-chat — expected stream shape

Transport: SSE chat-completions chunks, same `choices[0].delta` contract as openai-compatible.

Happy path (text + tool_call):

1. `choices[0].delta.content` string deltas accumulate assistant text.
2. `choices[0].delta.tool_calls[]` carries `id`, `function.name`, `function.arguments`.
3. Terminal choice sets `finish_reason` (`tool_calls` / `stop`).

Request wire uses `/chat/completions` plus Azure `api-version` query. Secret headers stay off RequestPlan.
