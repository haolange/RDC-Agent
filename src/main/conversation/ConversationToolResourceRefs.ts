import fs from 'fs';
import path from 'path';
import type { ConversationToolResourceRef } from '@shared/types/conversation';
import type { ToolCallResult } from '@shared/types/tool';

const isRecord = (value: unknown): value is Record<string, unknown> => (
  Boolean(value) && typeof value === 'object' && !Array.isArray(value)
);

const stringValue = (record: Record<string, unknown>, key: string): string | null => {
  const value = record[key];
  return typeof value === 'string' && value.trim() ? value.trim() : null;
};

const normalizePathIdentity = (value: string): string => {
  const normalized = path.normalize(value).replaceAll('\\', '/');
  return process.platform === 'win32' ? normalized.toLocaleLowerCase() : normalized;
};

const pathRef = (value: string, kind: 'file' | 'directory'): ConversationToolResourceRef => ({
  id: kind + ':' + normalizePathIdentity(value),
  kind,
  label: path.basename(value) || value,
  path: value,
});

const classifyPath = (value: string, fallback: 'file' | 'directory'): 'file' | 'directory' => {
  try {
    return fs.statSync(value).isDirectory() ? 'directory' : 'file';
  } catch {
    return fallback;
  }
};

const parseMcpName = (toolName: string): { server: string; tool: string } | null => {
  if (!toolName.startsWith('mcp__')) return null;
  const remainder = toolName.slice('mcp__'.length);
  const separator = remainder.lastIndexOf('__');
  if (separator <= 0 || separator >= remainder.length - 2) return null;
  return { server: remainder.slice(0, separator), tool: remainder.slice(separator + 2) };
};

const webRef = (details: Record<string, unknown>): ConversationToolResourceRef | null => {
  const url = stringValue(details, 'url');
  const query = stringValue(details, 'query');
  const title = stringValue(details, 'title');
  if (!url && !query) return null;
  let host = '';
  if (url) {
    try { host = new URL(url).hostname; } catch { host = ''; }
  }
  const label = title ?? query ?? host ?? url!;
  return {
    id: 'web:' + (url ?? query),
    kind: 'web',
    label,
    summary: host || stringValue(details, 'provider') || undefined,
    url: url ?? undefined,
  };
};

const dedupe = (refs: ConversationToolResourceRef[]): ConversationToolResourceRef[] => {
  const seen = new Set<string>();
  return refs.filter((ref) => {
    if (seen.has(ref.id)) return false;
    seen.add(ref.id);
    return true;
  });
};

/** Extract only allowlisted, non-sensitive resource evidence from a successful tool result. */
export const extractConversationToolResourceRefs = (
  toolName: string,
  result: ToolCallResult | undefined,
): ConversationToolResourceRef[] => {
  if (!result?.ok) return [];
  const normalizedName = toolName.trim().toLowerCase();
  const mcp = parseMcpName(normalizedName);
  if (mcp) {
    return [{
      id: 'mcp:' + mcp.server + ':' + mcp.tool,
      kind: 'mcp',
      label: mcp.tool.replaceAll('_', ' '),
      summary: mcp.server,
    }];
  }

  const details = isRecord(result.data?.details) ? result.data.details : {};
  const refs: ConversationToolResourceRef[] = [];
  const addPath = (key: string, fallback: 'file' | 'directory') => {
    const value = stringValue(details, key);
    if (value) refs.push(pathRef(value, classifyPath(value, fallback)));
  };

  if (['read_file', 'read_image', 'write_file', 'edit_file', 'delete_file'].includes(normalizedName)) addPath('path', 'file');
  if (normalizedName === 'code_interpreter') addPath('cwd', 'directory');
  if (normalizedName === 'notebook_edit') addPath('notebook_path', 'file');
  if (normalizedName === 'copy_file' || normalizedName === 'move_file') {
    addPath('source', 'file');
    addPath('destination', 'file');
  }
  if (normalizedName === 'glob') addPath('cwd', 'directory');
  if (normalizedName === 'grep') addPath('root', 'directory');
  if (normalizedName === 'shell') addPath('cwd', 'directory');

  if (normalizedName === 'skill_read') {
    const skillId = stringValue(details, 'skillId');
    const sourcePath = stringValue(details, 'sourcePath');
    const name = stringValue(details, 'name') ?? skillId;
    if (skillId && name) {
      refs.push({
        id: 'skill:' + skillId,
        kind: 'skill',
        label: name,
        summary: sourcePath ? path.basename(sourcePath) : 'SKILL.md',
        path: sourcePath ?? undefined,
      });
    }
  }

  if (normalizedName === 'web_fetch' || normalizedName === 'web_search') {
    const ref = webRef(details);
    if (ref) refs.push(ref);
  }
  return dedupe(refs);
};