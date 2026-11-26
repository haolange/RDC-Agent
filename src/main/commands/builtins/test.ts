/**
 * /test — 说明如何运行测试。
 */
import { commandText } from '../commandI18n';
import type { CommandDefinition } from '../CommandRegistry';

export const testCommand: CommandDefinition = {
  id: 'test',
  name: 'test',
  descriptionKey: 'test.description',
  category: 'debug',

  async execute() {
    return { success: true, message: commandText('test.hint') };
  },
};
