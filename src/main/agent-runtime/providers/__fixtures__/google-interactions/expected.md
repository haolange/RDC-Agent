# google-interactions — expected stream shape

Transport: SSE with optional `event:` lines; payload in `data:` JSON (`event_type`).

Happy path (text + tool_call):

1. `interaction.created` establishes `interaction.id` (provider state carrier).
2. `step.start` / `step.delta` / `step.stop` for `step.type === "text"`.
3. `step.start` with `function_call` + `arguments_delta` for tool args.
4. `interaction.requires_action` / completed carries usage; `data: [DONE]` ends the stream.

Wire body via `buildGoogleInteractionsRequest` → `{ model, input, stream: true, tools? }`.
