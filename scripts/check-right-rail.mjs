import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const fail = (message) => {
  console.error(`[right-rail] ${message}`);
  process.exit(1);
};

const read = (relativePath) => {
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
  'src/main/reports/OutputRegistrationTool.ts',
  'src/main/sessions/SessionArtifactSource.ts',
  'src/renderer/features/debugger/ControlPanel/TraceRightPanel.tsx',
  'src/renderer/features/debugger/ControlPanel/ProjectCaptureImportPanel.tsx',
  'src/renderer/features/debugger/ControlPanel/TraceArtifactList.tsx',
  'src/renderer/features/debugger/ControlPanel/RightRailContext.tsx',
  'src/renderer/features/debugger/ControlPanel/CapturePanel.tsx',
  'src/renderer/features/debugger/ControlPanel/RightRail.css',
  'src/renderer/app/RightRailDrawer.tsx',
  'src/renderer/app/useWorkbenchLayout.ts',
  'src/shared/types/trace.ts',
];
for (const relativePath of requiredFiles) read(relativePath);

const retiredFiles = [
  'src/main/ipc/sessionOutputs.ts',
  'src/renderer/features/debugger/ControlPanel/ArtifactTree.tsx',
  'src/renderer/features/debugger/ControlPanel/ArtifactTreeSections.tsx',
  'src/renderer/features/debugger/ControlPanel/CaptureLibrary.tsx',
  'src/renderer/features/debugger/ControlPanel/CollapsibleSection.tsx',
  'src/renderer/features/debugger/ControlPanel/ControlPanel.css',
  'src/renderer/features/debugger/ControlPanel/MemoryPanel.tsx',
  'src/renderer/features/debugger/ControlPanel/PlanArtifactPreview.tsx',
  'src/renderer/features/debugger/ControlPanel/RdxRuntimeContextPanel.tsx',
  'src/renderer/features/debugger/ControlPanel/SessionCapabilitiesPanel.tsx',
  'src/renderer/features/debugger/ControlPanel/SessionControlPanel.tsx',
  'src/renderer/features/debugger/ControlPanel/SessionProgressPanel.tsx',
  'src/renderer/features/debugger/ControlPanel/SessionWorkingFolderPanel.tsx',
];
for (const relativePath of retiredFiles) {
  if (fs.existsSync(path.join(root, relativePath))) fail(`retired path must remain deleted: ${relativePath}`);
}

for (const component of [
  'src/renderer/features/debugger/ControlPanel/TraceRightPanel.tsx',
  'src/renderer/features/debugger/ControlPanel/TraceArtifactList.tsx',
  'src/renderer/features/debugger/ControlPanel/RightRailContext.tsx',
  'src/renderer/features/debugger/ControlPanel/CapturePanel.tsx',
]) {
  if (lineCount(component) > 300) fail(`component must stay under 300 lines: ${component}`);
}

const tracePanel = read('src/renderer/features/debugger/ControlPanel/TraceRightPanel.tsx');
for (const requiredSection of ['id="progress"', 'id="outputs"', 'id="context"', 'id="capture"', 'Progress', 'Outputs', 'Context', 'Capture']) {
  requireText(tracePanel, requiredSection, `TraceRightPanel must render ${requiredSection}`);
}
for (const required of ['EmptyState', 'Steps will show as the task unfolds.', 'Outputs created during this task appear here.', 'Tools and referenced files used in this task appear here.', 'Import a .rdc file to this project to open and preview it here.', 'CapturePanel']) {
  requireText(tracePanel, required, `TraceRightPanel must retain ${required}`);
}
for (const forbidden of ['ClassicSessionControlPanel', 'shouldShowTraceRightRail', 'harnessTasks', 'RequestInspector', 'No tasks', 'aria-expanded', 'useState']) {
  forbidText(tracePanel, forbidden, `TraceRightPanel must not retain ${forbidden}`);
}
forbidText(tracePanel, 'is-empty', 'TraceRightPanel sections must keep one card shell regardless of content');

const projectCaptureImport = read('src/renderer/features/debugger/ControlPanel/ProjectCaptureImportPanel.tsx');
for (const required of ['project.inputs.import', 'project.inputs.refresh', 'Import .rdc', 'Imported .rdc files appear here.', 'right-rail-section project-capture-import-section', 'project-capture-input-list']) {
  requireText(projectCaptureImport, required, `ProjectCaptureImportPanel must retain ${required}`);
}
for (const forbidden of ['useCaptureStore', 'openedCapture', 'TraceRightPanel', 'project-capture-inputs-section', '<h3>Captures</h3>', 'input.filePath}</small>']) {
  forbidText(projectCaptureImport, forbidden, `ProjectCaptureImportPanel must not retain ${forbidden}`);
}

const artifactList = read('src/renderer/features/debugger/ControlPanel/TraceArtifactList.tsx');
for (const required of ['OutputFileGlyph', "artifact.status === 'failed'", "'Missing'", "'Open'"]) {
  requireText(artifactList, required, `TraceArtifactList must retain ${required}`);
}
for (const forbidden of ['PlanArtifactPreview', 'isPlanArtifact', "artifact.type === 'plan'", 'previewMarkdown', 'plan.md', 'session_plan', 'artifact_store', 'run_report', 'action_output']) {
  forbidText(artifactList, forbidden, `TraceArtifactList must not retain ${forbidden}`);
}

