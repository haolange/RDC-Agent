import { describe, expect, it } from 'vitest';
import { shouldProjectDiagnosticToWorkProcess } from './workProcessDiagnosticPolicy';

describe('shouldProjectDiagnosticToWorkProcess', () => {
  it('keeps user-facing fail-closed diagnostics in Work Process', () => {
    expect(shouldProjectDiagnosticToWorkProcess('mcp_connection_failed')).toBe(true);
    expect(shouldProjectDiagnosticToWorkProcess('MODEL_UNAVAILABLE')).toBe(true);
    expect(shouldProjectDiagnosticToWorkProcess(undefined)).toBe(true);
  });

  it('excludes thinking lifecycle beacons and automatic error-recovery telemetry', () => {
    expect(shouldProjectDiagnosticToWorkProcess('MODEL_THINKING_STARTED')).toBe(false);
    expect(shouldProjectDiagnosticToWorkProcess('MODEL_THINKING_COMPLETED')).toBe(false);
    expect(shouldProjectDiagnosticToWorkProcess('error_recovery_retry')).toBe(false);
    expect(shouldProjectDiagnosticToWorkProcess('error_recovery_continue_prompt')).toBe(false);
    expect(shouldProjectDiagnosticToWorkProcess('error_recovery_switch_model')).toBe(false);
  });
});
