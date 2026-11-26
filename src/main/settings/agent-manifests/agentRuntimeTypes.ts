import type { ResourceProvenance } from '../../runtime/scopedResourceTypes';
import type { AgentManifestDefinition } from '@shared/types/agentManifest';
import type { EffectiveResourceStatus, SkillMetadata } from '@shared/types/rdcRuntime';
import type { MCP_TRANSPORTS } from '@shared/types/mcp';

export interface EffectiveAgentProfile extends AgentManifestDefinition {
  effectiveStatus: EffectiveResourceStatus;
  provenance: ResourceProvenance;
  compiledRoute: {
    agentId: string;
    providerId: string;
    modelId: string;
  };
}

export interface SkillLoadResult extends SkillMetadata {
  instructions: string;
  referencesPath?: string;
  scriptsPath?: string;
  assetsPath?: string;
}

export interface AgentRuntimeSkillDescriptor {
  id: string;
  name: string;
  label: string;
  description: string;
  source: 'builtin' | 'user' | 'project';
  enabledByDefault: boolean;
  path?: string;
  parameters?: Record<string, unknown>;
}

export interface AgentRuntimeMcpDescriptor {
  id: string;
  name: string;
  description: string;
  transport: MCPTransport;
  enabledByDefault: boolean;
  command?: string;
  args?: string[];
  url?: string;
  env?: Record<string, string>;
  scope?: 'builtin' | 'user' | 'project';
  sourcePath?: string;
  sourceHash?: string;
  /** Project MCP requires hash-bound trust before connect. */
  needsRetrust?: boolean;
  /** Same-id project attempted to change user executable fields. */
  executableOverrideRejected?: boolean;
  projectRealpath?: string;
  descriptorHash?: string;
  blockedReason?: string;
}

export type MCPTransport = (typeof MCP_TRANSPORTS)[number];
