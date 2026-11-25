import path from 'node:path';
import { dialog, ipcMain, shell } from 'electron';
import { AppError } from '@shared/errors/appError';
import { confirmResourceTrust } from '../window/trustConfirmation';
import { nativeMessage } from '../window/nativeI18n';
import { hookEngine } from '../hooks/HookEngine';
import { requestSnapshotStore } from '../agent-runtime/prompt';
import { samePath } from '../platform/paths';
import { SCOPED_IMPORT_EXTENSIONS, scopedRuntimeService } from '../runtime/ScopedRuntimeService';
import { agentRuntimeConfigService } from '../settings/agent-manifests/AgentRuntimeConfigService';
import { storageAdapter } from '../sessions/store/StorageAdapter';
import { parseIpcArgs } from './validation/IpcPayloadGuard';
import {
  RdcRuntimeDeleteArgsSchema,
  RdcRuntimeGetSnapshotArgsSchema,
  RdcRuntimeListSnapshotsArgsSchema,
  RdcRuntimeOverviewArgsSchema,
  RdcRuntimeRevealArgsSchema,
  RdcRuntimeRevokeHookArgsSchema,
  RdcRuntimeRevokeMcpArgsSchema,
  RdcRuntimeTestHookArgsSchema,
  RdcRuntimeTrustHookArgsSchema,
  RdcRuntimeTrustMcpArgsSchema,
  ScopedResourceImportArgsSchema,
  ScopedResourceWriteArgsSchema,
} from './validation/rdcRuntimeSchemas';
import type { AgentRuntimeMcpDescriptor } from '@shared/types/agentRuntime';
import type { HookEvent, ScopedResourceImportRequest, ScopedResourceKind, ScopedResourceWriteRequest } from '@shared/types/rdcRuntime';

/**
 * A project root the renderer names must be a registered project. Main then reads, scaffolds and trusts resources only
 * under folders the person opened as projects, never under an arbitrary path.
 */
function ownedProjectRoot(raw: string | null | undefined): string | undefined {
  if (!raw) return undefined;
  const target = path.resolve(raw);
  const project = storageAdapter.listProjects().find((entry) => samePath(entry.rootPath, target));
  if (!project) throw new AppError('PROJECT_ROOT_UNKNOWN', 'the folder is not an open project.');
  return project.rootPath;
}

/** What the person is trusting: where it is defined and exactly what it runs or connects to. Env values stay hidden. */
function mcpTrustDetail(server: AgentRuntimeMcpDescriptor): string {
  const envKeys = Object.keys(server.env ?? {});
  return [
    server.sourcePath ? nativeMessage('mcpSource', { value: server.sourcePath }) : null,
    nativeMessage('mcpTransport', { value: server.transport }),
    server.command ? nativeMessage('mcpCommand', { value: [server.command, ...(server.args ?? [])].map(quoteArgument).join(' ') }) : null,
    server.url ? nativeMessage('mcpUrl', { value: server.url }) : null,
    envKeys.length ? nativeMessage('mcpEnvKeys', { value: envKeys.join(', ') }) : null,
  ].filter((line): line is string => line !== null).join('\n');
}

const quoteArgument = (value: string): string => (/^[\w./:=@+-]+$/u.test(value) ? value : JSON.stringify(value));

async function mutateHookTrust(
  projectRoot: string | undefined | null,
  hookId: string,
  mutate: (hookId: string, trustRoot?: string) => void,
  confirm?: (hook: ReturnType<typeof hookEngine.list>[number]) => Promise<boolean>,
) {
  const overviewRoot = ownedProjectRoot(projectRoot);
  hookEngine.load(scopedRuntimeService.overview(overviewRoot).userPaths.hooksPath, overviewRoot);
  const hook = hookEngine.list().find((entry) => entry.definition.id === hookId);
  if (confirm && hook && !await confirm(hook)) return scopedRuntimeService.overview(overviewRoot);
  // Same rule as renderer resolveHookTrustProjectRoot: only project-scope mutations receive a root.
  const trustRoot = hook?.scope === 'project' ? overviewRoot : undefined;
  mutate(hookId, trustRoot);
  return scopedRuntimeService.overview(overviewRoot);
}

