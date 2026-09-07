import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { assertRetiredAbsent, scriptRead } from './renderer-contract.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const fail = (message) => {
  console.error(`[right-rail] ${message}`);
  process.exit(1);
};

const read = (relativePath) => {
  if (relativePath.startsWith('src/')) return scriptRead(relativePath);
  const absolute = path.join(root, relativePath);
  if (!fs.existsSync(absolute)) fail(`missing required file: ${relativePath}`);
  return fs.readFileSync(absolute, 'utf8');
};

const requireText = (source, text, message) => {
  if (!source.includes(text)) fail(message);
};

const forbidText = (source, text, message) => {
  if (source.includes(text)) fail(message);
};

const lineCount = (relativePath) => read(relativePath).split(/\r?\n/).length;

const requiredFiles = [
  'src/main/agent-trace/RightRailProjectionService.ts',
  'src/main/agent-trace/rightRailProjectionMappers.ts',
  'src/main/agent-trace/rightRailInvestigationArtifacts.ts',
  'src/main/agent-trace/rightRailTaskContextResources.ts',
  'src/main/reports/OutputRegistrationTool.ts',
  'src/main/sessions/SessionArtifactSource.ts',
  'src/renderer/features/right-rail/TraceRightPanel.tsx',
  'src/renderer/features/right-rail/ProjectCaptureImportPanel.tsx',
  'src/renderer/features/right-rail/RightRailArtifactList.tsx',
  'src/renderer/features/right-rail/RightRailInvestigationPreview.tsx',
  'src/renderer/features/right-rail/RightRailArtifactGlyphs.tsx',
  'src/renderer/features/right-rail/RightRailOutputList.tsx',
  'src/renderer/features/right-rail/RightRailContext.tsx',
  'src/renderer/features/right-rail/CapturePanel.tsx',
  'src/renderer/features/right-rail/RightRail.css',
  'src/renderer/app/WorkbenchPanelDrawer.tsx',
  'src/renderer/app/useWorkbenchLayout.ts',
  'src/shared/types/trace.ts',
];
for (const relativePath of requiredFiles) read(relativePath);

assertRetiredAbsent(fail);

for (const component of [
  'src/renderer/features/right-rail/TraceRightPanel.tsx',
  'src/renderer/features/right-rail/RightRailArtifactList.tsx',
  'src/renderer/features/right-rail/RightRailInvestigationPreview.tsx',
  'src/renderer/features/right-rail/RightRailArtifactGlyphs.tsx',
  'src/renderer/features/right-rail/RightRailOutputList.tsx',
  'src/renderer/features/right-rail/RightRailContext.tsx',
  'src/renderer/features/right-rail/CapturePanel.tsx',
]) {
  const limit = component.endsWith('RightRailArtifactList.tsx') || component.endsWith('RightRailArtifactGlyphs.tsx') ? 200 : 300;
  if (lineCount(component) > limit) fail(`component must stay under ${limit} lines: ${component}`);
}
if (lineCount('src/main/agent-trace/rightRailInvestigationArtifacts.ts') > 150) {
  fail('rightRailInvestigationArtifacts.ts must stay under 150 lines');
}

