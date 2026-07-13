import type { JsonObject, JsonValue, RequestPlan } from '@shared/types/providerCapability';

const SECRET_HEADER = /^(?:authorization|proxy-authorization|x-api-key|api-key)$/i;

function cloneJson(value: JsonValue): JsonValue {
  if (Array.isArray(value)) return value.map(cloneJson);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([key, entry]) => [key, cloneJson(entry)]));
  }
  return value;
}

function mergeJson(target: Record<string, unknown>, patch: JsonObject): void {
  for (const [key, value] of Object.entries(patch)) {
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      const current = target[key];
      const nested = current && typeof current === 'object' && !Array.isArray(current)
        ? current as Record<string, unknown>
        : {};
      target[key] = nested;
      mergeJson(nested, value);
    } else {
      target[key] = cloneJson(value);
    }
  }
}

export function applyRequestPlanBody(
  body: Record<string, unknown>,
  requestPlan: RequestPlan,
): Record<string, unknown> {
  mergeJson(body, requestPlan.bodyPatch);
  return body;
}

export function requestPlanHeaders(requestPlan: RequestPlan): Record<string, string> {
  return Object.fromEntries(Object.entries(requestPlan.headers).filter(([key]) => !SECRET_HEADER.test(key)));
}
