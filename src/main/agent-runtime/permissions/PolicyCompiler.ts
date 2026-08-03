import { createHash } from 'crypto';
import fs from 'fs';
import path from 'path';
import YAML from 'yaml';
import type {
  CompiledPolicy,
  PolicyApprovalFloor,
  RestrictivePolicy,
} from '@shared/types/rdxRuntime';
import { appPathService } from '../../runtime/AppPathService';
import { hashScopedResource, scopedResourceResolver } from '../../runtime/ScopedResourceResolver';

const APPROVAL_STRENGTH = { none: 0, destructive: 1, mutation: 2, all: 3 } as const;
const FLOOR_STRENGTH = { none: 0, auto_review: 1, user: 2 } as const;

const DEFAULT_LIMITS = {
  maxTurns: Number.MAX_SAFE_INTEGER,
  maxToolCalls: Number.MAX_SAFE_INTEGER,
  maxSubagents: Number.MAX_SAFE_INTEGER,
  maxChildDepth: Number.MAX_SAFE_INTEGER,
  maxWallTimeMs: Number.MAX_SAFE_INTEGER,
} as const;

const KNOWN_LIMIT_KEYS = new Set(['maxTurns', 'maxToolCalls', 'maxSubagents', 'maxChildDepth', 'maxWallTimeMs']);

const EMPTY_POLICY: RestrictivePolicy = {
  deniedTools: [],
  approval: 'none',
  approvalFloorByTool: {},
  limits: { ...DEFAULT_LIMITS },
};

function normalizeToolName(name: string): string {
  return name.trim().toLowerCase().replace(/[.-]/g, '_');
}

function assertFiniteNonNegative(key: string, value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || !Number.isInteger(value) || value < 0) {
    throw new Error(`POLICY_INVALID: limit "${key}" must be a non-negative integer.`);
  }
  return value;
}

function parseApprovalFloor(value: unknown, toolName: string): PolicyApprovalFloor {
  if (value === 'none' || value === 'auto_review' || value === 'user') return value;
  throw new Error(`POLICY_INVALID: approvalFloorByTool.${toolName} must be none|auto_review|user.`);
}

function sanitizeRestrictivePolicy(raw: unknown, sourcePath: string): RestrictivePolicy {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new Error(`POLICY_INVALID: ${sourcePath} must be a YAML object.`);
  }
  const input = raw as Record<string, unknown>;
  const deniedTools = Array.isArray(input.deniedTools)
    ? input.deniedTools
      .filter((entry): entry is string => typeof entry === 'string')
      .map((entry) => normalizeToolName(entry))
      .filter(Boolean)
    : [];
  if (Array.isArray(input.deniedTools) && input.deniedTools.some((entry) => typeof entry !== 'string')) {
    throw new Error(`POLICY_INVALID: ${sourcePath} deniedTools must be string[].`);
  }

  const approval = input.approval ?? 'none';
  if (approval !== 'none' && approval !== 'destructive' && approval !== 'mutation' && approval !== 'all') {
    throw new Error(`POLICY_INVALID: ${sourcePath} approval must be none|destructive|mutation|all.`);
  }

  const approvalFloorByTool: Record<string, PolicyApprovalFloor> = {};
  if (input.approvalFloorByTool !== undefined) {
    if (!input.approvalFloorByTool || typeof input.approvalFloorByTool !== 'object' || Array.isArray(input.approvalFloorByTool)) {
      throw new Error(`POLICY_INVALID: ${sourcePath} approvalFloorByTool must be an object.`);
    }
    for (const [toolName, floor] of Object.entries(input.approvalFloorByTool as Record<string, unknown>)) {
      approvalFloorByTool[normalizeToolName(toolName)] = parseApprovalFloor(floor, toolName);
    }
  }

  const limits: Record<string, number> = {};
  if (input.limits !== undefined) {
    if (!input.limits || typeof input.limits !== 'object' || Array.isArray(input.limits)) {
      throw new Error(`POLICY_INVALID: ${sourcePath} limits must be an object.`);
    }
    for (const [key, value] of Object.entries(input.limits as Record<string, unknown>)) {
      if (!KNOWN_LIMIT_KEYS.has(key)) {
        throw new Error(`POLICY_INVALID: unknown limit "${key}".`);
      }
      limits[key] = assertFiniteNonNegative(key, value);
    }
  }

  if (input.enabled === false) {
    return { ...EMPTY_POLICY };
  }

  return {
    deniedTools: Array.from(new Set(deniedTools)).sort(),
    approval,
    approvalFloorByTool,
    limits,
  };
}

function mergeApprovalFloors(
  base: Record<string, PolicyApprovalFloor> | undefined,
  project: Record<string, PolicyApprovalFloor> | undefined,
): Record<string, PolicyApprovalFloor> {
  const merged: Record<string, PolicyApprovalFloor> = { ...(base ?? {}) };
  for (const [toolName, floor] of Object.entries(project ?? {})) {
    const current = merged[toolName] ?? 'none';
    merged[toolName] = FLOOR_STRENGTH[floor] >= FLOOR_STRENGTH[current] ? floor : current;
  }
  return merged;
}

