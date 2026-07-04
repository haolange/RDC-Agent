/**
 * CommandService — 命令执行桥接层。
 *
 * 职责：
 *  - 封装 CommandRegistry.execute()，构建 system message
 *  - 将命令执行结果转换为 ConversationMessage 供渲染层展示
 *  - 协调与 ConversationService、SettingsService、StorageAdapter 的交互
 */

import type {
  CommandExecuteRequest,
  CommandResult,
} from '@shared/types/command';
import type { ConversationMessage } from '@shared/types/conversation';
import { CommandRegistry } from './CommandRegistry';

export class CommandService {
  constructor(private registry: CommandRegistry) {}

  async execute(request: CommandExecuteRequest): Promise<{
    result: CommandResult;
    systemMessage?: ConversationMessage;
  }> {
    const result = await this.registry.execute(request);

    let systemMessage: ConversationMessage | undefined;
    if (result.systemMessage || result.message) {
      systemMessage = this.buildSystemMessage(result, request);
    }

    return { result, systemMessage };
  }

  private buildSystemMessage(
    result: CommandResult,
    request: CommandExecuteRequest,
  ): ConversationMessage {
    const ctx = request.context;
    const commandName = request.input.trim().slice(1).split(/\s+/)[0];
    const now = Date.now();

    return {
      id: `cmd-${now}-${Math.random().toString(36).slice(2, 8)}`,
      turnId: `cmd-turn-${now}`,
      sessionId: ctx?.sessionId ?? null,
      projectId: ctx?.projectId ?? null,
      role: 'system',
      content: result.systemMessage ?? result.message,
      status: result.success ? 'complete' : 'error',
      createdAt: now,
      updatedAt: now,
      workTrace: {
        status: result.success ? 'complete' : 'error',
        summary: result.message,
        blocks: [
          {
            id: `cmd-block-${now}`,
            kind: 'command',
            title: `/${commandName}`,
            status: result.success ? 'complete' : 'error',
            summary: result.data
              ? `${result.message}\n${JSON.stringify(result.data, null, 2)}`
              : result.message,
            toolCalls: [],
            startedAt: now,
            completedAt: now,
          },
        ],
        updatedAt: now,
      },
    };
  }
}
