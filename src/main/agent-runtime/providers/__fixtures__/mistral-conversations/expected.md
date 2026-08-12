# Mistral Conversations fixture

Mistral chat completions are OpenAI-compatible SSE chunks (`choices[].delta.content` + `tool_calls`).
Wire messages via `MistralProvider.__testing.toMistralMessages`.
Secrets in Authorization headers must be stripped by `requestPlanHeaders`.
