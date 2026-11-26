/** What started the app's shutdown: a closed window, a quit request, a process signal or an update. */
export const SHUTDOWN_CAUSES = ['window-close', 'before-quit', 'SIGINT', 'SIGTERM', 'update'] as const;
export type ShutdownCause = (typeof SHUTDOWN_CAUSES)[number];

/**
 * Why a running turn stopped: the person stopped it (Stop, edit and resend, a branch switch), the app was shutting
 * down, or the runtime cancelled it (a policy timeout or a parent abort).
 */
export const TURN_STOP_CAUSES = ['user', 'app-shutdown', 'runtime'] as const;
export type TurnStopCause = (typeof TURN_STOP_CAUSES)[number];
