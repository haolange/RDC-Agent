/**
 * Delegation Capsule — structured subagent handoff payload.
 * Missing required fields fail-closed. Not a platform file type.
 */

import { parseSessionArtifactUri, SessionArtifactError } from './sessionArtifact';

export const DELEGATION_CAPSULE_ERROR = 'DELEGATION_CAPSULE_INVALID';

export interface DelegationCapsuleBudget {
  maxToolCalls: number;
  maxWallTimeMs: number;
  maxSubagents?: number;
}

export interface DelegationCapsule {
  mission: string;
  task: string;
  acceptedFacts: string[];
  forbiddenPaths: string[];
  inputArtifactRefs: string[];
  outputRequirements: string;
  budget: DelegationCapsuleBudget;
  domainExtensions?: Record<string, Record<string, boolean>>;
  profile?: string;
  model?: string;
}

const REQUIRED_KEYS = [
  'mission',
  'task',
  'acceptedFacts',
  'forbiddenPaths',
  'inputArtifactRefs',
  'outputRequirements',
  'budget',
] as const;

function fail(detail: string): never {
  throw new Error(`${DELEGATION_CAPSULE_ERROR}: ${detail}`);
}

function readRequiredString(record: Record<string, unknown>, key: string): string {
  if (!(key in record) || record[key] === undefined || record[key] === null) {
    fail(`missing ${key}.`);
  }
  const value = record[key];
  if (typeof value !== 'string') {
    fail(`${key} must be a string.`);
  }
  const trimmed = value.trim();
  if (!trimmed) {
    fail(`${key} must be a non-empty string.`);
  }
  return trimmed;
}

function readStringArray(record: Record<string, unknown>, key: string): string[] {
  if (!(key in record) || record[key] === undefined || record[key] === null) {
    fail(`missing ${key}.`);
  }
  const value = record[key];
  if (!Array.isArray(value) || value.some((entry) => typeof entry !== 'string')) {
    fail(`${key} must be an array of strings.`);
  }
  return value.map((entry) => entry.trim()).filter((entry) => entry.length > 0);
}

function readPositiveInt(record: Record<string, unknown>, key: string, required: boolean): number | undefined {
  if (!(key in record) || record[key] === undefined || record[key] === null) {
    if (required) fail(`missing budget.${key}.`);
    return undefined;
  }
  const value = record[key];
  if (typeof value !== 'number' || !Number.isInteger(value) || value <= 0) {
    fail(`budget.${key} must be a positive integer.`);
  }
  return value;
}

/**
 * Parse and fail-closed validate a Delegation Capsule.
 * Empty arrays are allowed for facts / paths / refs; empty required strings are not.
 */
export function parseDelegationCapsule(input: unknown): DelegationCapsule {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    fail('capsule must be an object.');
  }
  const record = input as Record<string, unknown>;
  for (const key of REQUIRED_KEYS) {
    if (!(key in record) || record[key] === undefined || record[key] === null) {
      fail(`missing ${key}.`);
    }
  }

  const mission = readRequiredString(record, 'mission');
  const task = readRequiredString(record, 'task');
  const outputRequirements = readRequiredString(record, 'outputRequirements');
  const acceptedFacts = readStringArray(record, 'acceptedFacts');
  const forbiddenPaths = readStringArray(record, 'forbiddenPaths');
  const inputArtifactRefs = readStringArray(record, 'inputArtifactRefs');
  for (const ref of inputArtifactRefs) {
    try {
      parseSessionArtifactUri(ref);
    } catch (error) {
      const detail = error instanceof SessionArtifactError ? error.message : String(error);
      fail(`inputArtifactRefs contains an invalid session artifact URI (${detail}).`);
    }
  }

  if ('requiresRdxLease' in record) fail('requiresRdxLease was removed; use optional domainExtensions.');
  const domainExtensions = record.domainExtensions;
  if (domainExtensions !== undefined && (!domainExtensions || typeof domainExtensions !== 'object' || Array.isArray(domainExtensions)
    || Object.values(domainExtensions).some(value => !value || typeof value !== 'object' || Array.isArray(value)
      || Object.values(value).some(flag => typeof flag !== 'boolean')))) fail('domainExtensions must contain boolean capability requests.');

  const budgetValue = record.budget;
  if (!budgetValue || typeof budgetValue !== 'object' || Array.isArray(budgetValue)) {
    fail('budget must be an object.');
  }
  const budgetRecord = budgetValue as Record<string, unknown>;
  const maxToolCalls = readPositiveInt(budgetRecord, 'maxToolCalls', true);
  const maxWallTimeMs = readPositiveInt(budgetRecord, 'maxWallTimeMs', true);
  const maxSubagents = readPositiveInt(budgetRecord, 'maxSubagents', false);

  const capsule: DelegationCapsule = {
    mission,
    task,
    acceptedFacts,
    forbiddenPaths,
    inputArtifactRefs,
    outputRequirements,
    budget: {
      maxToolCalls: maxToolCalls!,
      maxWallTimeMs: maxWallTimeMs!,
      ...(maxSubagents !== undefined ? { maxSubagents } : {}),
    },
    ...(domainExtensions ? { domainExtensions: domainExtensions as Record<string, Record<string, boolean>> } : {}),
  };

  if (typeof record.profile === 'string' && record.profile.trim()) {
    capsule.profile = record.profile.trim();
  }
  if (typeof record.model === 'string' && record.model.trim()) {
    capsule.model = record.model.trim();
  }
  return freezeDelegationCapsule(capsule);
}

