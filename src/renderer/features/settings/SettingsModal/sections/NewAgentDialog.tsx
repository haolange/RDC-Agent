import React, { useEffect, useRef, useState } from 'react';
import { Button } from '../../../../ui/Button';
import { Input } from '../../../../ui/Input';
import { TaskDialog } from '../../../../ui/TaskDialog';
import { SettingsField } from '../parts';
import { toSlug } from './agentDraftFactory';
import { uniqueResourceId } from './uniqueResourceId';
import type { useI18n } from '../../../../i18n';

type Translate = ReturnType<typeof useI18n>['t'];

/** A new Agent is named before anything is written, so no placeholder file ever lands on disk. */
export const NewAgentDialog: React.FC<{
  scopeLabel: string;
  existingIds: string[];
  onCreate: (identity: { name: string; id: string }) => void;
  onClose: () => void;
  t: Translate;
}> = ({ scopeLabel, existingIds, onCreate, onClose, t }) => {
  const [name, setName] = useState('');
  const nameRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    const frameId = window.requestAnimationFrame(() => nameRef.current?.focus());
    return () => window.cancelAnimationFrame(frameId);
  }, []);
  const trimmed = name.trim();
  const id = uniqueResourceId(toSlug(trimmed || t('settings.agentDefaultName')), existingIds);
  const create = () => { if (trimmed) onCreate({ name: trimmed, id }); };
  return (
    <TaskDialog open size="sm" title={t('settings.newAgentTitle')} description={t('settings.newAgentScope', { scope: scopeLabel })}
      closeLabel={t('dialog.cancel')} onClose={onClose} dataTestId="settings-new-agent-dialog"
      footer={<>
        <Button variant="ghost" onClick={onClose}>{t('dialog.cancel')}</Button>
        <Button variant="primary" disabled={!trimmed} onClick={create}>{t('settings.newAgentCreate')}</Button>
      </>}>
      <SettingsField label={t('settings.agentName')}>
        <Input ref={nameRef} aria-label={t('settings.agentName')} value={name} placeholder={t('settings.agentDefaultName')}
          onChange={(event) => setName(event.currentTarget.value)}
          onKeyDown={(event) => { if (event.key === 'Enter') { event.preventDefault(); create(); } }} />
      </SettingsField>
    </TaskDialog>
  );
};
