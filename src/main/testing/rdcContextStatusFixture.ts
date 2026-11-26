import type { RdcContextStatus } from '../rdc/RdcContextStatus';

/** A status as RDC-Tool reports it after the watchdog stopped worker 11 and quarantined the replay. */
export function stuckContextStatus(): RdcContextStatus {
  return {
    context_id: 'ctx',
    source: 'daemon',
    daemon: {
      state: 'alive',
      pid: 10,
      start_generation: 'windows-filetime:1',
      started_at: '2026-01-01T00:00:00Z',
      last_activity_at: '2026-01-01T00:00:00Z',
    },
    worker: { state: 'exited', pid: 11, start_generation: 'windows-filetime:2', log_path: '/state/worker.log' },
    active_operation: {},
    worker_lifecycle: [
      { event: 'started', pid: 11, start_generation: 'windows-filetime:2', at_ms: 1 },
      {
        event: 'exited',
        pid: 11,
        start_generation: 'windows-filetime:2',
        at_ms: 2,
        reason: 'no_progress',
        code: 'worker_stuck',
        exit_confirmed: true,
        trace_id: 'trace',
        request_id: 'rdc-agent-1',
        stack_log: { path: '/state/worker.log' },
      },
    ],
    backend: 'local',
    current_session_id: 'replay',
    current_capture_file_id: 'file',
    session_locator: { rdc_path: '/project/a.rdc', session_id: 'replay', frame_index: 0, active_event_id: 5 },
    sessions: [
      {
        session_id: 'replay',
        capture_file_id: 'file',
        rdc_path: '/project/a.rdc',
        backend_type: 'local',
        state: 'degraded',
        is_live: false,
        frame_index: 0,
        active_event_id: 5,
        recovery: {
          status: 'requires_restart',
          requires_restart: true,
          last_error: 'worker stopped',
          worker_exit: {
            pid: 11,
            birth: 'windows-filetime:2',
            reason: 'no_progress',
            trace_id: 'trace',
            request_id: 'rdc-agent-1',
            stack_log: { path: '/state/worker.log', tail: 'Thread 0x1' },
          },
        },
      },
    ],
    recovery: { status: 'degraded' },
    preview: {},
    notes: '',
    focus: {},
    queued_request_ids: [],
  };
}

/** The same context while worker 11 still serves a live replay. */
export function liveContextStatus(): RdcContextStatus {
  const status = stuckContextStatus();
  return {
    ...status,
    worker: { ...status.worker, state: 'alive' },
    worker_lifecycle: status.worker_lifecycle.slice(0, 1),
    recovery: {},
    sessions: status.sessions.map((session) => ({
      ...session,
      state: 'active',
      is_live: true,
      recovery: { status: 'idle', requires_restart: false, last_error: '', worker_exit: null },
    })),
  };
}
