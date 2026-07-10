import React, { useState } from 'react';
import type { RdxRuntimeOverview } from '@shared/types/rdxRuntime';
import { RuntimeScopePanel } from './RuntimeScopePanel';

export const HooksSettings: React.FC<{
  overview: RdxRuntimeOverview | null;
  scope: 'user' | 'project';
  onScopeChange: (scope: 'user' | 'project') => void;
  onChanged: (overview: RdxRuntimeOverview) => void;
}> = ({ overview, scope, onScopeChange, onChanged }) => {
  const [busyId, setBusyId] = useState('');
  const [message, setMessage] = useState('');
  const hooks = overview?.hooks.filter((hook) => hook.scope === scope) ?? [];
  const run = async (hookId: string, action: 'trust' | 'revoke' | 'test') => {
    setBusyId(hookId); setMessage('');
    try {
      if (action === 'trust' && overview?.projectRoot) onChanged(await window.electronAPI.rdxRuntime.trustHook(overview.projectRoot, hookId));
      else if (action === 'revoke' && overview?.projectRoot) onChanged(await window.electronAPI.rdxRuntime.revokeHook(overview.projectRoot, hookId));
      else {
        const hook = hooks.find((entry) => entry.id === hookId);
        const result = await window.electronAPI.rdxRuntime.testHook(hook?.event ?? 'tool.before-call', overview?.projectRoot, hookId);
        setMessage(JSON.stringify(result));
      }
    } catch (error) { setMessage(error instanceof Error ? error.message : String(error)); }
    finally { setBusyId(''); }
  };
  return <section className="settings-page settings-page-hooks">
    <RuntimeScopePanel overview={overview} scope={scope} onScopeChange={onScopeChange} kinds={['hook']} onChanged={onChanged} />
    <RuntimeScopePanel overview={overview} scope={scope} onScopeChange={onScopeChange} kinds={['policy']} onChanged={onChanged} />
    <div className="settings-runtime-list">
      {hooks.map((hook) => <article className="settings-runtime-card" key={hook.id}>
        <div><strong>{hook.id}</strong><p>{hook.event} · {hook.failurePolicy} · {hook.trusted ? 'Trusted' : 'Untrusted'}</p><code>{hook.sourcePath}</code></div>
        <div className="settings-runtime-actions">
          {hook.scope === 'project' && (hook.trusted
            ? <button type="button" className="button button-secondary" disabled={busyId === hook.id} onClick={() => void run(hook.id, 'revoke')}>撤销授信</button>
            : <button type="button" className="button button-primary" disabled={busyId === hook.id} onClick={() => void run(hook.id, 'trust')}>授信当前 Hash</button>)}
          <button type="button" className="button button-secondary" disabled={busyId === hook.id || (hook.scope === 'project' && !hook.trusted)} onClick={() => void run(hook.id, 'test')}>测试</button>
        </div>
      </article>)}
      {!hooks.length && <div className="settings-runtime-empty-card">暂无 Hook。使用独立 <code>*.hook.yml</code> 文件添加。</div>}
      {message && <pre className="settings-runtime-result">{message}</pre>}
    </div>
  </section>;
};
