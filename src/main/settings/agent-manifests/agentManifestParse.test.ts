import { describe, expect, it } from 'vitest';
import { parseAgentMarkdownStrict, serializeAgentMarkdown } from './agentManifestParse';

const wrap = (frontmatter: string, body = 'instructions') => `---\n${frontmatter}\n---\n\n${body}\n`;

describe('strict agent manifest parse', () => {
  it('round trips an Agent reasoning default and rejects an invalid selection', () => {
    const parsed = parseAgentMarkdownStrict(wrap('name: Review\nreasoning-level: high'), 'review.agent.md', 'review', 't', false);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) throw new Error(parsed.reason);
    expect(parsed.definition.reasoningLevel).toBe('high');
    const again = parseAgentMarkdownStrict(serializeAgentMarkdown(parsed.definition), 'review.agent.md', 'review', 't', false);
    expect(again.ok && again.definition.reasoningLevel).toBe('high');
    expect(parseAgentMarkdownStrict(wrap('name: Review\nreasoning-level: extreme'), 'review.agent.md', 'review', 't', false).ok).toBe(false);
  });
  it('round trips declared translations without changing the handoff identity', () => {
    const parsed = parseAgentMarkdownStrict(wrap(`name: Custom
handoffs:
  - label: Implement Plan
    labelTranslations: {zh-CN: 执行计划, en: Implement Plan}
    agent: general
    prompt: Execute the approved plan.`), 'custom.agent.md', 'custom', 't', false);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) throw new Error(parsed.reason);
    const again = parseAgentMarkdownStrict(serializeAgentMarkdown(parsed.definition), 'custom.agent.md', 'custom', 't', false);
    expect(again.ok && again.definition.handoffs).toEqual(parsed.definition.handoffs);
    expect(parsed.definition.handoffs[0]).toMatchObject({ label: 'Implement Plan', labelTranslations: { 'zh-CN': '执行计划' } });
  });

  it.each(['{}', 'null', '[]', '{fr: Executer}', '{en: " "}', '{en: 42}', `{en: "${'x'.repeat(201)}"}`])(
    'rejects malformed labelTranslations %s', value => {
      const parsed = parseAgentMarkdownStrict(wrap(`name: Custom
handoffs:
  - label: Execute
    labelTranslations: ${value}
    agent: general
    prompt: Go`), 'custom.agent.md', 'custom', 't', false);
      expect(parsed).toMatchObject({ ok: false, reason: expect.stringContaining('labelTranslations') });
    },
  );

  it('accepts omitted or empty handoffs as a legal no-handoff profile', () => {
    expect(parseAgentMarkdownStrict(wrap('name: Custom\ntools:\n  - read\n'), 'x.agent.md', 'custom', 't', false).ok).toBe(true);
    expect(parseAgentMarkdownStrict(wrap('name: Custom\ntools:\n  - read\nhandoffs: []\n'), 'x.agent.md', 'custom', 't', false).ok).toBe(true);
  });

  it('invalidates the whole candidate when any handoff entry is malformed', () => {
    const parsed = parseAgentMarkdownStrict(wrap(`
name: Broken
tools:
  - read
handoffs:
  - label: Go
    agent: general
    prompt: ''
`), 'x.agent.md', 'broken', 't', false);
    expect(parsed.ok).toBe(false);
  });

  it('invalidates unknown or rejected tool tokens instead of filtering them', () => {
    const parsed = parseAgentMarkdownStrict(wrap('name: Bad\ntools:\n  - bash\n'), 'x.agent.md', 'bad', 't', false);
    expect(parsed.ok).toBe(false);
  });
});
