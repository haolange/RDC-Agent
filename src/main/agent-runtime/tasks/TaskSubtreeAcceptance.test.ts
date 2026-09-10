import { expect, it } from 'vitest';
import { MemoryTaskStore } from './TaskStore';
import { TaskRegistry } from './TaskRegistry';
import { createTaskTools } from './TaskTools';
it('cannot mutate a sibling outside the delegated subtree through dependency links', async () => {
 const registry = new TaskRegistry(new MemoryTaskStore());
 const root = await registry.createTask('delegated');
 const owned = await registry.createTask('owned', { parentTaskId: root.id });
 const sibling = await registry.createTask('outside');
 const tool = createTaskTools(registry, { scopeRootTaskId: root.id }).find((item) => item.name === 'task_update')!;
 await expect(tool.execute('attempt', { taskId: owned.id, addBlocks: [sibling.id] })).rejects.toThrow();
 expect((await registry.getTask(sibling.id))?.blockedBy).toEqual([]);
});
