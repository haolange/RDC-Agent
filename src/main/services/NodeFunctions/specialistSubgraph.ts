/**
 * specialistSubgraph.ts - Specialist Agent 子图
 * 每个 Specialist 运行独立的 LLM loop + tool calling
 */

import { StateGraph, Annotation, START, END } from '@langchain/langgraph';
import type { DynamicStructuredTool } from '@langchain/core/tools';
import type { AgentRole } from '../../../shared/types/agent';
import type { SpecialistState } from '../../../shared/types/workflow';
import type { LLMRequest } from '../../../shared/types/llm';
import { llmAdapter } from '../../adapters/LLMAdapter';

/** Specialist 子图配置 */
export interface SpecialistSubgraphConfig {
  agentConfigs: Record<AgentRole, {
    systemPrompt: string;
    modelProvider: string;
    modelName: string;
    temperature?: number;
    maxTokens?: number;
  }>;
  rdcTools: DynamicStructuredTool[];
  systemTools: DynamicStructuredTool[];
  skillTools: DynamicStructuredTool[];
}

/** Specialist 子图输入 */
export interface SpecialistInput {
  agentRole: AgentRole;
  objective: string;
  context: {
    caseId: string;
    runId: string;
    sessionId: string;
    capturePaths?: string[];
    userGoal?: string;
  };
}

/** Specialist 子图状态 */
interface SpecialistSubgraphState {
  agentRole: AgentRole;
  objective: string;
  context: SpecialistInput['context'];
  messages: Array<{ role: 'system' | 'user' | 'assistant' | 'tool'; content: string; tool_call_id?: string; name?: string }>;
  toolCalls: Array<{ id: string; name: string; arguments: Record<string, unknown> }>;
  iterationCount: number;
  brief: string;
  artifacts: string[];
  status: 'running' | 'completed' | 'failed' | 'timeout';
  error?: string;
}

/** 子图状态注解 */
const SpecialistAnnotation = Annotation.Root({
  agentRole: Annotation<AgentRole>({
    reducer: (_, b) => b,
    default: () => 'triage_agent' as AgentRole,
  }),
  objective: Annotation<string>({
    reducer: (_, b) => b,
    default: () => '',
  }),
  context: Annotation<SpecialistInput['context']>({
    reducer: (_, b) => b,
    default: () => ({ caseId: '', runId: '', sessionId: '' }),
  }),
  messages: Annotation<SpecialistSubgraphState['messages']>({
    reducer: (a, b) => [...a, ...b],
    default: () => [],
  }),
  toolCalls: Annotation<SpecialistSubgraphState['toolCalls']>({
    reducer: (a, b) => [...a, ...b],
    default: () => [],
  }),
  iterationCount: Annotation<number>({
    reducer: (_, b) => b,
    default: () => 0,
  }),
  brief: Annotation<string>({
    reducer: (_, b) => b,
    default: () => '',
  }),
  artifacts: Annotation<string[]>({
    reducer: (a, b) => [...a, ...b],
    default: () => [],
  }),
  status: Annotation<SpecialistSubgraphState['status']>({
    reducer: (_, b) => b,
    default: () => 'running',
  }),
  error: Annotation<string | undefined>({
    reducer: (_, b) => b,
    default: () => undefined,
  }),
});

export type SpecialistSubgraphStateType = typeof SpecialistAnnotation.State;

/** 最大迭代次数 */
const MAX_ITERATIONS = 10;

/**
 * 创建 Specialist 子图
 */
