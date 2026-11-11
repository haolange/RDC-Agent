import type { ChallengeRecord, MissionCheckpoint } from '@shared/types/renderdocInvestigation';
import type { InvestigationArtifactService } from './InvestigationArtifactService';

const MAX_CHALLENGES = 12;
const clip = (text: string, max: number) => (text.length > max ? `${text.slice(0, max)}…` : text);

export interface OpenInvestigationRecord { kind: string; status: string; createdAt: string; record: unknown }

export interface OpenInvestigationWork {
  frontier?: { checkpointId: string; text: string };
  challenges: Array<{ challengeId: string; target: string; followUp: string }>;
  /** Open Challenges beyond the listed ones; read them with investigation_list. */
  omittedChallenges: number;
}

/**
 * The work the investigation itself recorded as still open: the latest active checkpoint's
 * unresolved frontier and each open Challenge with its required follow-up. These are facts the
 * Agent or its reviewer wrote; nothing here judges whether they are still worth doing.
 */
export function collectOpenInvestigationWork(records: readonly OpenInvestigationRecord[]): OpenInvestigationWork | null {
  const active = records.filter(item => item.status === 'ready' || item.status === 'draft');
  const latest = active.filter(item => item.kind === 'checkpoint').sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0];
  const checkpoint = latest?.record as MissionCheckpoint | undefined;
  const frontier = checkpoint?.unresolvedFrontier.trim()
    ? { checkpointId: checkpoint.checkpointId, text: clip(checkpoint.unresolvedFrontier.trim(), 2000) } : undefined;
  const open = active.filter(item => item.kind === 'challenge').map(item => item.record as ChallengeRecord)
    .filter(challenge => challenge.status === 'open');
  if (!frontier && !open.length) return null;
  return {
    ...(frontier ? { frontier } : {}),
    challenges: open.slice(0, MAX_CHALLENGES).map(challenge => ({
      challengeId: challenge.challengeId, target: `${challenge.targetRef.type} ${challenge.targetRef.id}`,
      followUp: clip((challenge.requiredFollowUp ?? challenge.statement).trim(), 300),
    })),
    omittedChallenges: Math.max(0, open.length - MAX_CHALLENGES),
  };
}

/** Prompt section restating recorded open work for a reassessment. */
export function describeOpenInvestigationWork(service: InvestigationArtifactService, sessionId: string): string {
  const records = ['checkpoint', 'challenge'].flatMap(kind => service.list(sessionId, { kind })
    .filter(entry => entry.status === 'ready' || entry.status === 'draft')
    .map(entry => ({ kind, status: entry.status, createdAt: entry.createdAt, record: service.readRecord(sessionId, entry.artifactId).record })));
  const work = collectOpenInvestigationWork(records);
  if (!work) return '';
  const lines: string[] = [];
  if (work.frontier) lines.push(`Unresolved frontier recorded in checkpoint ${work.frontier.checkpointId}:\n${work.frontier.text}`);
  if (work.challenges.length) {
    lines.push('Open Challenges:', ...work.challenges.map(item => `- ${item.challengeId} on ${item.target}: ${item.followUp}`));
    if (work.omittedChallenges) lines.push(`- …and ${work.omittedChallenges} more; list them with investigation_list.`);
  }
  return `\n## Open work you recorded\n${lines.join('\n')}\nFor each item, either perform its next check now or state the concrete condition that prevents it.`;
}
