import React, { useState } from 'react';
import type { RdxRuntimeOverview, ScopedResourceDocument } from '@shared/types/rdxRuntime';
import { useI18n } from '../../../../i18n';
import { Badge } from '../../../../ui/Badge';
import { Button } from '../../../../ui/Button';
import { Icon } from '../../../../ui/Icon';
import { InlineError } from '../../../../ui/InlineError';
import { resolveHookTrustProjectRoot } from './hookTrustProjectRoot';
import { getRdxOverview, revokeHook, testHook, trustHook } from './hooksSettingsActions';
import { RuntimeScopePanel } from './RuntimeScopePanel';
import { formFromContent } from './scopedResourceForm';

type HookOverview = RdxRuntimeOverview['hooks'][number];
type HookTrustState = 'trusted' | 'needs-retrust' | 'untrusted' | 'builtin';

function hookTrustState(hook: HookOverview | undefined): HookTrustState {
  if (!hook || hook.scope === 'builtin') return 'builtin';
  if (hook.trusted && hook.needsRetrust) return 'needs-retrust';
  return hook.trusted ? 'trusted' : 'untrusted';
}

function HookTrustBadge({ state }: { state: HookTrustState }) {
  const { t } = useI18n();
  if (state === 'builtin') return null;
  const tone = state === 'trusted' ? 'success' : 'warning';
  const label = state === 'trusted'
    ? t('settings.hookTrusted')
    : state === 'needs-retrust'
      ? t('settings.hookNeedsRetrust')
      : t('settings.hookUntrusted');
  return <Badge tone={tone} data-testid="settings-hook-trust-badge" data-state={state}>{label}</Badge>;
}

/**
 * Hooks page: scoped hook list joined with runtime trust state; the selected hook shows a
 * read-only detail (event / command / timeout / failure policy / location) and its trust
 * block. Editing happens in the shared task dialog (H02); trust never bypasses policy.
 */
