# google-vertex-gemini — expected stream shape

Transport: SSE (`alt=sse`) JSON chunks with `candidates[0].content.parts`, same Gemini generateContent shape as AI Studio.

Happy path (text + tool_call):

1. Text part: `{ text: "..." }` without `thought: true`.
2. Tool part: `{ functionCall: { name, args } }`.
3. Optional `finishReason` and `usageMetadata` on a later chunk.

Wire contents via `GeminiProvider.__testing.toGeminiContents`. Vertex URL uses the Vertex generateContent operation builder.
