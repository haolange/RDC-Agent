# Azure OpenAI Responses fixture

Wire format matches OpenAI Responses SSE (`response.output_text.delta`, `response.function_call_arguments.delta`).
Auth uses `api-key` + `api-version` query; secrets must not appear in parsed payloads.
Wire body via `AzureOpenAIResponsesProvider.__testing.buildRequestBody`.
