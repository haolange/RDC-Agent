import { AppError } from '@shared/errors/appError';
export function resolveRdcBatchInvocation(command: string, args: string[]): { command: string; args: string[] } {
  if (/\.bat$/i.test(command.trim()) || [command, ...args].some((value) => /rdc_bat_launcher\.ps1/i.test(value))) {
    throw new AppError('RDC_BAT_REJECTED', 'configure the bundled Python and cli/run_cli.py.');
  }
  return { command, args };
}
