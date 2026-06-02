import fs from 'fs';
import path from 'path';
import { expect, test } from '@playwright/test';
import {
  ASK_READONLY_TOOL_ALLOWLIST,
  isRuntimeToolAllowed,
  resolveRuntimeToolAllowlist,
  toolMatchesRuntimePolicy,
} from '../src/main/agent-runtime/AgentRuntimeToolPolicy';

test('Ask runtime policy is readonly and denies bash/write/edit/remove', () => {
  expect(resolveRuntimeToolAllowlist('ask_agent')).toEqual(ASK_READONLY_TOOL_ALLOWLIST);
  expect(isRuntimeToolAllowed('primitive.read', 'ask_agent')).toBe(true);
  expect(isRuntimeToolAllowed('primitive.glob', 'ask_agent')).toBe(true);
  expect(isRuntimeToolAllowed('primitive.grep', 'ask_agent')).toBe(true);
  expect(isRuntimeToolAllowed('primitive.webFetch', 'ask_agent')).toBe(true);
  expect(isRuntimeToolAllowed('primitive.webSearch', 'ask_agent')).toBe(true);
  expect(isRuntimeToolAllowed('primitive.bash', 'ask_agent')).toBe(false);
  expect(isRuntimeToolAllowed('primitive.write', 'ask_agent')).toBe(false);
  expect(isRuntimeToolAllowed('primitive.edit', 'ask_agent')).toBe(false);
  expect(isRuntimeToolAllowed('primitive.remove', 'ask_agent')).toBe(false);
});

test('Runtime tool policy supports exact and namespace allow patterns', () => {
  expect(toolMatchesRuntimePolicy('rd.session.get_context', ['rd.session.*'])).toBe(true);
  expect(toolMatchesRuntimePolicy('rd.shader.edit_and_replace', ['rd.session.*'])).toBe(false);
  expect(toolMatchesRuntimePolicy('ui.ask_user_question', ['ui.ask_user_question'])).toBe(true);
});

test('Plan-generate-verify pattern keeps planner before generator before evaluator', () => {
  const patternPath = path.join(process.cwd(), 'resources', 'agent-runtime', 'patterns', 'plan-generate-verify.json');
  const pattern = JSON.parse(fs.readFileSync(patternPath, 'utf8')) as {
    id: string;
    finalStatusOwner: string;
    stages: Array<{ phase: string; requiresApproval?: boolean }>;
  };

  expect(pattern.id).toBe('plan-generate-verify');
  expect(pattern.finalStatusOwner).toBe('runtime');
  expect(pattern.stages.map((stage) => stage.phase)).toEqual(['planner', 'generator', 'evaluator']);
  expect(pattern.stages[0].requiresApproval).toBe(true);
});
