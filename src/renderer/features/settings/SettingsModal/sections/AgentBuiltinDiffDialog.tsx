import { Button } from '../../../../ui/Button';
import { DiffBlock } from '../../../../ui/DiffBlock';
import { InlineError } from '../../../../ui/InlineError';
import { Spinner } from '../../../../ui/Spinner';
import { TaskDialog } from '../../../../ui/TaskDialog';
import { humanizeError } from '../../../../i18n/humanizeError';
import { useI18n } from '../../../../i18n';
import type { DiffLine } from '@shared/utils/lineDiff';

export interface AgentBuiltinDiffState {
  agentId: string;
  agentName: string;
  updated: boolean;
  lines?: DiffLine[];
  error?: string;
}

/** Current builtin against the user's override; restoring removes the override. */
export function AgentBuiltinDiffDialog({ state, onRestore, onClose }: {
  state: AgentBuiltinDiffState;
  onRestore: () => void;
  onClose: () => void;
}) {
  const { t } = useI18n();
  return (
    <TaskDialog
      open
      size="lg"
      className="settings-agent-builtin-diff-dialog"
      title={t('settings.agentBuiltinDiffTitle', { name: state.agentName })}
      description={t(state.updated ? 'settings.agentBuiltinDiffUpdated' : 'settings.agentBuiltinDiffDescription')}
      closeLabel={t('dialog.close')}
      onClose={onClose}
      dataTestId="settings-agent-builtin-diff-dialog"
      footer={<>
        <Button variant="secondary" size="sm" onClick={onClose}>{t('dialog.close')}</Button>
        <Button variant="danger" size="sm" onClick={onRestore} data-testid="settings-agent-builtin-diff-restore">
          {t('settings.agentRestoreBuiltin')}
        </Button>
      </>}
    >
      {!state.lines && !state.error ? <Spinner size="sm" /> : null}
      {state.error ? <InlineError detail={state.error}>{humanizeError(state.error, t, 'settings.agentBuiltinDiffFailed')}</InlineError> : null}
      {state.lines ? (
        <DiffBlock
          lines={state.lines}
          beforeLabel={t('settings.agentBuiltinDiffBuiltin')}
          afterLabel={t('settings.agentBuiltinDiffOverride')}
          dataTestId="settings-agent-builtin-diff"
          fold={{ context: 3, label: (count) => t('settings.agentBuiltinDiffUnchanged', { count }) }}
        />
      ) : null}
    </TaskDialog>
  );
}
