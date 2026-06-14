/**
 * /test — 运行测试或查看测试状态。
 */
import type { CommandDefinition } from '@shared/types/command';

export const testCommand: CommandDefinition = {
  id: 'test',
  name: 'test',
  description: 'Run tests or view test status',
  category: 'debug',

  async execute(_args) {
    return {
      success: true,
      message: 'Test runner: Use `npm test` to run unit tests, or `npm run typecheck` for type checking.',
    };
  },
};