const tracePanel = read('src/renderer/features/right-rail/TraceRightPanel.tsx');
for (const requiredSection of ['id="progress"', 'id="artifacts"', 'id="outputs"', 'id="context"', 'id="capture"', 'Progress', 'Artifacts', 'Outputs', 'Context', 'Capture']) {
  requireText(tracePanel, requiredSection, `TraceRightPanel must render ${requiredSection}`);
}
if (!/id="progress"[\s\S]*id="artifacts"[\s\S]*id="outputs"[\s\S]*id="context"[\s\S]*id="capture"/.test(tracePanel)) {
  fail('TraceRightPanel must render five cards in Progress / Artifacts / Outputs / Context / Capture order');
}
for (const required of [
  'EmptyState',
  'RightRailArtifactList',
  'RightRailOutputList',
  "t('control.rightRail.progress.title')",
  "t('control.rightRail.artifacts.title')",
  "t('control.rightRail.outputs.title')",
  "t('control.rightRail.context.title')",
  "t('control.rightRail.capture.title')",
  "t('control.rightRail.progress.empty')",
  "t('control.rightRail.artifacts.empty')",
  "t('control.rightRail.outputs.empty')",
  "t('control.rightRail.context.empty')",
  "t('control.rightRail.capture.empty')",
  'CapturePanel',
]) {
  requireText(tracePanel, required, `TraceRightPanel must retain ${required}`);
}
for (const forbidden of ['ClassicSessionControlPanel', 'shouldShowTraceRightRail', 'harnessTasks', 'RequestInspector', 'No tasks', 'aria-expanded', 'useState']) {
  forbidText(tracePanel, forbidden, `TraceRightPanel must not retain ${forbidden}`);
}
forbidText(tracePanel, 'is-empty', 'TraceRightPanel sections must keep one card shell regardless of content');

const projectCaptureImport = [
  read('src/renderer/features/right-rail/ProjectCaptureImportPanel.tsx'),
  read('src/renderer/features/right-rail/projectCaptureActions.ts'),
].join('\n');
for (const required of ['project.inputs.import', 'project.inputs.refresh', "'projectCapture.import'", "'projectCapture.empty'", 'right-rail-section project-capture-import-section', 'project-capture-input-list']) {
  requireText(projectCaptureImport, required, `ProjectCaptureImportPanel must retain ${required}`);
}
for (const forbidden of ['useCaptureStore', 'openedCapture', 'TraceRightPanel', 'project-capture-inputs-section', '<h3>Captures</h3>', 'input.filePath}</small>']) {
  forbidText(projectCaptureImport, forbidden, `ProjectCaptureImportPanel must not retain ${forbidden}`);
}

const artifactList = [
  read('src/renderer/features/right-rail/RightRailArtifactList.tsx'),
  read('src/renderer/hooks/appShellBridge.ts'),
].join('\n');
for (const required of ['RightRailArtifactGlyph', 'control.rightRail.artifacts.copyId', 'control.rightRail.artifacts.preview', 'RightRailInvestigationPreview', 'appShell.copyText']) {
  requireText(artifactList, required, `RightRailArtifactList must retain ${required}`);
}
for (const forbidden of ['artifactStore', 'readdirSync', 'session:investigation:', 'Open', 'Delete', 'Refresh']) {
  forbidText(artifactList, forbidden, `RightRailArtifactList must not retain ${forbidden}`);
}

const artifactPreview = [
  read('src/renderer/features/right-rail/RightRailInvestigationPreview.tsx'),
  read('src/renderer/features/right-rail/investigationPreviewActions.ts'),
].join('\n');
for (const required of ['investigation.read', 'expectedHash', "role=\"dialog\"", "event.key === 'Escape'", 'hash-mismatch']) {
  requireText(artifactPreview, required, `RightRailInvestigationPreview must retain ${required}`);
}
for (const forbidden of ['artifactStore', 'readdirSync', 'session:investigation:', 'ArtifactViewer', 'title={hash}', 'title={row.contentHash}']) {
  forbidText(artifactPreview, forbidden, `RightRailInvestigationPreview must not retain ${forbidden}`);
}

const artifactGlyphs = read('src/renderer/features/right-rail/RightRailArtifactGlyphs.tsx');
for (const forbidden of ['artifactStore', 'readdirSync', 'session:investigation:']) {
  forbidText(artifactGlyphs, forbidden, `RightRailArtifactGlyphs must not retain ${forbidden}`);
}

