import fs from 'node:fs';
import { expect, it } from 'vitest';

it('teaches the owning application sessions before cross-capture inference', () => {
  const body = fs.readFileSync('resources/agent-runtime/skills/analyzer-architecture-method/SKILL.md', 'utf8').split('## 双 capture：由应用管理身份')[1];
  expect(body).toBeDefined();
  for (const requirement of ['应用 Capture 入口顺序打开 A、B', '各自 owning Agent session', '不调用 open_replay', '不覆盖 session/context/lease', 'shell.rdx', 'capture hash', '读取两份已保存产物', '不跨 session 借用 live lease', '$cross-capture-alignment', '重复 marker 不唯一', '不用跨文件 ResourceId', '法线/UV', 'unsupported', '观察和推断']) expect(body).toContain(requirement);
});
