/**
 * Work Process narrative diagnostic policy.
 *
 * Product surface rule: automatic provider recovery chatter and thinking lifecycle
 * beacons stay in Agent Activity / runtime logs. Work Process only discloses
 * user-facing fail-closed diagnostics (route, tool, RDX, etc.).
 */
export function shouldProjectDiagnosticToWorkProcess(code: string | undefined): boolean {
  if (!code) {
    return true;
  }
  if (code === 'MODEL_THINKING_STARTED' || code === 'MODEL_THINKING_COMPLETED') {
    return false;
  }
  if (code.startsWith('error_recovery_')) {
    return false;
  }
  return true;
}
