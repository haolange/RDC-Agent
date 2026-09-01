import { describe, expect, it } from 'vitest';
import { parseAgentMarkdownStrict } from './agentManifestParse';

const wrap = (frontmatter: string, body = 'instructions') => `---\n${frontmatter}\n---\n\n${body}\n`;

describe('strict agent manifest parse', () => {
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
