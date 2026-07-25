# openai-responses — expected stream shape

Transport: SSE event objects keyed by `type`.

Happy path (text + tool_call):

1. `response.output_text.delta` / `done` for assistant text (`delta` or `text`).
2. `response.output_item.added` with `item.type === "function_call"` starts a tool call (`call_id`, `name`).
3. `response.function_call_arguments.delta` / `done` stream JSON argument bytes.
4. `response.completed` is terminal; further semantic events must fail-closed.

Wire body: `{ model, input, stream: true, tools?, tool_choice? }` via `OpenAIResponsesProvider.__testing.buildRequestBody`.
