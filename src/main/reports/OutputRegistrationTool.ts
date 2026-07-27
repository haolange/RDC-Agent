import fs from 'fs';
import path from 'path';
import { generateEventId, nowIso } from '@shared/utils/id';
import type { ArtifactKind, ArtifactRecord } from '@shared/types/harness';
import type { AgentTool } from '../agent-runtime/agent/AgentTool';
import { artifactStore } from './ArtifactStore';
import { runScopedStore } from '../workflow/debugger/RunScopedStore';

const OUTPUT_KINDS: ArtifactKind[] = ['report', 'screenshot', 'trace', 'shader', 'log', 'data', 'note'];

interface OutputRegistrationParams {
  path: string;
  title?: string;
  kind?: ArtifactKind;
}

interface OutputRegistrationContext {
  sessionId: string | null | undefined;
  runId: string | null | undefined;
  projectRootPath: string | null | undefined;
}

const isInside = (rootPath: string, candidatePath: string): boolean => {
  const relative = path.relative(rootPath, candidatePath);
  return relative !== '' && !relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative);
};

const isProjectInput = (projectRootPath: string, sourcePath: string): boolean => {
  const inputsRoot = path.resolve(projectRootPath, '.rdx', 'inputs');
  return sourcePath === inputsRoot || isInside(inputsRoot, sourcePath);
};

const readRequiredString = (value: unknown, label: string): string => {
  if (typeof value !== 'string' || value.trim().length === 0) throw new Error(`${label} is required.`);
  return value.trim();
};

/**
 * Explicitly publishes a project file as a user-recognizable output of this run.
 * The tool copies the selected file into the run-owned artifact directory first;
 * it never scans workspace paths or treats an input attachment as output.
 */
export function createOutputRegistrationTool(context: OutputRegistrationContext): AgentTool<OutputRegistrationParams, { artifactId: string; path: string }> {
  return {
    name: 'output_register',
    label: 'Publish Output',
    description: 'Publish one finished project file as a user-visible session output. Use only after creating the file; never publish inputs or plans.',
    parameters: {
      type: 'object',
      required: ['path'],
      properties: {
        path: { type: 'string', description: 'Project-relative path of the finished file to publish.' },
        title: { type: 'string', description: 'Optional user-facing file title.' },
        kind: { type: 'string', enum: OUTPUT_KINDS, description: 'Output category. Defaults to note.' },
      },
    },
    permissionHint: 'session_mutation',
    async execute(_toolCallId, params, signal) {
      if (signal?.aborted) throw new Error('Output publication cancelled.');
      const sessionId = context.sessionId;
      const runId = context.runId;
      const projectRootPath = context.projectRootPath;
      if (!sessionId || !runId || !projectRootPath) {
        return { content: [{ type: 'text', text: 'A live session, run, and project are required to publish an output.' }], isError: true };
      }

      const requestedPath = readRequiredString(params.path, 'path');
      const root = path.resolve(projectRootPath);
      const sourcePath = path.resolve(root, requestedPath);
      if (!isInside(root, sourcePath)) {
        return { content: [{ type: 'text', text: 'Only files inside the active project can be published.' }], isError: true };
      }
      if (isProjectInput(root, sourcePath)) {
        return { content: [{ type: 'text', text: 'Project inputs cannot be published as outputs.' }], isError: true };
      }

      let stat: fs.Stats;
      try {
        stat = fs.statSync(sourcePath);
      } catch {
        return { content: [{ type: 'text', text: `Output file does not exist: ${requestedPath}` }], isError: true };
      }
      if (!stat.isFile()) {
        return { content: [{ type: 'text', text: 'Only regular files can be published as outputs.' }], isError: true };
      }

      const artifactId = generateEventId('output');
      const outputName = `${artifactId}-${path.basename(sourcePath)}`;
      const runRoot = runScopedStore.getRunRoot(sessionId, runId);
      const targetPath = path.resolve(runRoot, 'artifacts', outputName);
      fs.mkdirSync(path.dirname(targetPath), { recursive: true });
      fs.copyFileSync(sourcePath, targetPath);

      const now = nowIso();
      const kind = OUTPUT_KINDS.includes(params.kind as ArtifactKind) ? params.kind as ArtifactKind : 'note';
      const artifact: ArtifactRecord = artifactStore.register(sessionId, runId, {
        artifactId,
        sessionId,
        runId,
        kind,
        title: typeof params.title === 'string' && params.title.trim() ? params.title.trim() : path.basename(sourcePath),
        filePath: targetPath,
        mimeType: 'application/octet-stream',
        sizeBytes: stat.size,
        evidenceIds: [],
        metadata: { sourcePath },
        createdAt: now,
        updatedAt: now,
      });
      return {
        content: [{ type: 'text', text: `Published output: ${artifact.title}` }],
        details: { artifactId: artifact.artifactId, path: artifact.filePath },
      };
    },
  };
}