export function createSpecialistSubgraph(config: SpecialistSubgraphConfig) {
  // 合并所有可用工具
  const allTools = [
    ...config.rdcTools,
    ...config.systemTools,
    ...config.skillTools,
  ];

  // 工具调用节点
  async function llmCallNode(state: SpecialistSubgraphStateType): Promise<Partial<SpecialistSubgraphStateType>> {
    const agentConfig = config.agentConfigs[state.agentRole];
    if (!agentConfig) {
      return {
        status: 'failed',
        error: `Agent config not found for ${state.agentRole}`,
      };
    }

    // 初始化消息（如果是第一次调用）
    let messages = state.messages;
    if (messages.length === 0) {
      messages = [
        { role: 'system', content: agentConfig.systemPrompt },
        { role: 'user', content: state.objective },
      ];
    }

    try {
      // 构建 LLM 请求
      const request: LLMRequest = {
        messages: messages.map(m => ({
          role: m.role === 'tool' ? 'assistant' : m.role,
          content: m.content,
        })),
        model: agentConfig.modelName,
        maxTokens: agentConfig.maxTokens || 4096,
        temperature: agentConfig.temperature ?? 0.7,
        tools: allTools.map(t => ({
          name: t.name,
          description: t.description,
          input_schema: {
            type: 'object',
            properties: {},
          },
        })),
      };

      // 调用 LLM
      const response = await llmAdapter.chat(request, agentConfig.modelProvider);

      // 解析响应
      const content = typeof response.content === 'string'
        ? response.content
        : JSON.stringify(response.content);

      // 检查是否有工具调用
      if (response.toolCalls && response.toolCalls.length > 0) {
        const toolCalls = response.toolCalls.map(tc => ({
          id: tc.id,
          name: tc.name,
          arguments: tc.arguments,
        }));

        return {
          messages: [{ role: 'assistant', content }, ...toolCalls.map(tc => ({
            role: 'assistant' as const,
            content: `Tool call: ${tc.name}`,
          }))],
          toolCalls,
          iterationCount: state.iterationCount + 1,
        };
      }

      // 没有工具调用，任务完成
      return {
        messages: [{ role: 'assistant', content }],
        brief: content,
        status: 'completed',
        iterationCount: state.iterationCount + 1,
      };
    } catch (error) {
      return {
        status: 'failed',
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  // 工具执行节点
  async function toolExecutionNode(state: SpecialistSubgraphStateType): Promise<Partial<SpecialistSubgraphStateType>> {
    const results: SpecialistSubgraphStateType['messages'] = [];
    const artifacts: string[] = [];

    for (const toolCall of state.toolCalls) {
      const tool = allTools.find(t => t.name === toolCall.name);
      if (!tool) {
        results.push({
          role: 'tool',
          content: JSON.stringify({ error: `Tool not found: ${toolCall.name}` }),
          tool_call_id: toolCall.id,
          name: toolCall.name,
        });
        continue;
      }

      try {
        const result = await tool.invoke(toolCall.arguments);
        results.push({
          role: 'tool',
          content: typeof result === 'string' ? result : JSON.stringify(result),
          tool_call_id: toolCall.id,
          name: toolCall.name,
        });

        // 如果工具返回工件路径，记录到 artifacts
        if (typeof result === 'string') {
          try {
            const parsed = JSON.parse(result);
            if (parsed.artifactPath) {
              artifacts.push(parsed.artifactPath);
            }
          } catch {
            // 不是 JSON，忽略
          }
        }
      } catch (error) {
        results.push({
          role: 'tool',
          content: JSON.stringify({
            error: error instanceof Error ? error.message : String(error),
          }),
          tool_call_id: toolCall.id,
          name: toolCall.name,
        });
      }
    }

    return {
      messages: results,
      artifacts: [...state.artifacts, ...artifacts],
      toolCalls: [], // 清空已处理的工具调用
    };
  }

  // 条件路由：检查是否需要继续迭代
  function routeAfterLLMCall(state: SpecialistSubgraphStateType): string {
    // 检查是否失败
    if (state.status === 'failed') {
      return END;
    }

    // 检查是否完成
    if (state.status === 'completed') {
      return END;
    }

    // 检查是否超时（迭代次数过多）
    if (state.iterationCount >= MAX_ITERATIONS) {
      return 'timeout';
    }

    // 检查是否有待处理的工具调用
    if (state.toolCalls.length > 0) {
      return 'tool_execution';
    }

    // 继续 LLM 调用
    return 'llm_call';
  }

  // 超时处理节点
  async function timeoutNode(state: SpecialistSubgraphStateType): Promise<Partial<SpecialistSubgraphStateType>> {
    return {
      status: 'timeout',
      error: `Max iterations (${MAX_ITERATIONS}) exceeded`,
      brief: state.brief || `Task timed out after ${MAX_ITERATIONS} iterations. Partial results may be available.`,
    };
  }

  // 构建子图
  const graph = new StateGraph(SpecialistAnnotation)
    .addNode('llm_call', llmCallNode)
    .addNode('tool_execution', toolExecutionNode)
    .addNode('timeout', timeoutNode)
    .addEdge(START, 'llm_call')
    .addConditionalEdges('llm_call', routeAfterLLMCall, {
      tool_execution: 'tool_execution',
      timeout: 'timeout',
      [END]: END,
    })
    .addEdge('tool_execution', 'llm_call')
    .addEdge('timeout', END);

  return graph.compile();
}

/** Specialist 子图输出 */
export interface SpecialistSubgraphOutput {
  brief: string;
  artifacts: string[];
  status: SpecialistState['status'];
  error?: string;
}

/**
 * 运行 Specialist 子图（简化接口）
 */
export async function runSpecialistSubgraph(
  input: SpecialistInput,
  config: SpecialistSubgraphConfig
): Promise<SpecialistSubgraphOutput> {
  const subgraph = createSpecialistSubgraph(config);
  
  const result = await subgraph.invoke({
    agentRole: input.agentRole,
    objective: input.objective,
    context: input.context,
    messages: [],
    toolCalls: [],
    iterationCount: 0,
    brief: '',
    artifacts: [],
    status: 'running',
  });

  return {
    brief: result.brief,
    artifacts: result.artifacts,
    status: result.status,
    error: result.error,
  };
}
