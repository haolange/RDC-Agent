# ollama — expected stream shape

Transport: NDJSON / JSONL (one JSON object per line), not SSE.

Happy path (text + tool_call):

1. Incremental `message.content` string fragments while `done === false`.
2. `message.tool_calls[].function.{name,arguments}` — arguments may be object or string.
3. Final line sets `done: true`, optional `done_reason`, `prompt_eval_count` / `eval_count`.

Wire messages via `OllamaProvider.__testing.toOllamaMessages` (system/user/assistant/tool).
