import type { ChallengeRecord, MissionCheckpoint } from '@shared/types/renderdocInvestigation';
import type { InvestigationArtifactService } from './InvestigationArtifactService';

const MAX_CHALLENGES = 12;
const clip = (text: string, max: number) => (text.length > max ? `${text.slice(0, max)}…` : text);

/**
 * Restate the work the investigation itself recorded as still open: the latest checkpoint's
 * unresolved frontier and each open Challenge with its required follow-up. These are facts the
 * Agent or its reviewer wrote; nothing here judges whether they are still worth doing.
 */
export function describeOpenInvestigationWork(service: InvestigationArtifactService, sessionId: string): string {
  const active = (kind: string) => service.list(sessionId, { kind })
    .filter(entry => entry.status === 'ready' || entry.status === 'draft');
  const lines: string[] = [];
  const latestCheckpoint = active('checkpoint').sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0];
  if (latestCheckpoint) {
    const checkpoint = service.readRecord(sessionId, latestCheckpoint.artifactId).record as MissionCheckpoint;
    if (checkpoint.unresolvedFrontier.trim()) {
      lines.push(`Unresolved frontier recorded in checkpoint ${checkpoint.checkpointId}:\n${clip(checkpoint.unresolvedFrontier.trim(), 2000)}`);
    }
  }
  const challenges = active('challenge')
    .map(entry => service.readRecord(sessionId, entry.artifactId).record as ChallengeRecord)
    .filter(challenge => challenge.status === 'open');
  if (challenges.length) {
    lines.push('Open Challenges:', ...challenges.slice(0, MAX_CHALLENGES).map(challenge =>
      `- ${challenge.challengeId} on ${challenge.targetRef.type} ${challenge.targetRef.id}: `
      + clip((challenge.requiredFollowUp ?? challenge.statement).trim(), 300)));
    if (challenges.length > MAX_CHALLENGES) lines.push(`- …and ${challenges.length - MAX_CHALLENGES} more; list them with investigation_list.`);
  }
  return lines.length
    ? `\n## Open work you recorded\n${lines.join('\n')}\nFor each item, either perform its next check now or state the concrete condition that prevents it.`
    : '';
}
