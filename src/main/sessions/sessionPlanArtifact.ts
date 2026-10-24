import * as crypto from 'node:crypto';
import * as fs from 'node:fs';
import { formatSessionArtifactUri, shortArtifactHash } from '@shared/types/sessionArtifact';
import type { PlanReviewSection } from '@shared/types/planReview';
import { PLAN_TASK_REQUIREMENTS_HEADING, renderPlanTaskRequirements, parsePlanTaskRequirements, type PlanTaskRequirement } from '@shared/types/taskExecution';
import { sessionArtifactResolver, type SessionArtifactResolver, type SessionArtifactWriteResult } from './SessionArtifactResolver';

export const LIVE_PLAN_RELATIVE_PATH = 'plan.md';
export const LIVE_PLAN_URI = formatSessionArtifactUri('plans', LIVE_PLAN_RELATIVE_PATH);

export function normalizeArtifactHash(hash: string): string {
  return hash.trim().toLowerCase().replace(/^sha256:/, '');
}

export function composePlanMarkdown(input: { title: string; summary: string[]; content: string; taskRequirements?: PlanTaskRequirement[] }): string {
  const title = input.title.trim();
  const bullets = input.summary.map((line) => `- ${line.trim()}`).join('\n');
  const body = input.content.replace(/\r\n/g, '\n').trim();
  if (body.includes(PLAN_TASK_REQUIREMENTS_HEADING)) throw new Error('PLAN_TASK_REQUIREMENTS_INVALID: task contracts must be generated from requiredTaskIds, not supplied as Markdown.');
  const tasks = input.taskRequirements?.length ? `\n${renderPlanTaskRequirements(input.taskRequirements)}` : '';
  return `# ${title}\n\n${bullets}\n\n${body}\n${tasks}`;
}

export function sectionsFromMarkdown(markdown: string): PlanReviewSection[] {
  const text = markdown.replace(/\r\n/g, '\n');
  const matches = [...text.matchAll(/^##[ \t]+(.+)$/gm)];
  if (matches.length === 0) {
    const body = text.replace(/^#\s+.+\n+/, '').trim();
    return body ? [{ heading: '', body }] : [];
  }
  return matches.map((match, index) => {
    const heading = match[1].trim();
    const start = (match.index ?? 0) + match[0].length;
    const end = index + 1 < matches.length ? (matches[index + 1].index ?? text.length) : text.length;
    return { heading, body: text.slice(start, end).replace(/^\n+/, '').trim() };
  });
}

export class PlanArtifactWriter {
  constructor(private readonly resolver: SessionArtifactResolver = sessionArtifactResolver) {}

  writeLivePlan(sessionId: string, markdown: string): SessionArtifactWriteResult {
    return this.resolver.write(sessionId, LIVE_PLAN_URI, markdown);
  }

  freezeApprovedPlan(sessionId: string, expectedHash: string): SessionArtifactWriteResult & { taskRequirements: PlanTaskRequirement[] } {
    const { markdown, hash } = this.readMarkdown(sessionId, LIVE_PLAN_URI, expectedHash);
    const taskRequirements = parsePlanTaskRequirements(markdown);
    const stamp = new Date().toISOString().replace(/[:.]/g, '');
    const frozenUri = formatSessionArtifactUri('plans', `plan-${stamp}-${shortArtifactHash(hash)}.md`);
    return { ...this.resolver.write(sessionId, frozenUri, markdown), taskRequirements };
  }

  readMarkdown(sessionId: string, uri: string, expectedHash: string): { markdown: string; hash: string; uri: string } {
    const resolved = this.resolver.resolve(sessionId, uri);
    if (!fs.existsSync(resolved.absolutePath)) {
      throw new Error(`PLAN_NOT_FOUND: ${uri}`);
    }
    const bytes = fs.readFileSync(resolved.absolutePath);
    const hash = crypto.createHash('sha256').update(bytes).digest('hex');
    if (normalizeArtifactHash(expectedHash) !== hash) {
      throw new Error('PLAN_HASH_MISMATCH: sha256 does not match expectedHash.');
    }
    return { markdown: bytes.toString('utf8'), hash, uri: resolved.uri };
  }
}

export const planArtifactWriter = new PlanArtifactWriter();
