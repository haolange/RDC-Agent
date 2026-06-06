import type { ToolCategory } from './nodes';

export interface ToolManifestRenderer {
  key: string;
  icon?: string;
  defaultCollapsed: boolean;
  supportsPreview: boolean;
  supportsRawJson: boolean;
  supportsArtifacts?: boolean;
  supportsDiff?: boolean;
}

export interface ToolManifestPreview {
  buildInputPreview?: string;
  buildOutputPreview?: string;
}

export interface ToolManifestSafety {
  requiresApproval?: boolean;
  riskLevel?: 'low' | 'medium' | 'high';
  redactedFields?: string[];
  maxOutputChars?: number;
}

export interface ToolManifest {
  toolName: string;
  displayName: string;
  category: ToolCategory;
  description?: string;
  inputSchema?: unknown;
  outputSchema?: unknown;
  renderer: ToolManifestRenderer;
  preview?: ToolManifestPreview;
  safety?: ToolManifestSafety;
}

export interface AgentPhaseDefinition {
  phaseId: string;
  displayName: string;
  description?: string;
  defaultCollapsed?: boolean;
  allowedToolCategories?: ToolCategory[];
}

export interface ArtifactRendererManifest {
  artifactKind: string;
  rendererKey: string;
  displayName: string;
  defaultCollapsed?: boolean;
}

export interface AgentProfileUi {
  defaultLayout: 'timeline' | 'three_panel' | 'compact';
  showPlanByDefault: boolean;
  showThoughtSummaryByDefault: boolean;
  showRawToolName: boolean;
  defaultCollapseLevel: 'summary' | 'preview' | 'debug';
}

export interface AgentProfile {
  agentType: string;
  displayName: string;
  description?: string;
  version: string;
  phases: AgentPhaseDefinition[];
  tools: ToolManifest[];
  artifactRenderers?: ArtifactRendererManifest[];
  vocabulary?: {
    taskName?: string;
    actionName?: string;
    artifactName?: string;
  };
  ui?: AgentProfileUi;
}
