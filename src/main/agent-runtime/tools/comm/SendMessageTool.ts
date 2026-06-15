import type { AgentTool, AgentToolResult } from '../../agent/AgentTool';

interface SendMessageParams {
  recipient: string;
  content: string;
}

interface SendMessageDetails {
  recipient: string;
  content: string;
  sent: boolean;
}

export const sendMessageTool: AgentTool<SendMessageParams, SendMessageDetails> = {
  name: 'send_message',
  label: '发送消息',
  description: 'Send a message to another agent or user channel. Use for coordination or delivering results.',
  parameters: {
    type: 'object',
    properties: {
      recipient: { type: 'string', description: 'Target agent ID or channel name.' },
      content: { type: 'string', description: 'Message content to send.' },
    },
    required: ['recipient', 'content'],
  },
  spec: { isReadOnly: false, isConcurrencySafe: true, isDestructive: false, sideEffect: 'network', category: 'comm', requiresApproval: false },
  permissionHint: 'session_mutation',

  async execute(_toolCallId, params) {
    const content = params.content.trim();
    if (!content) {
      return { content: [{ type: 'text', text: 'Content is empty.' }], isError: true, details: { recipient: params.recipient, content, sent: false } };
    }
    return {
      content: [{ type: 'text', text: `[Message to ${params.recipient}] ${content}` }],
      details: { recipient: params.recipient, content, sent: true },
    } satisfies AgentToolResult<SendMessageDetails>;
  },
};
