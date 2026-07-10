import React, { useMemo, useState } from 'react';
import type { RdxRuntimeOverview, ScopedResourceDocument, ScopedResourceKind } from '@shared/types/rdxRuntime';

const templateFor = (kind: ScopedResourceKind, id: string): string => {
  if (kind === 'agent') return `---\nname: ${id}\ndescription: Project agent override\nenabled: true\ntools: []\nskills: []\nmcp-servers: []\n---\n\nFollow the effective RDX instructions and report evidence.`;
  if (kind === 'skill') return `---\nname: ${id}\ndescription: Reusable scoped instructions\nallowed-tools: []\n---\n\nDescribe the skill workflow here.`;
  if (kind === 'mcp') return JSON.stringify({ id, name: id, transport: 'stdio', command: '', args: [], enabledByDefault: true }, null, 2);
  if (kind === 'hook') return `id: ${id}\nenabled: true\nevent: tool.before-call\ncommand: node\nargs: []\ntimeoutMs: 30000\nfailurePolicy: warn`;
  if (kind === 'policy') return `deniedTools: []\napproval: mutation\nlimits: {}`;
  return `id: ${id}\nenabled: true`;
};

export const RuntimeScopePanel: React.FC<{
  overview: RdxRuntimeOverview | null;
  scope: 'user' | 'project';
  onScopeChange: (scope: 'user' | 'project') => void;
  kinds: ScopedResourceKind[];
  onChanged?: (overview: RdxRuntimeOverview) => void;
}> = ({ overview, scope, onScopeChange, kinds, onChanged }) => {
  const resources = overview?.resources.filter((entry) => entry.scope === scope && kinds.includes(entry.kind)) ?? [];
  const kind = kinds[0];
  const [editing, setEditing] = useState<ScopedResourceDocument | null>(null);
  const [id, setId] = useState('');
  const [content, setContent] = useState('');
  const [message, setMessage] = useState('');
  const canProject = Boolean(overview?.projectRoot);
  const title = useMemo(() => scope === 'user' ? overview?.userRoot : overview?.projectRoot ?? '当前未打开 Project', [overview, scope]);
  const start = (resource?: ScopedResourceDocument) => {
    const nextId = resource?.id ?? `new-${kind}`;
    setEditing(resource ?? ({ id: nextId, kind, scope, sourcePath: '', sourceHash: '', effectiveStatus: 'effective', content: '', diagnostics: [] }));
    setId(nextId); setContent(resource?.content ?? templateFor(kind, nextId)); setMessage('');
  };
  const save = async () => {
    const request = { kind, scope, id, content, ...(overview?.projectRoot ? { projectRoot: overview.projectRoot } : {}) };
    const validation = await window.electronAPI.rdxRuntime.validateResource(request);
    if (!validation.valid) { setMessage(validation.diagnostics.join('\n')); return; }
    onChanged?.(await window.electronAPI.rdxRuntime.upsertResource(request));
    setEditing(null); setMessage('Saved and re-resolved.');
  };
  const remove = async () => {
    if (!editing || !window.confirm(`确认删除 ${editing.id}？`)) return;
    onChanged?.(await window.electronAPI.rdxRuntime.deleteResource(kind, scope, editing.id, overview?.projectRoot));
    setEditing(null);
  };
  return (
    <section className="settings-runtime-scope" data-testid="settings-runtime-scope">
      <div className="settings-runtime-scope-head">
        <div><div className="settings-runtime-kicker">RDX Runtime</div><div className="settings-runtime-path">{title}</div></div>
        <div className="settings-runtime-scope-switch" role="group" aria-label="Resource scope">
          <button type="button" className={`button button-ghost ${scope === 'user' ? 'active' : ''}`} onClick={() => onScopeChange('user')}>User</button>
          <button type="button" className={`button button-ghost ${scope === 'project' ? 'active' : ''}`} disabled={!canProject} onClick={() => onScopeChange('project')}>Project</button>
          <button type="button" className="button button-secondary" disabled={scope === 'project' && !canProject} onClick={() => start()}>新增 {kind}</button>
        </div>
      </div>
      <div className="settings-runtime-resource-strip">
        {resources.length ? resources.map((resource) => (
          <button type="button" className={`settings-runtime-resource status-${resource.effectiveStatus}`} key={`${resource.kind}:${resource.id}`} onClick={() => start(resource)}>
            <span>{resource.id}</span><small>{resource.kind} · {resource.effectiveStatus}</small>
          </button>
        )) : <div className="settings-runtime-empty">此 Scope 暂无资源；继承资源仍按 builtin &lt; user &lt; project 生效。</div>}
      </div>
      {editing && <div className="settings-runtime-editor">
        <input value={id} disabled={Boolean(editing.sourcePath)} onChange={(event) => setId(event.target.value)} aria-label="Resource id" />
        <textarea value={content} onChange={(event) => setContent(event.target.value)} aria-label="Resource content" />
        <div className="settings-runtime-actions"><button type="button" className="button button-primary" onClick={() => void save()}>验证并保存</button>{editing.sourcePath && <button type="button" className="button button-danger" onClick={() => void remove()}>删除</button>}<button type="button" className="button button-ghost" onClick={() => setEditing(null)}>取消</button></div>
      </div>}
      {message && <div className="settings-runtime-result">{message}</div>}
    </section>
  );
};
