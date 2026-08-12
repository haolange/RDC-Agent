# Bedrock Converse Stream fixture

Bedrock uses `event:` + `data:` SSE with `contentBlockDelta` / `contentBlockStart` / `messageStop`.
Tool use arrives as `toolUse` blocks; usage is in `metadata.usage`.
Wire messages via `BedrockConverseProvider.__testing.toBedrockMessages`.
