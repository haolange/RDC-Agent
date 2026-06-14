/**
 * PlanModeTools — enter_plan_mode / exit_plan_mode AgentTools。
 */
import type { AgentTool, AgentToolResult } from '../agent/AgentTool';

export function createEnterPlanModeTool(): AgentTool {
  return {
    name: 'enter_plan_mode',
    label: 'Enter Plan Mode',
    description: 'Enter plan mode to design an implementation strategy before writing code. In plan mode, the agent explores and designs but does not make changes.',
    parameters: { type: 'object', properties: {}, required: [] },
    permissionHint: 'readonly',
    async execute() {
      return {
        content: [{ type: 'text', text: 'Entered plan mode. Describe your task and I will design an implementation plan for your approval.' }],
        isError: false,
      } satisfies AgentToolResult;
    },
  };
}

export function createExitPlanModeTool(): AgentTool {
  return {
    name: 'exit_plan_mode',
    label: 'Exit Plan Mode',
    description: 'Exit plan mode and present the plan for user approval before implementation',
    parameters: {
      type: 'object',
      properties: {
        allowedPrompts: {
          type: 'array',
          items: { type: 'object', properties: { tool: { type: 'string' }, prompt: { type: 'string' } } },
          description: 'Permissions needed for implementation',
        },
      },
      required: [],
    },
    permissionHint: 'readonly',
    async execute() {
      return {
        content: [{ type: 'text', text: 'Plan complete. Ready for user approval.' }],
        isError: false,
      } satisfies AgentToolResult;
    },
  };
}

export function createPlanModeTools(): AgentTool[] {
  return [createEnterPlanModeTool() as unknown as AgentTool, createExitPlanModeTool() as unknown as AgentTool];
}
