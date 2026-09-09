import { generateShortId } from '@shared/utils/id';
import { formatSessionArtifactUri } from '@shared/types/sessionArtifact';
import { sessionArtifactResolver, type SessionArtifactResolver } from './SessionArtifactResolver';

export function writeSessionPlanArtifact(sessionId: string, content: string, resolver: SessionArtifactResolver = sessionArtifactResolver) {
  const stamp = new Date().toISOString().replace(/[:.]/g, '');
  const uri = formatSessionArtifactUri('plans', `plan-${stamp}-${generateShortId()}.md`);
  return resolver.write(sessionId, uri, content);
}
