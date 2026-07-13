import { EventStream } from '../core/EventStream';
import type { AssistantMessage, AssistantMessageEvent } from '../core/types';
import { ProviderHttpError } from './internal/http';

export interface AccountStreamRetryInput {
  createAttempt: () => EventStream<AssistantMessageEvent, AssistantMessage>;
  refresh: () => Promise<void>;
}

function isUnauthorized(error: unknown): boolean {
  if (error instanceof ProviderHttpError) return error.status === 401;
  const status = error && typeof error === 'object' ? (error as { status?: unknown }).status : undefined;
  if (status === 401) return true;
  const message = error instanceof Error ? error.message : String(error);
  return /(?:HTTP|API error:)\s*401\b|\b401\s*[-:]/i.test(message);
}

function isStreamContent(event: AssistantMessageEvent): boolean {
  return event.type !== 'start' && event.type !== 'done' && event.type !== 'error';
}

export function streamWithUnauthorizedRefresh(
  input: AccountStreamRetryInput,
): EventStream<AssistantMessageEvent, AssistantMessage> {
  const downstream = new EventStream<AssistantMessageEvent, AssistantMessage>(
    (event) => event.type === 'done',
    (event) => (event as Extract<AssistantMessageEvent, { type: 'done' }>).message,
  );

  void (async () => {
    let hasForwardedStart = false;
    let hasStreamContent = false;
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const upstream = input.createAttempt();
      try {
        for await (const event of upstream) {
          if (downstream.isDone) return;
          if (event.type === 'start') {
            if (!hasForwardedStart) {
              hasForwardedStart = true;
              downstream.push(event);
            }
            continue;
          }
          if (event.type === 'error' && attempt === 0 && !hasStreamContent && isUnauthorized(event.error)) {
            continue;
          }
          if (isStreamContent(event)) hasStreamContent = true;
          downstream.push(event);
        }
        if (!downstream.isDone) downstream.complete(await upstream.result());
        return;
      } catch (error) {
        if (attempt === 0 && !hasStreamContent && isUnauthorized(error)) {
          try {
            await input.refresh();
            continue;
          } catch (refreshError) {
            downstream.error(refreshError instanceof Error ? refreshError : new Error(String(refreshError)));
            return;
          }
        }
        downstream.error(error instanceof Error ? error : new Error(String(error)));
        return;
      }
    }
  })();

  return downstream;
}
