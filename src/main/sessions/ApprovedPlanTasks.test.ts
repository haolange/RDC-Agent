import { expect, it, vi } from 'vitest';
import { renderPlanTaskRequirements, type PlanTaskRequirement } from '@shared/types/taskExecution';

const mocks = vi.hoisted(() => ({ readOffer: vi.fn(), readMarkdown: vi.fn() }));
vi.mock('./StorageAdapter', () => ({ storageAdapter: { executionOffers: { read: mocks.readOffer } } }));
vi.mock('./sessionPlanArtifact', () => ({ planArtifactWriter: { readMarkdown: mocks.readMarkdown } }));
import { readApprovedPlanTasks } from './ApprovedPlanTasks';

it('reads only the owning execution offer plan with its exact URI and hash', () => {
  const task: PlanTaskRequirement = { taskId: 'task', revision: 1, subject: 'Work', description: '', blockedBy: [], completionRequirements: ['result'] };
  mocks.readOffer.mockReturnValue({ plan: { uri: 'session://plans/frozen.md', hash: 'a'.repeat(64) } });
  mocks.readMarkdown.mockReturnValue({ markdown: renderPlanTaskRequirements([task]) });
  expect(readApprovedPlanTasks('owner')).toEqual([task]);
  expect(mocks.readOffer).toHaveBeenCalledWith('owner');
  expect(mocks.readMarkdown).toHaveBeenCalledWith('owner', 'session://plans/frozen.md', 'a'.repeat(64));
  mocks.readMarkdown.mockImplementation(() => { throw new Error('PLAN_HASH_MISMATCH'); });
  expect(() => readApprovedPlanTasks('owner')).toThrow('PLAN_HASH_MISMATCH');
  mocks.readOffer.mockReturnValue(null);
  expect(readApprovedPlanTasks('ordinary-session')).toEqual([]);
});
