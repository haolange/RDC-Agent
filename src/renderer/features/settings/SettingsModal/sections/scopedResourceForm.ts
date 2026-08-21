import type { ScopedResourceKind } from '@shared/types/rdxRuntime';

export type ResourceFormState = {
  id: string;
  body: string;
  name: string;
  transport: string;
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
        command?: string;
        args?: unknown[];
        enabledByDefault?: boolean;
      };
      return {
        ...base,
        id: String(parsed.id ?? id),
        name: String(parsed.name ?? parsed.id ?? id),
        transport: String(parsed.transport ?? 'stdio'),
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

export const contentFromForm = (kind: ScopedResourceKind, form: ResourceFormState): string => {
  if (kind === 'skill' || kind === 'policy' || kind === 'agent') return form.body;
  if (kind === 'mcp') {
    let args: unknown[] = [];
    try { args = JSON.parse(form.argsText) as unknown[]; if (!Array.isArray(args)) args = []; }
    catch { args = []; }
    return JSON.stringify({
      id: form.id,
      name: form.name || form.id,
      transport: form.transport || 'stdio',
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

export const resourceCardMeta = (kind: ScopedResourceKind, content: string): string => {
  if (kind === 'mcp') {
    try {
      const parsed = JSON.parse(content) as { transport?: string; command?: string };
      return [parsed.transport, parsed.command].filter(Boolean).join(' · ');
    } catch { return ''; }
  }
  if (kind === 'hook') {
    const event = content.split(/\r?\n/).find((line) => line.startsWith('event:'));
    return event ? event.slice(6).trim() : '';
  }
  return '';
};
