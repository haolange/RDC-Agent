# google-vertex-anthropic — expected stream shape

Transport: SSE JSON events with Anthropic `type` discriminator, same as Anthropic Messages.

Happy path (text + tool_call):

1. `message_start` → usage baseline.
2. `content_block_start` + `text_delta` for assistant text.
3. `content_block_start` with `tool_use` then `input_json_delta` for args.
4. `message_delta.stop_reason` then `message_stop`.

Wire messages via `AnthropicProvider.__testing.toAnthropicMessages`. Vertex URL uses the Vertex Anthropic operation builder.