const context = read('src/renderer/features/debugger/ControlPanel/RightRailContext.tsx');
for (const requiredArea of ['TaskContextPanelViewModel', 'TaskContextResource', 'Task context resources']) {
  requireText(context, requiredArea, `RightRailContext must retain ${requiredArea}`);
}
for (const forbidden of ['context?: ContextPanelViewModel', 'Rdx', 'Capture', 'Preview', 'Refresh', 'Copy', 'Clear', '<details', 'Session details', 'Replay options', 'Runtime details', 'Context ID', 'Replay session', 'Capture file', 'Remote ID', 'cliSummary', '<Fact label="CLI"', 'toolCount', 'namespace inventory']) {
  forbidText(context, forbidden, `RightRailContext must not retain ${forbidden}`);
}

const capturePanel = read('src/renderer/features/debugger/ControlPanel/CapturePanel.tsx');
for (const required of ['RdxContextPanelViewModel', "'Open'", "'Preview'", "'Refresh'", "'Copy'", "'Clear'", 'capture.openProjectInput', 'context.openHumanPreview', 'capture.clearOpenedState', 'right-rail-capture-open-row', 'right-rail-capture-open-button']) {
  requireText(capturePanel, required, `CapturePanel must retain ${required}`);
}
forbidText(capturePanel, 'right-rail-capture-summary', 'CapturePanel must not duplicate the selected capture above its picker');

const rightRailCss = read('src/renderer/features/debugger/ControlPanel/RightRail.css');
for (const required of ['.right-rail-empty-state', '.right-rail-empty-visual', 'grid-template-rows:', 'flex: 0 0 auto', 'font-size: var(--text-md)', 'font-size: var(--text-xl)', '.right-rail-capture-panel', '.right-rail-capture-open-row', '.project-capture-import-section', '.project-capture-input-list', '.output-visual', '.context-visual', '.capture-visual']) {
  requireText(rightRailCss, required, `RightRail.css must retain ${required}`);
}
for (const forbidden of ['.control-panel', '.cp-section', '.capture-library', '.panel-action-btn', 'trace-plan-preview', 'is-plan', '.right-rail-details', '.right-rail-context-area-heading', '.right-rail-rdx-context', '.right-rail-section:not(.is-empty)', '.right-rail-section.is-empty', '.right-rail-capture-summary']) {
  forbidText(rightRailCss, forbidden, `RightRail.css must not retain ${forbidden}`);
}

const drawer = read('src/renderer/app/RightRailDrawer.tsx');
for (const requiredDrawerContract of ['role="dialog"', 'aria-modal="true"', "event.key === 'Escape'", 'returnFocusRef']) {
  requireText(drawer, requiredDrawerContract, `RightRailDrawer must retain ${requiredDrawerContract}`);
}

const workbenchLayout = read('src/renderer/app/useWorkbenchLayout.ts');
const layoutConstants = read('src/shared/constants/layout.ts');
requireText(layoutConstants, 'RIGHT_RAIL_DRAWER_BREAKPOINT = 920', 'right rail drawer must enter only once the work surface is genuinely narrow');
requireText(workbenchLayout, 'useNarrowViewport(RIGHT_RAIL_DRAWER_BREAKPOINT)', 'workbench layout must use the shared right rail drawer breakpoint');

const traceTypes = read('src/shared/types/trace.ts');
for (const requiredContract of ['task: TaskContextPanelViewModel;', 'rdx: RdxContextPanelViewModel;', "export type TraceArtifactSource = 'report' | 'evidence' | 'image' | 'document' | 'data' | 'other';", 'contextId?: string;', 'replaySessionId?: string;', 'remoteId?: string;']) {
  requireText(traceTypes, requiredContract, `trace contract must retain ${requiredContract}`);
}
for (const forbidden of ['groups:', 'session:outputs:list', 'previewMarkdown', 'session_plan', 'artifact_store', 'run_report', 'action_output', 'cliSummary', 'toolCount']) {
  forbidText(traceTypes, forbidden, `trace contract must not retain ${forbidden}`);
}

const projection = read('src/main/agent-trace/rightRailProjectionMappers.ts');
for (const forbidden of ['ToolRuntimeSummary', 'cliSummary', 'toolCount', 'session_plan', 'run_report', 'action_output', 'previewMarkdown']) {
  forbidText(projection, forbidden, `right rail projection must not retain ${forbidden}`);
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

const controlPanel = read('src/renderer/features/debugger/ControlPanel/index.tsx');
for (const required of ['rightRailTarget', 'ProjectCaptureImportPanel', "rightRailTarget !== 'session'"]) {
  requireText(controlPanel, required, `ControlPanel must retain ${required}`);
}
const channels = read('src/shared/renderer-api/channels.ts');
for (const forbidden of ['ClassicSessionControlPanel', 'shouldShowTraceRightRail', 'CaptureLibrary']) {
  forbidText(controlPanel, forbidden, `ControlPanel must not retain ${forbidden}`);
}
forbidText(channels, 'session:outputs:list', 'IPC channel registry must not retain session:outputs:list');

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
for (const forbiddenDocText of ['keeps `plan.md` first', '`plan.md` fixed', 'CLI summary, and deduplicated diagnostics', 'source: \'session_plan\'', 'Context has only Task Context and RDX Context', 'exactly three top-level sections: `Progress / Artifacts / Context`']) {
  for (const [name, source] of Object.entries(docs)) forbidText(source, forbiddenDocText, `${name} must not retain ${forbiddenDocText}`);
}

console.log('[right-rail] OK');
