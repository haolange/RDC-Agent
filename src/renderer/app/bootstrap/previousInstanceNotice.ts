import { AppError } from '@shared/errors/appError';
import { notify } from '../../stores/notificationStore';
import type { ErrorCode } from '@shared/errors/errorCodes';
import type { PreviousInstanceClassification, PreviousInstanceNotice } from '@shared/types/lifecycle';
import type { ErrorDetail } from '../../i18n/humanizeError';
import type { Translator } from '../../i18n/messages';

const NOTICE_CODES: Record<PreviousInstanceClassification, ErrorCode> = {
  'js-fatal': 'PREVIOUS_INSTANCE_JS_FATAL',
  'native-crash-suspected': 'PREVIOUS_INSTANCE_NATIVE_CRASH',
  'renderer-gone': 'PREVIOUS_INSTANCE_RENDERER_GONE',
  'child-process-gone': 'PREVIOUS_INSTANCE_CHILD_PROCESS_GONE',
  'shutdown-interrupted': 'PREVIOUS_INSTANCE_SHUTDOWN_INTERRUPTED',
  'killed-or-power-loss-suspected': 'PREVIOUS_INSTANCE_KILLED',
};

/** The facts behind the notice, for "Copy details" only: classification, process, reason, time and affected turns. */
export function previousInstanceFacts(notice: PreviousInstanceNotice): ErrorDetail[] {
  const facts: Array<[string, string | number | undefined | null]> = [
    ['Classification', notice.classification],
    ['Previous instance', notice.instanceId || undefined],
    ['Previous pid', notice.pid || undefined],
    ['Last record', notice.lastRecord],
    ['Last record at', notice.lastRecordAt === null ? undefined : new Date(notice.lastRecordAt).toISOString()],
    ['Process', notice.process],
    ['Reason', notice.reason],
    ['Exit code', notice.exitCode],
    ['Crash files', notice.crashFiles],
    ...notice.interruptedTurns.map((turn): [string, string] => [
      'Interrupted turn',
      `${turn.sessionId ?? 'no session'} / ${turn.turnId}`,
    ]),
  ];
  return facts.flatMap(([label, value]) =>
    value === undefined || value === null || value === '' ? [] : [{ label, value: String(value) }],
  );
}

/** Once per renderer start: the previous launch did not end cleanly. Stays until dismissed, like every failure. */
export function announcePreviousInstance(notice: PreviousInstanceNotice, t: Translator): void {
  const error = new AppError(NOTICE_CODES[notice.classification], `previous launch ended: ${notice.classification}`);
  notify.failure(error, t, undefined, previousInstanceFacts(notice));
}
