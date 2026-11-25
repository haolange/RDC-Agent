/**
 * The unreachable branch of an exhaustive `switch` over a discriminated union: it only type-checks when every member
 * was handled, so adding a member fails compilation at each dispatch that forgot it.
 */
export function assertNever(value: never): never {
  throw new Error(`Unhandled variant: ${JSON.stringify(value)}`);
}
