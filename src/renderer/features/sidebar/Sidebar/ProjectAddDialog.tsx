import { useState } from 'react';
import { useI18n } from '../../../i18n';
import { TaskDialog } from '../../../ui/TaskDialog';
import { Input } from '../../../ui/Input';
import { Button } from '../../../ui/Button';
import { isBrowserAppSession } from '../../../platform/browserSession';
import { browseProjectDirectory } from '../../../platform/projectDirectory';

export function ProjectAddDialog({ onAdd, onClose }: { onAdd: (rootPath: string) => Promise<void>; onClose: () => void }) {
  const { t } = useI18n();
  const [rootPath, setRootPath] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const submit = async () => {
    if (busy || !rootPath.trim()) return;
    setBusy(true); setError(null);
    try { await onAdd(rootPath.trim()); onClose(); }
    catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)); }
    finally { setBusy(false); }
  };
  const browse = async () => {
    setBusy(true); setError(null);
    try { const selected = await browseProjectDirectory(); if (selected) setRootPath(selected); }
    catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)); }
    finally { setBusy(false); }
  };
  return <TaskDialog open title={t('sidebar.addProject')} description={t('sidebar.projectPathHint')}
    onClose={onClose} closeLabel={t('dialog.cancel')} busy={busy} size="sm" footer={<>
      {!isBrowserAppSession() ? <Button disabled={busy} onClick={() => void browse()}>{t('sidebar.browseDirectory')}</Button> : null}
      <Button variant="ghost" disabled={busy} onClick={onClose}>{t('dialog.cancel')}</Button>
      <Button variant="primary" disabled={busy || !rootPath.trim()} onClick={() => void submit()}>{t('sidebar.addProject')}</Button>
    </>}>
    <Input aria-label={t('sidebar.projectPath')} value={rootPath} disabled={busy}
      onChange={event => setRootPath(event.target.value)}
      onKeyDown={event => { if (event.key === 'Enter') { event.preventDefault(); void submit(); } }} />
    {error ? <p role="alert">{error}</p> : null}
  </TaskDialog>;
}
