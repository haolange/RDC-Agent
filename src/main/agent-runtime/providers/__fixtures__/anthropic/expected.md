# anthropic — expected stream shape

Transport: SSE JSON events with Anthropic `type` discriminator.

Happy path (text + tool_call):

1. `message_start` → usage baseline (`input_tokens`).
2. `content_block_start` + `content_block_delta` (`text_delta`) + `content_block_stop` for text at `index`.
3. `content_block_start` with `content_block.type === "tool_use"` then `input_json_delta` for args.
4. `message_delta.stop_reason` (`tool_use` / `end_turn`) then `message_stop`.

Wire messages via `AnthropicProvider.__testing.toAnthropicMessages` (user/assistant/tool_result roles).
