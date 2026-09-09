/** Application composition supplies task-specific completion checks. */
export interface TaskCompletionBinding {
  handoffId: string;
  returnTo: string;
  deliveryRequirements: string;
  dispatchedAt: number;
  validationPolicy: string;
}
export interface TurnCompletionInput {
  profileId: string;
  turnId?: string;
  sessionId?: string | null;
  finalAnswerText: string;
  pendingHandoff?: boolean;
  pendingHandoffTarget?: string;
  taskBinding?: Readonly<TaskCompletionBinding> | null;
}
export type TurnCompletionValidator = (input: TurnCompletionInput) => unknown;
