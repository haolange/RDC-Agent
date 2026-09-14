import fs from 'fs';
import path from 'path';
import type { ConversationMessage, ConversationToolResourceRef, ConversationWorkBlock } from '@shared/types/conversation';
import type { PromptSegment } from '@shared/types/rdxRuntime';
import type { TaskContextResource } from '@shared/types/trace';

const collectToolRefs = (
  blocks: ConversationWorkBlock[] | undefined,
  resources: ConversationToolResourceRef[],
): void => {
  for (const block of blocks ?? []) {
    for (const tool of block.toolCalls) {
      if (tool.status === 'complete') resources.push(...(tool.resourceRefs ?? []));
    }
    collectToolRefs(block.children, resources);
  }
};

const safeOpenPath = (value: string | undefined): string | undefined => {
  if (!value) return undefined;
  try { return fs.existsSync(value) ? value : undefined; } catch { return undefined; }
};

const pathSummary = (targetPath: string | undefined, projectRoot: string | undefined): string | undefined => {
  if (!targetPath) return undefined;
  if (projectRoot) {
    const relative = path.relative(projectRoot, targetPath);
    if (relative && !relative.startsWith('..') && !path.isAbsolute(relative)) {
      return relative.replaceAll('\\', '/');
    }
  }
  const parent = path.dirname(targetPath);
  return parent && parent !== '.' ? path.basename(parent) : undefined;
};

const fromToolRef = (
  ref: ConversationToolResourceRef,
  projectRoot: string | undefined,
): TaskContextResource => ({
  id: ref.id,
  kind: ref.kind,
  label: ref.label,
  summary: ref.path ? pathSummary(ref.path, projectRoot) ?? ref.summary : ref.summary,
  state: 'used',
  path: safeOpenPath(ref.path),
  url: ref.url,
});

const fromPromptSegment = (
  segment: PromptSegment,
  projectRoot: string | undefined,
): TaskContextResource | null => {
  if (segment.kind === 'preloaded-skill') {
    const skillId = segment.id.startsWith('skill:') ? segment.id.slice('skill:'.length) : segment.id;
    return {
      id: 'prompt-skill:' + skillId + ':' + segment.sourceHash,
      kind: 'skill',
      label: skillId,
      summary: path.basename(segment.sourcePath) || 'SKILL.md',
      state: 'preloaded',
      path: safeOpenPath(segment.sourcePath),
    };
  }
  if (segment.kind === 'scoped-instruction') {
    return {
      id: 'prompt-file:' + segment.sourceHash,
      kind: 'file',
      label: path.basename(segment.sourcePath) || segment.sourcePath,
      summary: pathSummary(segment.sourcePath, projectRoot),
      state: 'preloaded',
      path: safeOpenPath(segment.sourcePath),
    };
  }
  return null;
};

const dedupeToolRefs = (refs: ConversationToolResourceRef[]): ConversationToolResourceRef[] => {
  const seen = new Set<string>();
  return refs.filter((ref) => {
    const identity = ref.path
      ? 'path:' + path.normalize(ref.path).replaceAll('\\', '/').toLocaleLowerCase()
      : ref.id;
    if (seen.has(identity)) return false;
    seen.add(identity);
    return true;
  });
};
const dedupe = (resources: TaskContextResource[]): TaskContextResource[] => {
  const seen = new Set<string>();
  return resources.filter((resource) => {
    const identity = resource.path
      ? 'path:' + path.normalize(resource.path).replaceAll('\\', '/').toLocaleLowerCase()
      : resource.id;
    if (seen.has(identity)) return false;
    seen.add(identity);
    return true;
  });
};

/**
 * Durable conversation refs and frozen prompt segments are the only runtime
 * sources for task Context. Configured catalogs and generic tool names are not resources.
 */
export const collectSessionTaskContextResources = (input: {
  messages: ConversationMessage[];
  promptSegments: PromptSegment[];
  projectRoot?: string;
}): TaskContextResource[] => {
  const toolRefs: ConversationToolResourceRef[] = [];
  for (const message of input.messages) {
    if (message.role === 'assistant') collectToolRefs(message.workTrace?.blocks, toolRefs);
  }
  const promptResources = input.promptSegments
    .map((segment) => fromPromptSegment(segment, input.projectRoot))
    .filter((resource): resource is TaskContextResource => resource !== null);
  return dedupe([
    ...promptResources,
    ...dedupeToolRefs(toolRefs)
      .filter((ref) => !ref.path?.startsWith('session://plans/'))
      .map((ref) => fromToolRef(ref, input.projectRoot)),
  ]);
};