const outputList = read('src/renderer/features/right-rail/RightRailOutputList.tsx');
for (const required of ['OutputFileGlyph', "artifact.status === 'failed'", 'control.rightRail.outputs.missing', 'control.rightRail.outputs.open']) {
  requireText(outputList, required, `RightRailOutputList must retain ${required}`);
}
for (const forbidden of ['PlanArtifactPreview', 'isPlanArtifact', "artifact.type === 'plan'", 'previewMarkdown', 'plan.md', 'session_plan', 'artifact_store', 'run_report', 'action_output']) {
  forbidText(outputList, forbidden, `RightRailOutputList must not retain ${forbidden}`);
}

const context = read('src/renderer/features/right-rail/RightRailContext.tsx');
for (const requiredArea of ['TaskContextPanelViewModel', 'TaskContextResource', 'Task context resources']) {
  requireText(context, requiredArea, `RightRailContext must retain ${requiredArea}`);
}
for (const forbidden of ['context?: ContextPanelViewModel', 'Rdx', 'Capture', 'Preview', 'Refresh', 'Copy', 'Clear', '<details', 'Session details', 'Replay options', 'Runtime details', 'Context ID', 'Replay session', 'Capture file', 'Remote ID', 'cliSummary', '<Fact label="CLI"', 'toolCount', 'namespace inventory']) {
  forbidText(context, forbidden, `RightRailContext must not retain ${forbidden}`);
}

for (const forbidden of ['TOOL_LABELS', 'Runtime lookup', 'displayLabel']) {
  forbidText(context, forbidden, 'RightRailContext must not project generic tool category ' + forbidden);
}
const capturePanel = [
  read('src/renderer/features/right-rail/CapturePanel.tsx'),
  read('src/renderer/features/right-rail/capturePanelActions.ts'),
].join('\n');
for (const required of ['RdxContextPanelViewModel', "'Open'", "'Preview'", "'Refresh'", "'Copy'", "'Clear'", 'capture.openProjectInput', 'context.openHumanPreview', 'capture.clearOpenedState', 'right-rail-capture-open-row', 'right-rail-capture-open-button']) {
  requireText(capturePanel, required, `CapturePanel must retain ${required}`);
}
forbidText(capturePanel, 'right-rail-capture-summary', 'CapturePanel must not duplicate the selected capture above its picker');

const rightRailCss = read('src/renderer/features/right-rail/RightRail.css');
for (const required of ['.right-rail-empty-state', '.right-rail-empty-visual', 'grid-template-rows:', 'flex: 0 0 auto', 'font-size: var(--text-md)', 'font-size: var(--text-xl)', '.right-rail-capture-panel', '.right-rail-capture-open-row', '.project-capture-import-section', '.project-capture-input-list', '.output-visual', '.artifacts-visual', '.context-visual', '.capture-visual', '.right-rail-investigation-list', '.right-rail-investigation-row']) {
  requireText(rightRailCss, required, `RightRail.css must retain ${required}`);
}
for (const forbidden of ['.control-panel', '.cp-section', '.capture-library', '.panel-action-btn', 'trace-plan-preview', 'is-plan', '.right-rail-details', '.right-rail-context-area-heading', '.right-rail-rdx-context', '.right-rail-section:not(.is-empty)', '.right-rail-section.is-empty', '.right-rail-capture-summary']) {
  forbidText(rightRailCss, forbidden, `RightRail.css must not retain ${forbidden}`);
}

const drawer = read('src/renderer/app/WorkbenchPanelDrawer.tsx');
for (const requiredDrawerContract of ['role="dialog"', 'aria-modal="true"', "event.key === 'Escape'", 'returnFocusRef']) {
  requireText(drawer, requiredDrawerContract, `WorkbenchPanelDrawer must retain ${requiredDrawerContract}`);
}