function loadPolicyDirectory(dir: string): RestrictivePolicy[] {
  if (!fs.existsSync(dir)) return [];
  const policies: RestrictivePolicy[] = [];
  for (const entry of fs.readdirSync(dir).filter((name) => name.endsWith('.policy.yml')).sort()) {
    const sourcePath = path.join(dir, entry);
    let raw: unknown;
    try {
      raw = YAML.parse(fs.readFileSync(sourcePath, 'utf8'));
    } catch (error) {
      throw new Error(
        `POLICY_INVALID: failed to parse ${sourcePath}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
    if (raw && typeof raw === 'object' && !Array.isArray(raw) && (raw as Record<string, unknown>).enabled === false) {
      continue;
    }
    policies.push(sanitizeRestrictivePolicy(raw, sourcePath));
  }
  return policies;
}

function mergePolicies(policies: RestrictivePolicy[]): RestrictivePolicy {
  let merged: RestrictivePolicy = { ...EMPTY_POLICY, limits: { ...DEFAULT_LIMITS } };
  for (const policy of policies) {
    merged = {
      ...scopedResourceResolver.tightenPolicy(merged, policy),
      approvalFloorByTool: mergeApprovalFloors(merged.approvalFloorByTool, policy.approvalFloorByTool),
    };
  }
  return merged;
}

function compileRestrictivePolicy(policy: RestrictivePolicy, sourceFingerprint: string): CompiledPolicy {
  const limits = policy.limits ?? {};
  return {
    deniedTools: Object.freeze([...(policy.deniedTools ?? [])].map(normalizeToolName).sort()),
    approvalFloorByTool: Object.freeze({ ...(policy.approvalFloorByTool ?? {}) }),
    approval: policy.approval ?? 'none',
    maxTurns: typeof limits.maxTurns === 'number' ? limits.maxTurns : DEFAULT_LIMITS.maxTurns,
    maxToolCalls: typeof limits.maxToolCalls === 'number' ? limits.maxToolCalls : DEFAULT_LIMITS.maxToolCalls,
    maxSubagents: typeof limits.maxSubagents === 'number' ? limits.maxSubagents : DEFAULT_LIMITS.maxSubagents,
    maxChildDepth: typeof limits.maxChildDepth === 'number' ? limits.maxChildDepth : DEFAULT_LIMITS.maxChildDepth,
    maxWallTimeMs: typeof limits.maxWallTimeMs === 'number' ? limits.maxWallTimeMs : DEFAULT_LIMITS.maxWallTimeMs,
    sourceFingerprint,
  };
}

export function isToolDeniedByPolicy(policy: CompiledPolicy, toolName: string): boolean {
  const normalized = normalizeToolName(toolName);
  return policy.deniedTools.includes(normalized);
}

export function resolvePolicyApprovalFloor(
  policy: CompiledPolicy,
  toolName: string,
  permissionHint?: string,
): PolicyApprovalFloor {
  const normalized = normalizeToolName(toolName);
  const explicit = policy.approvalFloorByTool[normalized] ?? 'none';
  let derived: PolicyApprovalFloor = 'none';
  if (policy.approval === 'all') {
    derived = 'user';
  } else if (policy.approval === 'mutation' && (permissionHint === 'mutation' || permissionHint === 'destructive')) {
    derived = 'user';
  } else if (policy.approval === 'destructive' && permissionHint === 'destructive') {
    derived = 'user';
  }
  return FLOOR_STRENGTH[explicit] >= FLOOR_STRENGTH[derived] ? explicit : derived;
}

/**
 * 加载并编译 user+project `.policy.yml`。
 * 任一文件损坏 / 非法 → throw POLICY_INVALID（fail-closed）。
 */
export function compileEffectivePolicy(projectRoot?: string | null): CompiledPolicy {
  const userPolicies = loadPolicyDirectory(appPathService.getUserRdxPaths().policiesPath);
  const projectPolicies = projectRoot
    ? loadPolicyDirectory(appPathService.getProjectRdxPaths(projectRoot).policiesPath)
    : [];
  const merged = mergePolicies([...userPolicies, ...projectPolicies]);
  const fingerprint = createHash('sha256')
    .update(hashScopedResource(merged))
    .digest('hex')
    .slice(0, 16);
  return compileRestrictivePolicy(merged, fingerprint);
}

export function emptyCompiledPolicy(): CompiledPolicy {
  return compileRestrictivePolicy(EMPTY_POLICY, 'empty');
}

/** 仅测试/合成用：从已解析 RestrictivePolicy 编译。 */
export function compilePolicyFromRestrictive(
  policy: RestrictivePolicy,
  sourceFingerprint = 'synthetic',
): CompiledPolicy {
  return compileRestrictivePolicy(
    sanitizeRestrictivePolicy(policy, 'synthetic'),
    sourceFingerprint,
  );
}

export const APPROVAL_STRENGTH_TABLE = APPROVAL_STRENGTH;
