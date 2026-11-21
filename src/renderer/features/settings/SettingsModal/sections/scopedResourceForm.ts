import type { ScopedResourceKind } from '@shared/types/rdcRuntime';

export type ResourceFormState = {
  id: string;
  body: string;
  name: string;
  transport: string;
  url: string;
  command: string;
  argsText: string;
  enabled: boolean;
  event: string;
  timeoutMs: string;
  failurePolicy: 'block' | 'warn';
};

export const emptyForm = (kind: ScopedResourceKind, id: string): ResourceFormState => ({
  id,
  body: kind === 'skill'
    ? `---\nname: ${id}\ndescription: Reusable scoped instructions\nallowed-tools: []\n---\n\nDescribe the skill workflow here.`
    : kind === 'policy'
      ? 'deniedTools: []\napproval: mutation\nlimits:\n  contextCompactionPercent: 100'
      : '',
  name: id,
  transport: 'stdio',
  url: '',
  command: '',
  argsText: '[]',
  enabled: true,
  event: 'tool.before-call',
  timeoutMs: '30000',
  failurePolicy: 'warn',
});

export const formFromContent = (kind: ScopedResourceKind, id: string, content: string): ResourceFormState => {
  const base = emptyForm(kind, id);
  if (kind === 'skill' || kind === 'policy' || kind === 'agent') {
    return { ...base, id, body: content };
  }
  if (kind === 'mcp') {
    try {
      const parsed = JSON.parse(content) as {
        id?: string;
        name?: string;
        transport?: string;
        url?: string;
        command?: string;
        args?: unknown[];
        enabledByDefault?: boolean;
      };
      return {
        ...base,
        id: String(parsed.id ?? id),
        name: String(parsed.name ?? parsed.id ?? id),
        transport: String(parsed.transport ?? 'stdio'),
        url: String(parsed.url ?? ''),
        command: String(parsed.command ?? ''),
        argsText: JSON.stringify(Array.isArray(parsed.args) ? parsed.args : [], null, 2),
        enabled: parsed.enabledByDefault !== false,
        body: content,
      };
    } catch {
      return { ...base, id, body: content };
    }
  }
  if (kind === 'hook') {
    try {
      const lines = content.split(/\r?\n/);
      const pick = (key: string): string | undefined => {
        const line = lines.find((entry) => entry.startsWith(`${key}:`));
        return line ? line.slice(key.length + 1).trim() : undefined;
      };
      const failure = pick('failurePolicy');
      return {
        ...base,
        id: pick('id') ?? id,
        enabled: pick('enabled') !== 'false',
        event: pick('event') ?? 'tool.before-call',
        command: pick('command') ?? '',
        argsText: pick('args') ?? '[]',
        timeoutMs: pick('timeoutMs') ?? '30000',
        failurePolicy: failure === 'block' ? 'block' : 'warn',
        body: content,
      };
    } catch {
      return { ...base, id, body: content };
    }
  }
  return { ...base, id, body: content };
};

/** The descriptor the form was opened from, as an object; a new or unreadable one starts empty. */
const parseDescriptor = (body: string): Record<string, unknown> => {
  try {
    const parsed: unknown = JSON.parse(body);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed as Record<string, unknown> : {};
  } catch {
    return {};
  }
};

export const contentFromForm = (kind: ScopedResourceKind, form: ResourceFormState): string => {
  if (kind === 'skill' || kind === 'policy' || kind === 'agent') return form.body;
  if (kind === 'mcp') {
    const args: unknown = JSON.parse(form.argsText);
    if (!Array.isArray(args) || args.some((arg) => typeof arg !== 'string')) {
      throw new Error('Arguments must be a JSON array of strings.');
    }
    // The form edits a few fields of the descriptor; everything else it carries (env, description, …) stays as written.
    const { url: _url, ...original } = parseDescriptor(form.body);
    return JSON.stringify({
      ...original,
      id: form.id,
      name: form.name || form.id,
      transport: form.transport || 'stdio',
      ...(form.transport === 'streamable-http' && form.url.trim() ? { url: form.url.trim() } : {}),
      command: form.command,
      args,
      enabledByDefault: form.enabled,
    }, null, 2);
  }
  if (kind === 'hook') {
    return [
      `id: ${form.id}`,
      `enabled: ${form.enabled}`,
      `event: ${form.event}`,
      `command: ${form.command}`,
      `args: ${form.argsText.trim() || '[]'}`,
      `timeoutMs: ${Number(form.timeoutMs) || 30000}`,
      `failurePolicy: ${form.failurePolicy}`,
    ].join('\n');
  }
  return form.body;
};

/** The name a person gave the resource: a skill's frontmatter name, an MCP server's name, otherwise its id. */
export const resourceDisplayName = (kind: ScopedResourceKind, id: string, content: string): string => {
  if (kind === 'skill') {
    const frontmatter = /^---\r?\n([\s\S]*?)\r?\n---/.exec(content)?.[1] ?? '';
    const name = frontmatter.split(/\r?\n/).find((line) => line.startsWith('name:'))?.slice('name:'.length).trim();
    return name ? name.replace(/^['"]|['"]$/g, '') : id;
  }
  if (kind === 'mcp') return formFromContent('mcp', id, content).name || id;
  return id;
};
