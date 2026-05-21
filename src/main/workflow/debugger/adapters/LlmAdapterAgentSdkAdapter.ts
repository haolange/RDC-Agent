import type { LLMMessage } from '@shared/types/llm';
import { llmAdapter } from '../../../adapters/LLMAdapter';
import type { AgentRunRequest, AgentRunResult, AgentSdkAdapter, AgentToolPort } from '../AgentRunnerPort';

export class LlmAdapterAgentSdkAdapter implements AgentSdkAdapter {
  readonly id = 'rdc-llm-adapter';

  canRun(_request: AgentRunRequest): boolean {
    return true;
  }

  async run(request: AgentRunRequest, _tools: AgentToolPort): Promise<AgentRunResult> {
    const messages: LLMMessage[] = [
      { role: 'system', content: request.systemPrompt },
      { role: 'user', content: request.prompt },
    ];
    let streamedContent = '';
    const response = await llmAdapter.streamChat(
      {
        messages,
        model: request.modelId,
        maxTokens: request.maxTokens,
        temperature: request.temperature,
        signal: request.signal,
      },
      (event) => {
        request.onStreamEvent?.(event);
        if (event.type === 'text-delta') {
          streamedContent += event.text;
          request.onChunk?.(event.text);
        }
      },
      request.providerId,
    );

    const fallbackContent = typeof response.content === 'string'
      ? response.content
      : JSON.stringify(response.content);

    return {
      agentId: request.agentId,
      providerId: request.providerId,
      modelId: request.modelId,
      text: streamedContent || fallbackContent,
      toolResults: [],
      usage: response.usage,
      trace: {
        adapter: this.id,
        responseId: response.id,
      },
    };
  }
}
