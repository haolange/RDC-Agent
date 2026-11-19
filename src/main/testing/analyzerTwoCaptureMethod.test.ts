import fs from 'node:fs';
import { expect, it } from 'vitest';

it('teaches approved same-session switching and restoration before cross-capture inference', () => {
  const body = fs.readFileSync('resources/agent-runtime/skills/analyzer-architecture-method/SKILL.md', 'utf8').split('## 多 capture：由应用管理身份')[1];
  expect(body).toBeDefined();
  for (const requirement of ['批准计划冻结的 inputId', '同一产品 session', 'capture_select(inputId)', '不直接调用 open_replay',
    'shell.rdc', 'capture hash', '比较已保存材料', '不跨身份借用 live lease', 'capture_restore', '恢复失败须保留缺口',
    '$cross-capture-alignment', '重复 marker 不唯一', '不用跨文件 ResourceId', '法线/UV', 'unsupported', '观察和推断']) {
    expect(body).toContain(requirement);
  }
  expect(body).not.toContain('各自 owning Agent session');
});