export const HooksSettings: React.FC<{
  overview: RdxRuntimeOverview | null;
  scope: 'user' | 'project';
  onScopeChange: (scope: 'user' | 'project') => void;
  onChanged: (overview: RdxRuntimeOverview) => void;
}> = ({ overview, scope, onScopeChange, onChanged }) => {
  const { t } = useI18n();
  const [busyId, setBusyId] = useState('');
  const [message, setMessage] = useState('');
  const [testResult, setTestResult] = useState<{ id: string; scope: HookOverview['scope']; fingerprint: string; text: string } | null>(null);

  const hookFor = (resource: ScopedResourceDocument): HookOverview | undefined =>
    overview?.hooks.find((hook) => hook.id === resource.id && hook.scope === resource.scope);

  const failurePolicyLabel = (policy: 'block' | 'warn') => (
    policy === 'block' ? t('settings.hookFailureBlock') : t('settings.hookFailureWarn')
  );

  const run = async (hook: HookOverview, action: 'trust' | 'revoke' | 'test') => {
    setBusyId(hook.id);
    setMessage('');
    try {
      const trustProjectRoot = resolveHookTrustProjectRoot({ scope: hook.scope, projectRoot: overview?.projectRoot });
      if (action === 'test') {
        const result = await testHook(hook.event, overview?.projectRoot, hook.id);
        setTestResult({ id: hook.id, scope: hook.scope, fingerprint: hook.trustFingerprint, text: JSON.stringify(result, null, 2) });
        return;
      }
      const next = action === 'trust'
        ? await trustHook(trustProjectRoot, hook.id)
        : await revokeHook(trustProjectRoot, hook.id);
      if (!next) return;
      onChanged(
        trustProjectRoot == null && overview?.projectRoot
          ? (await getRdxOverview(overview.projectRoot)) ?? next
          : next,
      );
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setBusyId('');
    }
  };

  const renderDetail = ({ resource, edit }: { resource: ScopedResourceDocument; edit: () => void }) => {
    const form = formFromContent('hook', resource.id, resource.content);
    const hook = hookFor(resource);
    const trust = hookTrustState(hook);
    const busy = busyId === resource.id;
    const canTest = Boolean(hook) && (trust === 'builtin' || trust === 'trusted');
    return (
      <div className="settings-runtime-detail" data-testid="settings-hook-detail">
        <header className="settings-runtime-detail-head">
          <div className="settings-runtime-detail-title">
            <strong>{resource.id}</strong>
            <span className="settings-runtime-detail-badges">
              {!form.enabled ? <Badge tone="warning">{t('settings.disabled')}</Badge> : null}
            </span>
          </div>
          <div className="settings-runtime-actions">
            <Button variant="secondary" size="sm" onClick={edit} data-testid="settings-hook-detail-edit">
              <Icon name="edit" size={14} />
              {t('settings.edit')}
            </Button>
            <Button
              variant="secondary"
              size="sm"
              disabled={busy || !canTest}
              title={!canTest ? t('settings.hookTestBlocked') : undefined}
              onClick={() => hook && void run(hook, 'test')}
              data-testid="settings-hook-detail-test"
            >
              <Icon name="play" size={14} />
              {t('settings.hookTest')}
            </Button>
          </div>
        </header>

        <dl className="settings-runtime-detail-grid">
          <div><dt>{t('settings.resourceFieldEvent')}</dt><dd><code>{form.event}</code></dd></div>
          <div><dt>{t('settings.resourceFieldCommand')}</dt><dd><code>{form.command || '—'}</code></dd></div>
          <div><dt>{t('settings.resourceFieldArgs')}</dt><dd><code>{form.argsText || '[]'}</code></dd></div>
          <div><dt>{t('settings.resourceFieldTimeoutMs')}</dt><dd>{form.timeoutMs}</dd></div>
          <div><dt>{t('settings.resourceFieldFailurePolicy')}</dt><dd>{failurePolicyLabel(form.failurePolicy)}</dd></div>
          <div><dt>{t('settings.resourceScope')}</dt><dd>{resource.scope === 'project' ? t('settings.scopeProject') : t('settings.scopeUser')}</dd></div>
          <div><dt>{t('settings.scopeResourceLocation')}</dt><dd><code>{resource.sourcePath}</code></dd></div>
        </dl>

        {hook && trust !== 'builtin' ? (
          <section className="settings-trust-block" data-testid="settings-hook-trust-panel" data-trust-state={trust}>
            <header className="settings-trust-block-head">
              <div>
                <div className="settings-section-title">{t('settings.hookTrustTitle')}</div>
                <p className="settings-help-text">{t('settings.hookTrustHint')}</p>
              </div>
              <HookTrustBadge state={trust} />
            </header>
            <dl className="settings-trust-summary">
              <div><dt>{t('settings.hookFingerprint')}</dt><dd><code>{hook.trustFingerprint.slice(0, 12)}</code></dd></div>
              <div><dt>{t('settings.hookSourceHash')}</dt><dd><code>{hook.sourceHash.slice(0, 12)}</code></dd></div>
            </dl>
            {trust === 'needs-retrust' ? (
              <p className="settings-help-text settings-trust-change" data-testid="settings-hook-trust-change">
                <Icon name="warning" size={14} />
                {t('settings.hookTrustChanged')}
              </p>
            ) : null}
            <footer className="settings-trust-block-foot">
              <p className="settings-help-text settings-trust-gate">
                <Icon name="info" size={14} />
                {trust === 'trusted' ? t('settings.hookTrustActive') : t('settings.hookTestBlocked')}
              </p>
              <div className="settings-runtime-actions">
                {trust === 'trusted' || trust === 'needs-retrust' ? (
                  <Button variant="secondary" size="sm" disabled={busy} onClick={() => void run(hook, 'revoke')}>
                    {t('settings.hookRevoke')}
                  </Button>
                ) : null}
                {trust !== 'trusted' ? (
                  <Button variant="primary" size="sm" disabled={busy} onClick={() => void run(hook, 'trust')}>
                    {t('settings.hookTrust')}
                  </Button>
                ) : null}
              </div>
            </footer>
          </section>
        ) : null}

        {message && busyId === '' ? <InlineError>{message}</InlineError> : null}
        {testResult?.id === resource.id && testResult.scope === resource.scope
          && testResult.fingerprint === hook?.trustFingerprint && canTest ? (
          <pre className="settings-runtime-result" data-testid="settings-hook-test-result">{testResult.text}</pre>
        ) : null}
      </div>
    );
  };

  return (
    <section className="settings-page settings-page-hooks" data-settings-search="hooks">
      <RuntimeScopePanel
        overview={overview}
        scope={scope}
        onScopeChange={onScopeChange}
        kinds={['hook']}
        onChanged={onChanged}
        editorPresentation="dialog"
        renderRowTrailing={(resource) => <HookTrustBadge state={hookTrustState(hookFor(resource))} />}
        renderDetail={renderDetail}
      />
    </section>
  );
};