/** Deep-freeze a compiled capsule. Already-frozen input is returned as-is. */
export function freezeDelegationCapsule(capsule: DelegationCapsule): DelegationCapsule {
  if (
    Object.isFrozen(capsule)
    && Object.isFrozen(capsule.budget)
    && Object.isFrozen(capsule.acceptedFacts)
    && Object.isFrozen(capsule.forbiddenPaths)
    && Object.isFrozen(capsule.inputArtifactRefs)
    && (!capsule.domainExtensions || (Object.isFrozen(capsule.domainExtensions) && Object.values(capsule.domainExtensions).every(Object.isFrozen)))
  ) {
    return capsule;
  }
  return Object.freeze({
    mission: capsule.mission,
    task: capsule.task,
    acceptedFacts: Object.freeze([...capsule.acceptedFacts]),
    forbiddenPaths: Object.freeze([...capsule.forbiddenPaths]),
    inputArtifactRefs: Object.freeze([...capsule.inputArtifactRefs]),
    outputRequirements: capsule.outputRequirements,
    budget: Object.freeze({ ...capsule.budget }),
    ...(capsule.domainExtensions ? { domainExtensions: Object.freeze(Object.fromEntries(Object.entries(capsule.domainExtensions).map(([key, value]) => [key, Object.freeze({ ...value })]))) } : {}),
    ...(capsule.profile ? { profile: capsule.profile } : {}),
    ...(capsule.model ? { model: capsule.model } : {}),
  }) as DelegationCapsule;
}

export const DELEGATION_CAPSULE_JSON_SCHEMA = {
  type: 'object',
  required: [
    'mission',
    'task',
    'acceptedFacts',
    'forbiddenPaths',
    'inputArtifactRefs',
    'outputRequirements',
    'budget',
    ],
  properties: {
    mission: { type: 'string', description: 'Mission the child must serve.' },
    task: { type: 'string', description: 'Concrete task for this delegation.' },
    acceptedFacts: {
      type: 'array',
      items: { type: 'string' },
      description: 'Confirmed facts the child may treat as given. Empty when none.',
    },
    forbiddenPaths: {
      type: 'array',
      items: { type: 'string' },
      description: 'Paths or experiments the child must not repeat. Empty when none.',
    },
    inputArtifactRefs: {
      type: 'array',
      items: { type: 'string' },
      description: 'session:// artifact refs the child may read. Empty when none.',
    },
    outputRequirements: { type: 'string', description: 'Required child outputs and evidence bar.' },
    budget: {
      type: 'object',
      required: ['maxToolCalls', 'maxWallTimeMs'],
      properties: {
        maxToolCalls: { type: 'integer', minimum: 1, description: 'Child tool-call budget.' },
        maxWallTimeMs: { type: 'integer', minimum: 1, description: 'Child wall-clock budget in ms.' },
        maxSubagents: { type: 'integer', minimum: 1, description: 'Optional nested subagent budget.' },
      },
    },
    domainExtensions: { type: 'object', description: 'Optional domain-owned capability requests; omitted for ordinary tasks.' },
    profile: { type: 'string', description: 'Target profile id. Defaults to the caller profile.' },
    model: { type: 'string', description: 'Optional canonical providerId:modelId. Does not inherit the parent session override.' },
  },
} as const;