export function registerRdcRuntimeHandlers(): void {
  ipcMain.handle('rdc-runtime:overview', (_event, ...rawArgs: unknown[]) => {
    const [projectRoot] = parseIpcArgs(RdcRuntimeOverviewArgsSchema, rawArgs, {
      label: 'rdc-runtime:overview',
      maxBytes: 8 * 1024,
      padTo: 1,
    });
    return scopedRuntimeService.overview(ownedProjectRoot(projectRoot));
  });

  ipcMain.handle('rdc-runtime:validate', (_event, ...rawArgs: unknown[]) => {
    const [request] = parseIpcArgs(ScopedResourceWriteArgsSchema, rawArgs, {
      label: 'rdc-runtime:validate',
      maxBytes: 2 * 1024 * 1024,
    }) as [ScopedResourceWriteRequest];
    const diagnostics = scopedRuntimeService.validate({ ...request, projectRoot: ownedProjectRoot(request.projectRoot) });
    return { valid: diagnostics.length === 0, diagnostics };
  });

  ipcMain.handle('rdc-runtime:upsert', (_event, ...rawArgs: unknown[]) => {
    const [request] = parseIpcArgs(ScopedResourceWriteArgsSchema, rawArgs, {
      label: 'rdc-runtime:upsert',
      maxBytes: 2 * 1024 * 1024,
    }) as [ScopedResourceWriteRequest];
    const projectRoot = ownedProjectRoot(request.projectRoot);
    scopedRuntimeService.upsert({ ...request, projectRoot });
    return scopedRuntimeService.overview(projectRoot);
  });

  // Main picks the source file, so the renderer cannot point an import at an arbitrary path.
  ipcMain.handle('rdc-runtime:import', async (_event, ...rawArgs: unknown[]) => {
    const [request] = parseIpcArgs(ScopedResourceImportArgsSchema, rawArgs, {
      label: 'rdc-runtime:import',
      maxBytes: 16 * 1024,
    }) as [ScopedResourceImportRequest];
    const projectRoot = ownedProjectRoot(request.projectRoot);
    const extensions = SCOPED_IMPORT_EXTENSIONS[request.kind];
    if (!extensions) throw new AppError('SCOPED_IMPORT_UNSUPPORTED', `${request.kind} resources are not imported from files.`);
    const picked = await dialog.showOpenDialog({
      title: nativeMessage('importResource'),
      filters: [{ name: request.kind, extensions: [...extensions] }],
      properties: ['openFile'],
    });
    const filePath = picked.canceled ? undefined : picked.filePaths[0];
    if (!filePath) return null;
    const document = scopedRuntimeService.importFromFile({ ...request, filePath, projectRoot });
    return { overview: scopedRuntimeService.overview(projectRoot), id: document.id };
  });

  ipcMain.handle('rdc-runtime:delete', (_event, ...rawArgs: unknown[]) => {
    const [kind, scope, id, projectRoot] = parseIpcArgs(RdcRuntimeDeleteArgsSchema, rawArgs, {
      label: 'rdc-runtime:delete',
      maxBytes: 8 * 1024,
      padTo: 4,
    });
    const ownedRoot = ownedProjectRoot(projectRoot);
    scopedRuntimeService.delete(kind as ScopedResourceKind, scope, id, ownedRoot);
    return scopedRuntimeService.overview(ownedRoot);
  });

  ipcMain.handle('rdc-runtime:reveal', async (_event, ...rawArgs: unknown[]) => {
    try {
      const [sourcePath] = parseIpcArgs(RdcRuntimeRevealArgsSchema, rawArgs, {
        label: 'rdc-runtime:reveal',
        maxBytes: 8 * 1024,
      });
      shell.showItemInFolder(sourcePath);
      return { success: true };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : String(error) };
    }
  });

  ipcMain.handle('rdc-runtime:trustHook', (_event, ...rawArgs: unknown[]) => {
    const [projectRoot, hookId] = parseIpcArgs(RdcRuntimeTrustHookArgsSchema, rawArgs, {
      label: 'rdc-runtime:trustHook',
      maxBytes: 8 * 1024,
      padTo: 2,
    });
    return mutateHookTrust(projectRoot, hookId, (id, trustRoot) => {
      hookEngine.trustHook(id, trustRoot);
    }, (hook) => confirmResourceTrust('hook', hook.definition.id,
      `${hook.sourcePath}\n${[hook.definition.command, ...hook.definition.args].join(' ')}`));
  });

  ipcMain.handle('rdc-runtime:revokeHook', (_event, ...rawArgs: unknown[]) => {
    const [projectRoot, hookId] = parseIpcArgs(RdcRuntimeRevokeHookArgsSchema, rawArgs, {
      label: 'rdc-runtime:revokeHook',
      maxBytes: 8 * 1024,
      padTo: 2,
    });
    return mutateHookTrust(projectRoot, hookId, (id, trustRoot) => {
      hookEngine.revokeHook(id, trustRoot);
    });
  });

  ipcMain.handle('rdc-runtime:trustMcp', async (_event, ...rawArgs: unknown[]) => {
    const [rawRoot, descriptorId] = parseIpcArgs(RdcRuntimeTrustMcpArgsSchema, rawArgs, {
      label: 'rdc-runtime:trustMcp',
      maxBytes: 8 * 1024,
    });
    const projectRoot = ownedProjectRoot(rawRoot)!;
    const server = agentRuntimeConfigService.listMcpServers(projectRoot)
      .find((entry) => entry.id === descriptorId && entry.scope === 'project');
    if (!server) throw new AppError('MCP_DESCRIPTOR_UNKNOWN', `${descriptorId} is not a project MCP server here.`);
    if (!await confirmResourceTrust('mcp', server.id, mcpTrustDetail(server))) return scopedRuntimeService.overview(projectRoot);
    return scopedRuntimeService.trustProjectMcp(projectRoot, descriptorId);
  });

  ipcMain.handle('rdc-runtime:revokeMcp', (_event, ...rawArgs: unknown[]) => {
    const [rawRoot, descriptorId] = parseIpcArgs(RdcRuntimeRevokeMcpArgsSchema, rawArgs, {
      label: 'rdc-runtime:revokeMcp',
      maxBytes: 8 * 1024,
    });
    return scopedRuntimeService.revokeProjectMcp(ownedProjectRoot(rawRoot)!, descriptorId);
  });

  ipcMain.handle('rdc-runtime:testHook', (_event, ...rawArgs: unknown[]) => {
    const [hookEvent, rawRoot, hookId] = parseIpcArgs(RdcRuntimeTestHookArgsSchema, rawArgs, {
      label: 'rdc-runtime:testHook',
      maxBytes: 8 * 1024,
      padTo: 3,
    });
    const projectRoot = ownedProjectRoot(rawRoot);
    const overview = scopedRuntimeService.overview(projectRoot);
    const context = {
      event: hookEvent as HookEvent,
      projectRoot,
      payload: { test: true, hookId, overviewHash: overview.resources.length },
    };
    return hookId ? hookEngine.test(hookId, context) : hookEngine.trigger(hookEvent as HookEvent, context);
  });

  ipcMain.handle('rdc-runtime:listSnapshots', (_event, ...rawArgs: unknown[]) => {
    const [sessionId, turnId] = parseIpcArgs(RdcRuntimeListSnapshotsArgsSchema, rawArgs, {
      label: 'rdc-runtime:listSnapshots',
      maxBytes: 4 * 1024,
      padTo: 2,
    });
    return requestSnapshotStore.list(sessionId, turnId);
  });

  ipcMain.handle('rdc-runtime:getSnapshot', (_event, ...rawArgs: unknown[]) => {
    const [sessionId, turnId, snapshotId] = parseIpcArgs(RdcRuntimeGetSnapshotArgsSchema, rawArgs, {
      label: 'rdc-runtime:getSnapshot',
      maxBytes: 4 * 1024,
    });
    return requestSnapshotStore.get(sessionId, turnId, snapshotId);
  });
}
