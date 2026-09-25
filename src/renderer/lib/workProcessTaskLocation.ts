/** Internal request shared by the Progress rail and the windowed work transcript. */
export const WORK_PROCESS_LOCATE_TASK_EVENT = 'work-process-locate-task';

export interface WorkProcessTaskLocation {
  element: HTMLElement;
  reveal: () => void;
}

export interface WorkProcessTaskLocationRequest {
  taskId: string;
  candidates: WorkProcessTaskLocation[];
}
