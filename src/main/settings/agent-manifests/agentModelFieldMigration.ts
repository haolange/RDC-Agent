import YAML from 'yaml';
import { REASONING_SELECTIONS, type ReasoningSelection } from '@shared/types/modelCapability';
import { splitCanonicalAgentModelId } from '@shared/utils/agentModelRoute';
import { AppError } from '@shared/errors/appError';
import type { AgentModelBinding } from '@shared/types/settings';

export interface AgentModelFieldMigrationPlan {
  binding: AgentModelBinding;
  droppedHandoffModels: Array<{ label: string; agent: string; model: string }>;
  ignoredValues: string[];
  /** The manifest with `model`, `reasoning-level` and every handoff `model` removed; formatting and comments kept. */
  content: string;
}

const FRONTMATTER = /^(﻿?---\r?\n)([\s\S]*?)(\r?\n---\r?\n?)([\s\S]*)$/u;

const stringValues = (value: unknown): string[] => {
  if (typeof value === 'string') return [value.trim()].filter(Boolean);
  if (Array.isArray(value)) return value.filter((entry): entry is string => typeof entry === 'string').map((entry) => entry.trim()).filter(Boolean);
  return value === undefined || value === null ? [] : [String(value)];
};

/**
 * Moves the model fields a manifest used to declare into a Settings → Agents binding.
 * Only the frontmatter document is edited, so the rest of the file stays byte-identical.
 */
export function planAgentModelFieldMigration(rawContent: string): AgentModelFieldMigrationPlan {
  const match = FRONTMATTER.exec(rawContent);
  if (!match) throw new AppError('AGENT_MODEL_MIGRATION_NO_FRONTMATTER', 'the manifest has no YAML frontmatter.');
  const [, open, frontmatter, close, body] = match;
  const document = YAML.parseDocument(frontmatter);
  if (document.errors.length > 0) {
    throw new AppError('AGENT_MODEL_MIGRATION_FRONTMATTER_INVALID', document.errors[0].message);
  }

  // Values are read from the plain object; deletions go through the document so formatting survives.
  const record = (document.toJS() ?? {}) as Record<string, unknown>;
  const binding: AgentModelBinding = {};
  const ignoredValues: string[] = [];
  const models = stringValues(record.model);
  const model = models.find((entry) => splitCanonicalAgentModelId(entry) !== null);
  if (model) binding.model = model;
  ignoredValues.push(...models.filter((entry) => entry !== model));
  const reasoning = stringValues(record['reasoning-level'])[0];
  if (reasoning && REASONING_SELECTIONS.includes(reasoning as ReasoningSelection)) {
    binding.reasoningLevel = reasoning as ReasoningSelection;
  } else if (reasoning) {
    ignoredValues.push(reasoning);
  }
  document.delete('model');
  document.delete('reasoning-level');

  const droppedHandoffModels: AgentModelFieldMigrationPlan['droppedHandoffModels'] = [];
  const handoffs = document.get('handoffs');
  const handoffValues = Array.isArray(record.handoffs) ? record.handoffs as Array<Record<string, unknown>> : [];
  if (YAML.isSeq(handoffs)) {
    handoffs.items.forEach((item, index) => {
      if (!YAML.isMap(item) || !item.has('model')) return;
      const value = handoffValues[index] ?? {};
      droppedHandoffModels.push({
        label: String(value.label ?? ''),
        agent: String(value.agent ?? ''),
        model: stringValues(value.model).join(', '),
      });
      item.delete('model');
    });
  }

  const newline = close.startsWith('\r\n') ? '\r\n' : '\n';
  const serialized = document.toString({ lineWidth: 0, flowCollectionPadding: false }).replace(/\r?\n$/u, '').replace(/\r?\n/gu, newline);
  return { binding, droppedHandoffModels, ignoredValues, content: `${open}${serialized}${close}${body}` };
}
