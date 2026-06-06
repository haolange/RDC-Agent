import { MultiAgentWorkflowEngine } from './MultiAgentWorkflowEngine';
import { taskBoard } from './TaskBoard';

export const multiAgentWorkflowEngine = new MultiAgentWorkflowEngine(
  taskBoard.listTasks.bind(taskBoard),
);
