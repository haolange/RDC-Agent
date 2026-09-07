import { getElectronApi } from '../../platform/getElectronApi';

export function readInvestigationArtifact(request: {
  sessionId: string;
  artifactId: string;
  expectedHash: string;
}) {
  return getElectronApi()?.investigation.read(request);
}