const workbenchLayout = read('src/renderer/app/useWorkbenchLayout.ts');
const layoutConstants = read('src/shared/constants/layout.ts');
requireText(layoutConstants, 'RIGHT_RAIL_DRAWER_BREAKPOINT = 920', 'right rail drawer must enter only once the work surface is genuinely narrow');
requireText(workbenchLayout, 'useNarrowViewport(RIGHT_RAIL_DRAWER_BREAKPOINT)', 'workbench layout must use the shared right rail drawer breakpoint');

const traceTypes = read('src/shared/types/trace.ts');
for (const requiredContract of [
  'task: TaskContextPanelViewModel;',
  'rdx: RdxContextPanelViewModel;',
  "export type TraceArtifactSource = 'report' | 'evidence' | 'image' | 'document' | 'data' | 'other';",
  'contextId?: string;',
  'replaySessionId?: string;',
  'remoteId?: string;',
  'export interface InvestigationArtifactRow',
  'contentHash: string;',
  'export interface InvestigationArtifactsPanelViewModel',
  'export interface OutputsPanelViewModel',
  'artifacts: InvestigationArtifactsPanelViewModel;',
  'outputs: OutputsPanelViewModel;',
]) {
  requireText(traceTypes, requiredContract, `trace contract must retain ${requiredContract}`);
}
for (const forbidden of ['groups:', 'session:outputs:list', 'previewMarkdown', 'session_plan', 'artifact_store', 'run_report', 'action_output', 'cliSummary', 'toolCount']) {
  forbidText(traceTypes, forbidden, `trace contract must not retain ${forbidden}`);
}

const taskContextResources = read('src/main/agent-trace/rightRailTaskContextResources.ts');
for (const required of ['promptSegments', 'resourceRefs', "tool.status === 'complete'", "segment.kind === 'preloaded-skill'", "segment.kind === 'scoped-instruction'"]) {
  requireText(taskContextResources, required, 'task Context resources must retain ' + required);
}
for (const forbidden of ['argsPreview', 'resultPreview', 'configuredTools', 'settings.agents.definitions', 'collectSessionUsedToolNames']) {
  forbidText(taskContextResources, forbidden, 'task Context resources must not infer from ' + forbidden);
}
const projection = read('src/main/agent-trace/rightRailProjectionMappers.ts');
for (const forbidden of ['ToolRuntimeSummary', 'cliSummary', 'toolCount', 'session_plan', 'run_report', 'action_output', 'previewMarkdown']) {
  forbidText(projection, forbidden, `right rail projection must not retain ${forbidden}`);
}
requireText(projection, 'export function mapRightRailOutputs', 'outputs mapper must be named mapRightRailOutputs');
forbidText(projection, 'mapRightRailArtifacts', 'outputs mapper must not keep the artifacts name');

const investigationProjection = read('src/main/agent-trace/rightRailInvestigationArtifacts.ts');
for (const required of ['mapRightRailInvestigationArtifacts', 'investigationArtifactService', 'listForProjection', 'listManifests', "mission === 'unknown'", 'contentHash']) {
  requireText(investigationProjection, required, `investigation rail mapper must retain ${required}`);
}
for (const forbidden of ['artifactStore', 'readdirSync', 'SessionArtifactSource', 'listSessionArtifactSources', 'FALLBACK_MISSION', "?? 'debugger'"]) {
  forbidText(investigationProjection, forbidden, `investigation rail mapper must not retain ${forbidden}`);
}

const projectionService = read('src/main/agent-trace/RightRailProjectionService.ts');
forbidText(projectionService, "agentProfile: 'Ask'", 'RightRailProjectionService must not use Ask as a profile fallback');
requireText(projectionService, "agentProfile: ''", 'empty right-rail panel must leave agentProfile empty');

