import type { AgentRole } from '@shared/types/agent';
import type { ToolCallResult, ToolDefinition } from '@shared/types/tool';
import { toolBridge } from '../../services/ToolBridge';
import type { AgentToolExecutionRequest, AgentToolPort } from './AgentRunnerPort';

export class ToolBridgeAgentToolPort implements AgentToolPort {
  async listTools(_agentId: AgentRole): Promise<ToolDefinition[]> {
    const catalog = await toolBridge.loadCatalog();
    return catalog.tools ?? [];
  }

  execute(request: AgentToolExecutionRequest): Promise<ToolCallResult> {
    return toolBridge.call({
      toolName: request.toolName,
      args: request.args,
      runId: request.runId,
      turnId: request.turnId,
      contextId: request.contextId,
      runtimeOwner: request.runtimeOwner,
      ownerLeaseId: request.ownerLeaseId,
      abortSignal: request.signal,
    });
  }
}

export const toolBridgeAgentToolPort = new ToolBridgeAgentToolPort();
