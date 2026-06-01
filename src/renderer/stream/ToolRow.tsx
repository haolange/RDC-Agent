import React from 'react';
import type { AgentNode } from '@shared/types/agentTimeline';
import type { ToolCallPayload } from '@shared/types/agentTimeline';
import {
  formatDuration,
  getPayload,
  normalizeAskAnswers,
  normalizeAskQuestions,
} from '../services/timelineFormatters';
import { ExpandButton, StatusBadge } from './TimelinePrimitives';

const AskUserQuestionTraceView: React.FC<{
  node: AgentNode;
  payload?: ToolCallPayload;
  expanded: boolean;
  onToggle: () => void;
}> = ({ node, payload, expanded, onToggle }) => {
  const duration = formatDuration(node.metrics?.durationMs);
  const questions = normalizeAskQuestions(payload?.argumentsRaw);
  const answers = normalizeAskAnswers(payload?.resultRaw);
  const answerByQuestionId = new Map(answers.map((answer) => [answer.questionId, answer]));

  return (
    <div className={`amt-tool-call amt-ask-trace amt-node-status-${node.status}`} data-testid="agent-timeline-tool-call" data-node-id={node.id}>
      <div className="amt-tool-call-header">
        <span className="amt-tool-icon" aria-hidden="true">⌁</span>
        <span className="amt-tool-name">{payload?.toolName ?? node.title}</span>
        <span className="amt-tool-summary">{node.summary || payload?.resultSummary || payload?.argumentsSummary}</span>
        {duration ? <span className="amt-muted">{duration}</span> : null}
        <StatusBadge status={node.status} />
        <ExpandButton expanded={expanded} onClick={onToggle} label={`切换 ${node.title}`} />
      </div>
      {expanded ? (
        <div className="amt-tool-call-body amt-ask-trace-body" data-testid="ask-user-question-trace">
          {questions.map((question, index) => {
            const questionId = question.questionId ?? question.id ?? `question-${index + 1}`;
            const answer = answerByQuestionId.get(questionId);
            const selectedOption = question.options?.find((option) => (
              (option.optionId ?? option.id) === answer?.selectedOptionId
            ));
            return (
              <section key={questionId} className="amt-ask-question-trace-item">
                <div className="amt-ask-question-row">
                  <strong>问题 {index + 1}</strong>
                  <span>{question.prompt}</span>
                </div>
                {question.options?.length ? (
                  <ul className="amt-ask-option-list">
                    {question.options.map((option) => {
                      const optionId = option.optionId ?? option.id ?? option.label ?? '';
                      return (
                        <li key={optionId} className={question.recommendedOptionId === optionId ? 'recommended' : ''}>
                          <span>{option.label ?? optionId}</span>
                          {question.recommendedOptionId === optionId ? <em>推荐</em> : null}
                          {option.description ? <small>{option.description}</small> : null}
                        </li>
                      );
                    })}
                  </ul>
                ) : null}
                {answer ? (
                  <div className="amt-ask-answer-row">
                    <strong>用户答案</strong>
                    <span>{answer.freeformText?.trim() || selectedOption?.label || answer.selectedOptionId || '已回答'}</span>
                  </div>
                ) : null}
              </section>
            );
          })}
          {payload?.resultSummary ? <p>{payload.resultSummary}</p> : null}
        </div>
      ) : null}
    </div>
  );
};

export const ToolRow: React.FC<{
  node: AgentNode;
  expanded: boolean;
  onToggle: () => void;
}> = ({ node, expanded, onToggle }) => {
  const payload = getPayload<ToolCallPayload>(node);
  const duration = formatDuration(node.metrics?.durationMs);
  if (payload?.toolName === 'ui.ask_user_question') {
    return <AskUserQuestionTraceView node={node} payload={payload} expanded={expanded} onToggle={onToggle} />;
  }
  const inlineSummary = node.summary || payload?.resultSummary || payload?.argumentsSummary || '';

  return (
    <div className={`amt-tool-call amt-node-status-${node.status}`} data-testid="agent-timeline-tool-call" data-node-id={node.id}>
      <div className="amt-tool-call-header">
        <span className="amt-tool-icon" aria-hidden="true">⌁</span>
        <span className="amt-tool-name">{payload?.toolName ?? node.title}</span>
        {inlineSummary ? <span className="amt-tool-summary">{inlineSummary}</span> : null}
        {duration ? <span className="amt-muted">{duration}</span> : null}
        <StatusBadge status={node.status} />
        <ExpandButton expanded={expanded} onClick={onToggle} label={`切换 ${node.title}`} />
      </div>
      {expanded ? (
        <div className="amt-tool-call-body">
          {payload?.purpose ? <p>{payload.purpose}</p> : null}
          <dl className="amt-key-values">
            <div>
              <dt>输入</dt>
              <dd>{payload?.argumentsSummary || '无参数摘要'}</dd>
            </div>
            <div>
              <dt>输出</dt>
              <dd>{payload?.resultSummary || node.summary || '等待结果'}</dd>
            </div>
          </dl>
          {payload?.argumentsRaw ? <pre>{JSON.stringify(payload.argumentsRaw, null, 2)}</pre> : null}
          {payload?.resultRaw ? <pre>{JSON.stringify(payload.resultRaw, null, 2)}</pre> : null}
          {payload?.stderr ? <pre className="amt-error-block">{payload.stderr}</pre> : null}
        </div>
      ) : null}
    </div>
  );
};