for (const forbidden of ['usedToolNames', "kind: 'tool'", 'settings.agents.definitions']) {
  forbidText(projection, forbidden, 'right rail projection must not retain generic resource path ' + forbidden);
}
const artifactSource = read('src/main/sessions/SessionArtifactSource.ts');
for (const required of ['export type SessionArtifactSourceKind = \'attachment\' | \'output\'', 'categorizeOutput', 'artifactStore.list']) {
  requireText(artifactSource, required, `SessionArtifactSource must retain ${required}`);
}
for (const forbidden of ['session_plan', 'run_report', 'action_output', 'reportPaths', 'plan.md', 'payload']) {
  forbidText(artifactSource, forbidden, `SessionArtifactSource must not retain ${forbidden}`);
}

const outputRegistrationTool = read('src/main/reports/OutputRegistrationTool.ts');
for (const required of ['createOutputRegistrationTool', "name: 'output_register'", "'.rdx', 'inputs'", 'runScopedStore.getRunRoot', 'artifactStore.register']) {
  requireText(outputRegistrationTool, required, `OutputRegistrationTool must retain ${required}`);
}
for (const forbidden of ['readdirSync', 'globSync', 'payload paths']) {
  forbidText(outputRegistrationTool, forbidden, `OutputRegistrationTool must not scan ${forbidden}`);
}

const controlPanel = read('src/renderer/features/right-rail/index.tsx');
for (const required of ['rightRailTarget', 'ProjectCaptureImportPanel', "rightRailTarget !== 'session'"]) {
  requireText(controlPanel, required, `ControlPanel must retain ${required}`);
}
const channels = read('src/shared/renderer-api/channels.ts');
for (const forbidden of ['ClassicSessionControlPanel', 'shouldShowTraceRightRail', 'CaptureLibrary']) {
  forbidText(controlPanel, forbidden, `ControlPanel must not retain ${forbidden}`);
}
forbidText(channels, 'session:outputs:list', 'IPC channel registry must not retain session:outputs:list');
forbidText(channels, 'session:investigation:', 'IPC channel registry must not add session:investigation channels');
requireText(channels, "read: 'investigation:read'", 'IPC channel registry must expose investigation:read');
requireText(read('src/shared/renderer-api/channelCapabilities.ts'), "'investigation:read': 'read'", 'investigation:read must be classified as read');

const docs = {
  design: read('DESIGN.md'),
  uiSpec: read('docs/ui/workbench-and-transcript.md'),
  traceProtocol: read('docs/architecture/agentic-trace-protocol.md'),
  sessionProjectionContract: read('docs/contracts/session-projection.md'),
  specDrivenDevelopment: read('docs/architecture/spec-driven-development.md'),
  agents: read('AGENTS.md'),
};
for (const [source, requiredTextValue, label] of [
  [docs.design, 'Right Rail Authority', 'DESIGN right rail authority'],
  [docs.uiSpec, '## Right Rail', 'UI right rail specification'],
  [docs.traceProtocol, '## Outputs lane', 'trace output projection contract'],
  [docs.traceProtocol, '## Context and Capture lanes', 'trace context projection contract'],
  [docs.sessionProjectionContract, '## Right Rail scoped payloads', 'session projection scope contract'],
  [docs.specDrivenDevelopment, '## Right Rail projection', 'RDX right rail contract'],
  [docs.agents, '## Right Rail single-track gate', 'AGENTS right rail gate'],
]) {
  requireText(source, requiredTextValue, `missing ${label}`);
}
for (const [name, source] of Object.entries(docs)) {
  requireText(source, 'Progress / Artifacts / Outputs / Context / Capture', `${name} must describe the five-card Session rail`);
}
for (const forbiddenDocText of [
  'keeps `plan.md` first',
  '`plan.md` fixed',
  'CLI summary, and deduplicated diagnostics',
  "source: 'session_plan'",
  'Context has only Task Context and RDX Context',
  'exactly three top-level sections: `Progress / Artifacts / Context`',
  '目标三卡',
  '当前四卡',
]) {
  for (const [name, source] of Object.entries(docs)) forbidText(source, forbiddenDocText, `${name} must not retain ${forbiddenDocText}`);
}

console.log('[right-rail] OK');
