import type { AgentTool, AgentToolResult } from '../../agent/AgentTool';

interface AskUserParams {
  question: string;
}

interface AskUserDetails {
  question: string;
}

export const askUserTool: AgentTool<AskUserParams, AskUserDetails> = {
  name: 'ask_user_question',
  label: '询问用户',
  description: 'Ask the user a clarifying question. Use when requirements are ambiguous or you need confirmation before a destructive action.',
  parameters: {
    type: 'object',
    properties: {
      question: { type: 'string', description: 'The question to present to the user.' },
    },
    required: ['question'],
  },
  spec: { isReadOnly: true, isConcurrencySafe: true, isDestructive: false, sideEffect: 'none', category: 'system', requiresApproval: false },
  permissionHint: 'readonly',

  async execute(_toolCallId, params) {
    const question = params.question.trim();
    if (!question) {
      return { content: [{ type: 'text', text: 'Question is empty.' }], isError: true, details: { question } };
    }
    return {
      content: [{ type: 'text', text: `[Agent asks] ${question}` }],
      details: { question },
    } satisfies AgentToolResult<AskUserDetails>;
  },
};
