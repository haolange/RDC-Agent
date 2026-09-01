/**
 * Shared stdin + fail-closed helpers for builtin Hook templates.
 * HookEngine writes the HookContext JSON to stdin and ends the stream.
 */
export function isTestMode() {
  return process.env.RDC_AGENT_TEST_MODE === '1';
}

export function parseContext(raw) {
  const text = typeof raw === 'string' ? raw.trim() : '';
  if (!text) return {};
  try {
    const value = JSON.parse(text);
    return value && typeof value === 'object' ? value : {};
  } catch {
    return { __parseError: true, raw: text.slice(0, 200) };
  }
}

export function readHookContext(timeoutMs = 1500) {
  return new Promise((resolve) => {
    if (process.stdin.readableEnded) {
      resolve(parseContext(''));
      return;
    }
    const chunks = [];
    const finish = () => {
      clearTimeout(timer);
      resolve(parseContext(chunks.join('')));
    };
    const timer = setTimeout(finish, timeoutMs);
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', (chunk) => {
      chunks.push(chunk);
    });
    process.stdin.on('end', finish);
    process.stdin.on('error', finish);
    process.stdin.resume();
  });
}

export function payloadOf(context) {
  return context?.payload && typeof context.payload === 'object' ? context.payload : {};
}

export function toolArgumentsOf(context) {
  const payload = payloadOf(context);
  if (payload.arguments && typeof payload.arguments === 'object') return payload.arguments;
  return payload;
}

export function fail(message) {
  process.stderr.write(`${message}\n`);
  process.exit(1);
}

export function pass(message) {
  if (message) process.stdout.write(`${message}\n`);
  process.exit(0);
}

export const EPISTEMIC_RANK = {
  unknown: 0,
  inferred: 1,
  derived: 2,
  observed: 3,
};

export function epistemicRank(status) {
  return Object.prototype.hasOwnProperty.call(EPISTEMIC_RANK, status) ? EPISTEMIC_RANK[status] : -1;
}

export function isSha256Prefixed(value) {
  return typeof value === 'string' && /^sha256:[a-f0-9]{64}$/i.test(value.trim());
}

export function walkClaims(value, visit) {
  if (!value || typeof value !== 'object') return;
  if (Array.isArray(value)) {
    value.forEach((entry) => walkClaims(entry, visit));
    return;
  }
  if (typeof value.claimId === 'string' || typeof value.epistemic === 'string' || Array.isArray(value.compactProvenance)) {
    visit(value);
  }
  for (const nested of Object.values(value)) walkClaims(nested, visit);
}
