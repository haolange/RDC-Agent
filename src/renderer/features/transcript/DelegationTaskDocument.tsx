import React from 'react';
import type { DelegationTaskBody } from '@shared/types/delegationTrace';
import { MessageMarkdown } from '../../patterns/Markdown/MessageMarkdown';
import { WorkDisclosure } from './WorkDisclosure';
import { useI18n } from '../../i18n';

const TextList: React.FC<{ items: string[] }> = ({ items }) => <ul>{items.map((item, index) =>
  <li key={index}><MessageMarkdown content={item} /></li>)}</ul>;

export const DelegationTaskDocument: React.FC<{ text: string; factsOpen: boolean; constraintsOpen: boolean; toggle: (fold: 'factsOpen' | 'constraintsOpen') => void }> = ({ text, factsOpen, constraintsOpen, toggle }) => {
  const { t } = useI18n();
  let body: DelegationTaskBody;
  try { body = JSON.parse(text) as DelegationTaskBody; }
  catch { return <p role="status">{t('chat.subagentContentUnavailable')}</p>; }
  if (!body.capsule) return <p role="status">{t('chat.subagentContentUnavailable')}</p>;
  const { capsule: task, completionRequirements } = body;
  const primary: [string, React.ReactNode][] = [
    [t('chat.subagentFieldGoal'), !!task.task && task.goal !== task.task && <MessageMarkdown content={task.goal} />],
    [t('chat.subagentFieldScope'), task.scope && <MessageMarkdown content={task.scope} />],
    [t('chat.subagentFieldOutput'), task.outputRequirements && <MessageMarkdown content={task.outputRequirements} />],
    [t('chat.subagentFieldStop'), task.stopConditions.length > 0 && <TextList items={task.stopConditions} />],
  ];
  const facts: [string, React.ReactNode][] = [
    [t('chat.subagentFieldFacts'), task.acceptedFacts.length > 0 && <ul>{task.acceptedFacts.map((fact, index) =>
      <li key={index}><MessageMarkdown content={fact.statement} /><MessageMarkdown content={fact.qualification} />
        {fact.sourceRefs.length > 0 && <TextList items={fact.sourceRefs} />}</li>)}</ul>],
    [t('chat.subagentFieldHypotheses'), task.hypotheses.length > 0 && <TextList items={task.hypotheses} />],
    [t('chat.subagentFieldChallenges'), task.challengeRefs.length > 0 && <TextList items={task.challengeRefs} />],
    [t('chat.subagentFieldInputs'), task.inputArtifactRefs.length > 0 && <TextList items={task.inputArtifactRefs} />],
  ];
  const constraints: [string, React.ReactNode][] = [
    [t('chat.subagentFieldNegativePaths'), task.negativePaths.length > 0 && <ul>{task.negativePaths.map((item, index) =>
      <li key={index}><MessageMarkdown content={item.path} /><MessageMarkdown content={item.reason} />
        <p>{t('chat.subagentApplicable')}: {item.applicableWhen}</p><p>{t('chat.subagentRecheck')}: {item.recheckWhen}</p></li>)}</ul>],
    [t('chat.subagentFieldSkills'), task.requiredSkillIds.length > 0 && <TextList items={task.requiredSkillIds} />],
    [t('chat.subagentFieldProfile'), task.profile],
    [t('chat.subagentFieldModel'), task.model],
    [t('chat.subagentFieldReasoning'), task.reasoningLevel],
    [t('chat.subagentFieldDomain'), task.domainExtensions && Object.values(task.domainExtensions).some(values => Object.keys(values).length > 0) && <TextList items={Object.entries(task.domainExtensions).flatMap(([domain, values]) => Object.entries(values).map(([key, value]) => `${domain} · ${key}: ${String(value)}`))} />],
    [t('chat.subagentCompletionRequirements'), completionRequirements.length > 0 && <TextList items={completionRequirements} />],
  ];
  const renderSections = (sections: [string, React.ReactNode][]) => sections.filter(([, content]) => !!content).map(([label, content]) =>
    <section key={label}><h4>{label}</h4>{content}</section>);
  const budget = `${t('chat.subagentBudgetTools', { count: task.budget.maxToolCalls })} · ${t('chat.subagentBudgetTime', { count: task.budget.maxWallTimeMs / 1000 })}${task.budget.maxSubagents !== undefined ? ` · ${t('chat.subagentBudgetChildren', { count: task.budget.maxSubagents })}` : ''}`;
  return <div className="work-delegation-document">
    <div className="work-process-subagent-task-document">
      <MessageMarkdown content={task.task || task.goal} />
      {renderSections(primary)}
    </div>
    {facts.some(([, content]) => !!content) ? <WorkDisclosure variant="secondary-card" title={t('chat.subagentFactsGroup')}
      open={factsOpen} onToggle={() => toggle('factsOpen')}>
      <div className="work-process-subagent-task-document">{renderSections(facts)}</div>
    </WorkDisclosure> : null}
    <WorkDisclosure variant="secondary-card" title={t('chat.subagentConstraintsGroup')} preview={budget}
      open={constraintsOpen} onToggle={() => toggle('constraintsOpen')}>
      <div className="work-process-subagent-task-document">{renderSections(constraints)}
        <section><h4>{t('chat.subagentFieldBudget')}</h4><p>{budget}</p></section>
      </div>
    </WorkDisclosure>
  </div>;
};
