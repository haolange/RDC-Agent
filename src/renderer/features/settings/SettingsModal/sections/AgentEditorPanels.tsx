import { useState } from 'react';
import { diagnoseManifestToolTokens } from '@shared/constants/agentToolTokens';
import { Button } from '../../../../ui/Button';
import { Icon, type IconName } from '../../../../ui/Icon';
import { Chevron } from '../../../../ui/Chevron';
import { Textarea } from '../../../../ui/Textarea';
import { InlineError } from '../../../../ui/InlineError';
import { useI18n } from '../../../../i18n';
import { AgentCapabilityPicker, buildAgentCapabilityGroups } from './AgentCapabilityPicker';
import { AgentHandoffEditor } from './AgentHandoffEditor';
import { AgentIdentityPanel } from './AgentIdentityPanel';
import { AgentExecutionLimitField } from './AgentExecutionLimitField';
import { agentPanelSummary, type AgentPanel } from './agentPanelSummary';
import type { AgentSkillCatalog } from './AgentSkillPicker';
import type { AppSettings } from '@shared/types/settings';
import type { AgentManifestDraft } from '@shared/types/agentManifest';

const PANELS: Array<{ id: AgentPanel; icon: IconName }> = [
  { id: 'identity', icon: 'user' },
  { id: 'permissions', icon: 'lock' },
  { id: 'handoffs', icon: 'link' },
  { id: 'instructions', icon: 'nav-skills' },
];

/** The Agent's identity, permissions, handoffs and instructions: one opens at a time, the others show a summary. */
export function AgentEditorPanels({ skills, settings, selectedAgent, onUpdateAgent, agentManifestSaveBlocked }: {
  skills: AgentSkillCatalog;
  settings: AppSettings;
  selectedAgent: AgentManifestDraft;
  onUpdateAgent: (patch: Partial<AgentManifestDraft>) => void;
  agentManifestSaveBlocked: boolean;
}) {
  const { t } = useI18n();
  const [openPanel, setOpenPanel] = useState<AgentPanel | null>(null);
  const capabilityGroups = buildAgentCapabilityGroups(settings, selectedAgent, onUpdateAgent, t);
  const toolDiagnostics = diagnoseManifestToolTokens(selectedAgent.tools);

  const panelLabel = (panel: AgentPanel): string => (
    panel === 'identity' ? t('settings.agentAdvancedIdentity')
      : panel === 'permissions' ? t('settings.agentAdvancedCapabilities')
        : panel === 'handoffs' ? t('settings.handoffs')
          : t('settings.agentAdvancedInstructions')
  );
  const panelHint = (panel: AgentPanel): string => (
    panel === 'identity' ? t('settings.agentAdvancedIdentityHint')
      : panel === 'permissions' ? t('settings.agentAdvancedCapabilitiesHint')
        : panel === 'handoffs' ? t('settings.agentHandoffsHint')
          : t('settings.agentInstructionsHint')
  );

  const renderPanelBody = (panel: AgentPanel) => {
    if (panel === 'identity') {
      return <AgentIdentityPanel agent={selectedAgent} onUpdateAgent={onUpdateAgent} />;
    }
    if (panel === 'permissions') {
      return (
        <>
          <AgentCapabilityPicker groups={capabilityGroups} skills={skills} targetAgentId={selectedAgent.id} />
          <AgentExecutionLimitField agent={selectedAgent} onUpdateAgent={onUpdateAgent} />
          {toolDiagnostics.length > 0 ? (
            <InlineError data-testid="settings-agent-tool-diagnostics"
              detail={toolDiagnostics.map(item => `${item.token} · ${item.message}`).join('\n')}>
              {t('settings.agentToolDiagnosticsTitle')}
            </InlineError>
          ) : null}
        </>
      );
    }
    if (panel === 'handoffs') {
      return (
        <AgentHandoffEditor
          skills={skills}
          key={selectedAgent.id}
          selfId={selectedAgent.id}
          handoffs={selectedAgent.handoffs}
          definitions={settings.agents.definitions}
          forceShowRequired={agentManifestSaveBlocked}
          onChange={(handoffs) => onUpdateAgent({ handoffs })}
        />
      );
    }
    return (
      <>
        <Textarea
          sizing="content"
          minRows={2}
          aria-label={t('settings.agentInstructions')}
          className="settings-agent-instructions settings-agent-instructions--editor"
          value={selectedAgent.instructions}
          onChange={(event) => onUpdateAgent({ instructions: event.currentTarget.value })}
        />
      </>
    );
  };

  return (
    <div className="settings-agent-panels" data-testid="settings-agent-panels">
      {PANELS.map(({ id, icon }) => {
        const open = openPanel === id;
        const summary = !open && agentPanelSummary(id, selectedAgent, settings, t);
        return (
          <section key={id} className={`settings-agent-panel${open ? ' is-open' : ''}`} data-panel={id}>
            <Button variant="ghost"
              className="settings-agent-panel-toggle"
              data-tooltip={open ? undefined : panelHint(id)}
              aria-expanded={open}
              aria-controls={open ? `settings-agent-panel-body-${id}` : undefined}
              data-testid={`settings-agent-panel-${id}`}
              onClick={(event) => {
                const section = event.currentTarget.parentElement;
                setOpenPanel(open ? null : id);
                if (!open) requestAnimationFrame(() => section?.scrollIntoView({ block: 'nearest' }));
              }}
            >
              <Icon name={icon} size={16} className="settings-agent-panel-icon" />
              <span className="settings-agent-panel-copy">
                <span className="settings-agent-panel-title">{panelLabel(id)}</span>
                {summary && <span className="settings-agent-panel-summary">{summary}</span>}
              </span>
              <Chevron open={open} className="settings-agent-panel-caret" />
            </Button>
            {open ? (
              <div id={`settings-agent-panel-body-${id}`} className="settings-agent-panel-body">
                {renderPanelBody(id)}
              </div>
            ) : null}
          </section>
        );
      })}
    </div>
  );
}
