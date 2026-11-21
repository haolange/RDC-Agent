import React, { useState } from 'react';
import { useI18n } from '../../../../i18n';
import { Badge } from '../../../../ui/Badge';
import { Button } from '../../../../ui/Button';
import { Icon } from '../../../../ui/Icon';
import { InlineError } from '../../../../ui/InlineError';
import { errorDetail } from '../../../../lib/errorDetail';
import { SettingsDiagnostics, type SettingsDiagnosticsRow } from '../parts';
import { resolveHookTrustProjectRoot } from './hookTrustProjectRoot';
import { getRdcOverview, revokeHook, testHook, trustHook } from './hooksSettingsActions';
import { ResourceTrustBlock } from './ResourceTrustBlock';
import { commandLine, hookEventLabel, timeoutSeconds } from './resourceLabels';
import { RuntimeScopePanel } from './RuntimeScopePanel';
import { formFromContent } from './scopedResourceForm';
import type { RdcRuntimeOverview, ScopedResourceDocument } from '@shared/types/rdcRuntime';

type HookOverview = RdcRuntimeOverview['hooks'][number];
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
 * read-only detail (event / command / timeout / failure policy) and its trust block, with location and
 * fingerprints under 诊断. Editing happens in the shared task dialog (H02); trust never bypasses policy.
 */
export const HooksSettings: React.FC<{
  overview: RdcRuntimeOverview | null;
  scope: 'user' | 'project';
  onScopeChange: (scope: 'user' | 'project') => void;
  onChanged: (overview: RdcRuntimeOverview) => void;
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
          ? (await getRdcOverview(overview.projectRoot)) ?? next
          : next,
      );
    } catch (error) {
      setMessage(errorDetail(error));
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
    const seconds = timeoutSeconds(form.timeoutMs);
    const diagnostics: SettingsDiagnosticsRow[] = [
      { label: t('settings.resourceScope'), value: resource.scope === 'project' ? t('settings.scopeProject') : t('settings.scopeUser') },
      { label: t('settings.scopeResourceLocation'), value: resource.sourcePath },
      ...(hook ? [
        { label: t('settings.hookFingerprint'), value: hook.trustFingerprint },
        { label: t('settings.contentFingerprint'), value: hook.sourceHash },
      ] : []),
    ];
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
              data-tooltip={!canTest ? t('settings.hookTestBlocked') : undefined}
              onClick={() => hook && void run(hook, 'test')}
              data-testid="settings-hook-detail-test"
            >
              <Icon name="play" size={14} />
              {t('settings.hookTest')}
            </Button>
          </div>
        </header>

        <dl className="settings-runtime-detail-grid">
          <div><dt>{t('settings.resourceFieldEvent')}</dt><dd>{hookEventLabel(form.event, t)}</dd></div>
          <div><dt>{t('settings.resourceFieldCommand')}</dt><dd><code>{commandLine(form.command, form.argsText) || '—'}</code></dd></div>
          <div><dt>{t('settings.resourceTimeout')}</dt><dd>{seconds ? t('settings.resourceTimeoutValue', { count: seconds }) : '—'}</dd></div>
          <div><dt>{t('settings.resourceFieldFailurePolicy')}</dt><dd>{failurePolicyLabel(form.failurePolicy)}</dd></div>
        </dl>

        {hook && trust !== 'builtin' ? (
          <ResourceTrustBlock
            testId="settings-hook-trust-panel"
            state={trust}
            title={t('settings.hookTrustTitle')}
            hint={t('settings.hookTrustHint')}
            badge={<HookTrustBadge state={trust} />}
            changed={trust === 'needs-retrust' ? { message: t('settings.hookTrustChanged'), testId: 'settings-hook-trust-change' } : undefined}
            actions={(
              <>
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
              </>
            )}
          />
        ) : null}

        {message && busyId === '' ? <InlineError detail={message}>{t('app.error.actionFailed')}</InlineError> : null}
        {testResult?.id === resource.id && testResult.scope === resource.scope
          && testResult.fingerprint === hook?.trustFingerprint && canTest ? (
          <pre className="settings-runtime-result" data-testid="settings-hook-test-result">{testResult.text}</pre>
        ) : null}
        <SettingsDiagnostics testId="settings-hook-diagnostics" rows={diagnostics} />
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
        rowDescription={(resource) => hookEventLabel(formFromContent('hook', resource.id, resource.content).event, t)}
        renderDetail={renderDetail}
      />
    </section>
  );
};
