/**
 * Blocker Codes - 阻断码常量定义
 */

// 阻断码类型
export interface BlockerCodeDef {
  code: string;
  category: 'capture' | 'gate' | 'runtime' | 'specialist' | 'verification' | 'process';
  severity: 'critical' | 'warning' | 'info';
  description: string;
  resolution?: string;
}

// 阻断码定义
export const BLOCKER_CODES: Record<string, BlockerCodeDef> = {
  // Capture相关
  BLOCKED_MISSING_CAPTURE: {
    code: 'BLOCKED_MISSING_CAPTURE',
    category: 'capture',
    severity: 'critical',
    description: 'Missing .rdc capture file',
    resolution: 'Provide a valid .rdc file path',
  },
  BLOCKED_CAPTURE_IMPORT_FAILED: {
    code: 'BLOCKED_CAPTURE_IMPORT_FAILED',
    category: 'capture',
    severity: 'critical',
    description: 'Failed to import capture file',
  },

  // Gate相关
  BLOCKED_ENTRY_PREFLIGHT: {
    code: 'BLOCKED_ENTRY_PREFLIGHT',
    category: 'gate',
    severity: 'critical',
    description: 'Entry preflight check failed',
  },
  BLOCKED_PLATFORM_MODE_UNSUPPORTED: {
    code: 'BLOCKED_PLATFORM_MODE_UNSUPPORTED',
    category: 'gate',
    severity: 'critical',
    description: 'Platform mode not supported',
  },
  BLOCKED_INTAKE_GATE_REQUIRED: {
    code: 'BLOCKED_INTAKE_GATE_REQUIRED',
    category: 'gate',
    severity: 'critical',
    description: 'Intake gate check failed',
  },
  BLOCKED_RUNTIME_TOPOLOGY_REQUIRED: {
    code: 'BLOCKED_RUNTIME_TOPOLOGY_REQUIRED',
    category: 'gate',
    severity: 'critical',
    description: 'Runtime topology check failed',
  },
  BLOCKED_REQUIRED_ARTIFACT_MISSING: {
    code: 'BLOCKED_REQUIRED_ARTIFACT_MISSING',
    category: 'gate',
    severity: 'critical',
    description: 'Required artifact is missing',
  },

  // Runtime相关
  BLOCKED_RUNTIME_OWNER_CONFLICT: {
    code: 'BLOCKED_RUNTIME_OWNER_CONFLICT',
    category: 'runtime',
    severity: 'critical',
    description: 'Runtime owner conflict detected',
  },
  BLOCKED_RUNTIME_LOCK_EXPIRED: {
    code: 'BLOCKED_RUNTIME_LOCK_EXPIRED',
    category: 'runtime',
    severity: 'warning',
    description: 'Runtime lock has expired',
  },
  BLOCKED_CAPABILITY_TOKEN_EXPIRED: {
    code: 'BLOCKED_CAPABILITY_TOKEN_EXPIRED',
    category: 'runtime',
    severity: 'warning',
    description: 'Capability token has expired',
  },

  // Specialist相关
  BLOCKED_SPECIALIST_FEEDBACK_TIMEOUT: {
    code: 'BLOCKED_SPECIALIST_FEEDBACK_TIMEOUT',
    category: 'specialist',
    severity: 'critical',
    description: 'Specialist feedback timeout',
    resolution: 'Redispatch or skip investigation',
  },
  BLOCKED_UNKNOWN_SPECIALIST: {
    code: 'BLOCKED_UNKNOWN_SPECIALIST',
    category: 'specialist',
    severity: 'critical',
    description: 'Unknown specialist agent',
  },
  BLOCKED_SINGLE_AGENT_MODE_NO_DISPATCH: {
    code: 'BLOCKED_SINGLE_AGENT_MODE_NO_DISPATCH',
    category: 'specialist',
    severity: 'info',
    description: 'Single agent mode - no dispatch allowed',
  },

  // Verification相关
  BLOCKED_FIX_VERIFICATION_FAILED: {
    code: 'BLOCKED_FIX_VERIFICATION_FAILED',
    category: 'verification',
    severity: 'critical',
    description: 'Fix verification failed',
  },
  BLOCKED_SKEPTIC_SIGNOFF_REQUIRED: {
    code: 'BLOCKED_SKEPTIC_SIGNOFF_REQUIRED',
    category: 'verification',
    severity: 'critical',
    description: 'Skeptic signoff required',
  },
  BLOCKED_SHADER_REPLACEMENT_OBSERVABILITY: {
    code: 'BLOCKED_SHADER_REPLACEMENT_OBSERVABILITY',
    category: 'verification',
    severity: 'warning',
    description: 'Shader replacement observability blocked',
  },

  // Process相关
  PROCESS_DEVIATION_MAIN_AGENT_OVERREACH: {
    code: 'PROCESS_DEVIATION_MAIN_AGENT_OVERREACH',
    category: 'process',
    severity: 'critical',
    description: 'Main agent overreach during specialist brief',
  },
  BLOCKED_FREEZE_STATE_ACTIVE: {
    code: 'BLOCKED_FREEZE_STATE_ACTIVE',
    category: 'process',
    severity: 'critical',
    description: 'Run is frozen due to process deviation',
  },

  // 新增：修复参照缺失
  BLOCKED_MISSING_FIX_REFERENCE: {
    code: 'BLOCKED_MISSING_FIX_REFERENCE',
    category: 'gate',
    severity: 'critical',
    description: 'Missing fix reference for verification',
    resolution: 'Provide fix_reference (description + comparison/baseline .rdc)',
  },
};

// 按严重程度获取阻断码
export function getBlockersBySeverity(severity: 'critical' | 'warning' | 'info'): BlockerCodeDef[] {
  return Object.values(BLOCKER_CODES).filter(b => b.severity === severity);
}

// 按类别获取阻断码
export function getBlockersByCategory(category: BlockerCodeDef['category']): BlockerCodeDef[] {
  return Object.values(BLOCKER_CODES).filter(b => b.category === category);
}
