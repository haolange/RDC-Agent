import { getElectronApi } from '../../platform/getElectronApi';

export function readInvestigationArtifact(request: {
  sessionId: string;
  artifactId: string;
  expectedHash: string;
}) {
  return getElectronApi()?.investigation.read(request);
}

export async function listInvestigationArtifacts(request: import('@shared/types/trace').InvestigationListRequest) {
  const api = getElectronApi();
  if (!api) throw new Error('Investigation API unavailable');
  return api.investigation.list(request);
}
