import type { AgentTool, AgentToolResult } from '../../agent/AgentTool';

interface AgentSpawnParams {
  task: string;
  context?: string;
}

interface AgentSpawnDetails {
  task: string;
  spawned: boolean;
}

export const agentSpawnTool: AgentTool<AgentSpawnParams, AgentSpawnDetails> = {
  name: 'agent_spawn',
  label: '启动子 Agent',
  description: 'Spawn a sub-agent to handle a parallel or independent task. The sub-agent will report back when complete.',
  parameters: {
    type: 'object',
    properties: {
      task: { type: 'string', description: 'Description of the task for the sub-agent.' },
      context: { type: 'string', description: 'Optional context or constraints to pass to the sub-agent.' },
    },
    required: ['task'],
  },
  spec: { isReadOnly: false, isConcurrencySafe: false, isDestructive: false, sideEffect: 'session', category: 'system', requiresApproval: true },
  permissionHint: 'session_mutation',

  async execute(_toolCallId, params) {
    const task = params.task.trim();
    if (!task) {
      return { content: [{ type: 'text', text: 'Task is empty.' }], isError: true, details: { task, spawned: false } };
    }
    return {
      content: [{ type: 'text', text: `[Sub-agent spawned] Task: ${task}${params.context ? `\nContext: ${params.context}` : ''}` }],
      details: { task, spawned: true },
    } satisfies AgentToolResult<AgentSpawnDetails>;
  },
};
