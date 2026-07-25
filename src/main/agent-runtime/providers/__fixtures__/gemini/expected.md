# gemini — expected stream shape

Transport: SSE (`alt=sse`) JSON chunks with `candidates[0].content.parts`.

Happy path (text + tool_call):

1. Text part: `{ text: "..." }` without `thought: true`.
2. Tool part: `{ functionCall: { name, args } }` — args already structured (not JSON string).
3. Optional `finishReason` and `usageMetadata` on a later chunk.

Wire contents via `GeminiProvider.__testing.toGeminiContents` → `{ systemInstruction?, contents[] }`.
