import { describe, expect, it } from 'vitest';
import { parseAgentMarkdownStrict, serializeAgentMarkdown } from './agentManifestParse';

const wrap = (frontmatter: string, body = 'instructions') => `---\n${frontmatter}\n---\n\n${body}\n`;

describe('strict agent manifest parse', () => {
  it('rejects model fields, which moved to Settings, and round trips based-on', () => {
    for (const field of ['model: [openai:gpt]', 'reasoning-level: high']) {
      const parsed = parseAgentMarkdownStrict(wrap(`name: Review\n${field}`), 'review.agent.md', 'review', 't', false);
      expect(parsed.ok || parsed.reason).toMatch(/^AGENT_MANIFEST_FIELD_MOVED: /u);
    }
    const handoff = parseAgentMarkdownStrict(wrap('name: Review\nhandoffs:\n  - {label: Go, agent: general, prompt: Run., model: openai:gpt}'), 'review.agent.md', 'review', 't', false);
    expect(handoff.ok || handoff.reason).toMatch(/^AGENT_MANIFEST_FIELD_MOVED: handoffs\[0\]\.model/u);
    const basedOn = 'a'.repeat(64);
    const parsed = parseAgentMarkdownStrict(wrap(`name: Review\nbased-on: ${basedOn}`), 'review.agent.md', 'review', 't', false);
    if (!parsed.ok) throw new Error(parsed.reason);
    const again = parseAgentMarkdownStrict(serializeAgentMarkdown(parsed.definition), 'review.agent.md', 'review', 't', false);
    expect(again.ok && again.definition.basedOn).toBe(basedOn);
    expect(parseAgentMarkdownStrict(wrap('name: Review\nbased-on: abc'), 'review.agent.md', 'review', 't', false).ok).toBe(false);
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

  it('reads shipped description and argument-hint translations but never writes them to a copy', () => {
    const parsed = parseAgentMarkdownStrict(wrap([
      'name: Review', 'description: Review evidence.', 'argument-hint: Task and evidence',
      'description-translations:', '  zh-CN: 审查证据。', 'argument-hint-translations:', '  zh-CN: 任务与证据',
    ].join('\n')), 'review.agent.md', 'review', 't', true);
    if (!parsed.ok) throw new Error(parsed.reason);
    expect(parsed.definition).toMatchObject({ descriptionTranslations: { 'zh-CN': '审查证据。' }, argumentHintTranslations: { 'zh-CN': '任务与证据' } });
    expect(serializeAgentMarkdown(parsed.definition)).not.toContain('translations');
    expect(parseAgentMarkdownStrict(wrap('name: Review\ndescription-translations:\n  fr: Revue'), 'review.agent.md', 'review', 't', true).ok).toBe(false);
  });

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
