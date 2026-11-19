import { createHash, randomUUID } from 'node:crypto';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { z } from 'zod';
import type { KnowledgeTopicDocument } from '@shared/types/knowledge';
import { assertSafeKnowledgeWriteTarget, writeKnowledgeCardAtomic } from './knowledgeFs';

const topicId = z.string().regex(/^[a-z0-9][a-z0-9-]{0,63}$/u);
const name = z.string().trim().min(1).max(120);
export const KnowledgeTopicSchema = z.object({
  id: topicId, label: name, synonyms: z.array(name).max(32),
}).strict();
export const KnowledgeTopicAssignmentSchema = z.object({
  cardId: z.string().trim().min(1).max(512),
  contentHash: z.string().regex(/^[a-f0-9]{64}$/u),
  topicIds: z.array(topicId).max(64),
}).strict();
export const KnowledgeTopicChangesSchema = z.object({
  expectedRevision: z.string().regex(/^[a-f0-9]{64}$/u),
  expectedCorpusRevision: z.string().regex(/^[a-f0-9]{64}$/u),
  topics: z.array(KnowledgeTopicSchema).max(128),
  assignments: z.array(KnowledgeTopicAssignmentSchema).max(10000),
  merges: z.array(z.object({ sourceId: topicId, targetId: topicId }).strict()).max(128).default([]),
}).strict();
const documentSchema = z.object({
  schemaVersion: z.literal(1), topics: z.array(KnowledgeTopicSchema).max(128),
  assignments: z.array(KnowledgeTopicAssignmentSchema).max(10000),
}).strict().superRefine((document, context) => {
  const ids = new Set<string>();
  const terms = new Map<string, string>();
  for (const topic of document.topics) {
    if (ids.has(topic.id)) context.addIssue({ code: 'custom', message: `Duplicate topic id: ${topic.id}` });
    ids.add(topic.id);
    for (const term of [topic.label, ...topic.synonyms]) {
      const key = term.normalize('NFKC').toLocaleLowerCase();
      const owner = terms.get(key);
      if (owner && owner !== topic.id) context.addIssue({ code: 'custom', message: `Ambiguous topic synonym: ${term}` });
      terms.set(key, topic.id);
    }
  }
  const cards = new Set<string>();
  for (const assignment of document.assignments) {
    if (cards.has(assignment.cardId)) context.addIssue({ code: 'custom', message: `Duplicate card assignment: ${assignment.cardId}` });
    cards.add(assignment.cardId);
    if (new Set(assignment.topicIds).size !== assignment.topicIds.length || assignment.topicIds.some(id => !ids.has(id))) {
      context.addIssue({ code: 'custom', message: `Invalid topic assignment: ${assignment.cardId}` });
    }
  }
});

const fileName = '.topics.json';
const lockName = '.topics.lock';
const emptyDocument = (): KnowledgeTopicDocument => ({ schemaVersion: 1, topics: [], assignments: [] });
const digest = (source: string): string => createHash('sha256').update(source, 'utf8').digest('hex');

export class KnowledgeTopicStore {
  constructor(private readonly root: () => string) {}

  validate(value: KnowledgeTopicDocument): void { documentSchema.parse(value); }

  async read(): Promise<{ document: KnowledgeTopicDocument; revision: string; source: string | null }> {
    const target = path.join(this.root(), fileName);
    try {
      const stat = await fs.lstat(target);
      if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink > 1) throw new Error('KNOWLEDGE_TOPICS_UNSAFE_PATH');
      const source = await fs.readFile(target, 'utf8');
      const document = documentSchema.parse(JSON.parse(source));
      return { document, revision: digest(source), source };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        return { document: emptyDocument(), revision: digest('absent'), source: null };
      }
      throw error;
    }
  }

  async withWriteLock<T>(operation: () => Promise<T>): Promise<T> {
    const root = this.root();
    const lockPath = await assertSafeKnowledgeWriteTarget(root, lockName);
    const token = `${process.pid}:${randomUUID()}`;
    let handle: Awaited<ReturnType<typeof fs.open>>;
    try { handle = await fs.open(lockPath, 'wx'); }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'EEXIST') throw new Error('KNOWLEDGE_TOPICS_BUSY: a topic update is already in progress.');
      throw error;
    }
    let initialized = false;
    const identity = await handle.stat();
    try {
      await handle.writeFile(token, 'utf8');
      initialized = true;
      await handle.close();
      return await operation();
    } finally {
      await handle.close().catch(() => undefined);
      const owner = await fs.readFile(lockPath, 'utf8').catch(() => null);
      const current = await fs.lstat(lockPath).catch(() => null);
      if (owner === token || (!initialized && current?.dev === identity.dev && current.ino === identity.ino)) await fs.unlink(lockPath);
    }
  }

  async write(expectedRevision: string, next: KnowledgeTopicDocument): Promise<string> {
    const valid = documentSchema.parse(next);
    const before = await this.read();
    if (before.revision !== expectedRevision) throw new Error('KNOWLEDGE_TOPICS_CHANGED: refresh the preview.');
    const target = await assertSafeKnowledgeWriteTarget(this.root(), fileName);
    const source = `${JSON.stringify(valid, null, 2)}\n`;
    try {
      await writeKnowledgeCardAtomic(target, source);
      return digest(source);
    } catch (error) {
      const after = await fs.readFile(target, 'utf8').catch(() => null);
      if (after === source) {
        if (before.source === null) await fs.unlink(target);
        else await writeKnowledgeCardAtomic(target, before.source);
      }
      throw error;
    }
  }
}
