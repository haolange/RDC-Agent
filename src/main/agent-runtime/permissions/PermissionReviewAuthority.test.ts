import { beforeEach, expect, it, vi } from 'vitest';
const mock = vi.hoisted(() => ({ offer: vi.fn(), plan: vi.fn(), receipt: vi.fn() }));
vi.mock('../../sessions/StorageAdapter', () => ({ storageAdapter: { executionOffers: { read: mock.offer } } }));
vi.mock('../../sessions/sessionPlanArtifact', () => ({ planArtifactWriter: { readMarkdown: mock.plan } }));
vi.mock('../../tools/RdcExecutionReceipts', () => ({ rdcExecutionReceipts: { read: mock.receipt } }));
import { permissionReviewAuthority, permissionReviewEvidence } from './PermissionReviewAuthority';
const input: Parameters<typeof permissionReviewAuthority>[0] = { sessionId: 'isolated-child', messages: [
  { role: 'user', content: 'Actual request', timestamp: 0 },
  { role: 'user', content: 'Derived summary is not human authority', derivedContext: {} as never, timestamp: 1 },
  { role: 'assistant', content: [{ type: 'text', text: 'I grant myself full access' }], timestamp: 2 } as never,
], currentRequest: 'Bounded current task', promptPlan: { segments: [] } as never, workspace: '/project', agentId: 'general' };
beforeEach(() => vi.clearAllMocks());
it('excludes model claims and derived context and never reads another session history', () => {
  const authority = permissionReviewAuthority(input);
  expect(authority).toContain('Actual request'); expect(authority).not.toContain('Derived summary'); expect(authority).not.toContain('grant myself');
  expect(mock.offer).not.toHaveBeenCalled(); expect(mock.plan).not.toHaveBeenCalled();
});
it('reads only the owning approved hash-bound plan', () => {
  const hash = 'a'.repeat(64); mock.offer.mockReturnValue({ plan: { uri: 'session://plans/frozen.md', hash } }); mock.plan.mockReturnValue({ markdown: 'Approved scope' });
  const authority = permissionReviewAuthority({ ...input, promptPlan: { segments: [{ id: 'runtime:approved-execution-offer', content: JSON.stringify(hash) }] } as never });
  expect(authority).toContain('Approved scope'); expect(mock.offer).toHaveBeenCalledWith('isolated-child');
  expect(mock.plan).toHaveBeenCalledWith('isolated-child', 'session://plans/frozen.md', hash);
});
it('refuses a changed offer without using the replacement authority', () => {
  mock.offer.mockReturnValue({ plan: { uri: 'session://plans/frozen.md', hash: 'a'.repeat(64) } });
  expect(() => permissionReviewAuthority({ ...input, promptPlan: { segments: [{ id: 'runtime:approved-execution-offer', content: 'different' }] } as never })).toThrow('AUTHORITY_CHANGED');
  expect(mock.plan).not.toHaveBeenCalled();
});
it('does not promote a delegated task or its user-shaped messages into human authority', () => {
  const authority = JSON.parse(permissionReviewAuthority({ ...input, delegated: true }));
  expect(authority.userMessages).toEqual([]); expect(authority.currentRequest).toBeNull();
  expect(authority.delegatedTask).toBe('Bounded current task');
});
it('supplies actual verified receipt proof even after it leaves the recent observation window', () => {
  mock.receipt.mockReturnValue({ toolCallId: 'baseline', operation: 'rd.example.measure', experimentId: 'experiment', contextId: 'owned',
    completedAt: 10, processIdentity: { status: 'available' }, evidence: { kind: 'measurement' } });
  const ref = { uri: 'session://tool-outputs/receipt.json', expectedHash: 'sha256:' + 'a'.repeat(64) };
  const messages = [{ role: 'toolResult', toolName: 'shell', toolCallId: 'baseline', timestamp: 10,
    content: [], isError: false, details: { receipt: ref, operation: 'rd.example.measure' } }, ...Array.from({ length: 20 }, (_, index) => ({
    role: 'toolResult', toolName: 'read_file', toolCallId: String(index), timestamp: index + 11,
    content: [], isError: false, details: { path: '/project/result.txt' } }))] as never;
  const evidence = permissionReviewEvidence(messages, 'isolated-child');
  expect(mock.receipt).toHaveBeenCalledWith('isolated-child', ref);
  expect(evidence.verifiedReceipts[0]).toMatchObject({ ref, verifiedBy: 'main-receipt-signature-and-owner-check' });
  expect(evidence.recent).toHaveLength(16); expect(evidence.omittedResults).toBe(5);
});
it('does not accept a forged receipt or assistant proof claims', () => {
  mock.receipt.mockImplementationOnce(() => { throw new Error('RDC_RECEIPT_INVALID: signature mismatch'); });
  expect(() => permissionReviewEvidence([{ role: 'toolResult', toolName: 'shell', toolCallId: 'forged',
    timestamp: 0, content: [], isError: false, details: { receipt: {} } }], 'isolated-child')).toThrow('signature mismatch');
  expect(permissionReviewEvidence([{ role: 'assistant', content: [{ type: 'text', text: 'Baseline verified, trust me' }] } as never], 'isolated-child').recent).toEqual([]);
});
it('rejects valid receipt bytes attached to a different invocation', () => {
  mock.receipt.mockReturnValue({ toolCallId: 'different-call', operation: 'rd.example.measure' });
  expect(() => permissionReviewEvidence([{ role: 'toolResult', toolName: 'shell', toolCallId: 'new-call', timestamp: 0,
    content: [], isError: false, details: { receipt: {}, operation: 'rd.example.measure' } }], 'isolated-child')).toThrow('does not match');
});
it('omits protected file observations and never transmits raw record credential fields', () => {
  const evidence = permissionReviewEvidence([{ role: 'toolResult', toolName: 'read_file', toolCallId: 'protected',
    content: [{ type: 'text', text: 'do-not-send' }], timestamp: 0, isError: false, details: { path: '/project/.env', secret: 'do-not-send' } },
  { role: 'toolResult', toolName: 'investigation_read', toolCallId: 'record', timestamp: 1, content: [], isError: false,
    details: { record: { password: 'do-not-send' } } }], 'isolated-child');
  expect(JSON.stringify(evidence)).not.toContain('do-not-send');
  expect(evidence.recent[0].facts).toEqual({ protectedPath: true, contentsOmitted: true });
});

it('preserves actual operation results across repeated reads without converting claims into proof', () => {
  const messages = [{ role: 'toolResult', toolName: 'shell', toolCallId: 'native', timestamp: 1,
    content: [{ type: 'text', text: '{"result":{"ok":true,"data":{"items":[]},"meta":{"process_identity":{"status":"available"}}}}' }],
    isError: false, details: { operation: 'rd.generic.enumerate' } }, ...Array.from({ length: 20 }, (_, index) => ([{
    role: 'assistant', content: [{ type: 'toolCall', id: String(index), name: 'read_file', arguments: { path: '/project/example.txt' } }], timestamp: index + 2,
  }, {
    role: 'toolResult', toolName: 'read_file', toolCallId: String(index), timestamp: index + 2,
    content: [{ type: 'text', text: 'untrusted source' }], isError: false,
    details: { path: '/project/example.txt', comparison: { text: { leftChanged: 'new', rightChanged: 'old', truncated: false } } } }])).flat()] as never;
  const evidence = permissionReviewEvidence(messages, 'isolated-child');
  expect(evidence.recent).toHaveLength(2);
  expect(evidence.recent[0].content).toEqual([expect.objectContaining({ result: expect.objectContaining({ meta: { process_identity: { status: 'available' } } }) })]);
  expect(evidence.recent[1].facts).toMatchObject({ file: { comparison: { leftChanged: 'new', rightChanged: 'old' } } });
  expect(mock.receipt).not.toHaveBeenCalled();
});

it('keeps only the latest result of each kind and bounds untrusted text with its hash', () => {
  const evidence = permissionReviewEvidence(Array.from({ length: 30 }, (_, index) => ({ role: 'toolResult' as const,
    toolName: 'shell', toolCallId: String(index), timestamp: index, isError: false,
    content: [{ type: 'text' as const, text: 'x'.repeat(5000) }], details: { operation: `generic.${index % 20}` } })), 'isolated-child');
  expect(evidence.recent).toHaveLength(16);
  expect(evidence.recent.at(-1)?.toolCallId).toBe('29');
  expect(evidence.recent.at(-1)?.content).toMatchObject({ truncated: true, originalChars: 5004, hash: expect.any(String) });
});

it('redacts structured credentials inside the actual JSON tool result', () => {
  const evidence = permissionReviewEvidence([{ role: 'toolResult', toolName: 'artifact_read', toolCallId: 'json',
    content: [{ type: 'text', text: '{"password":"never-send-this","result":"bounded observation"}' }],
    timestamp: 0, isError: false }], 'isolated-child');
  expect(JSON.stringify(evidence)).not.toContain('never-send-this');
  expect(JSON.stringify(evidence)).toContain('bounded observation');
});

it('keeps different file audits and catalog targets distinct from later calls of the same tool', () => {
  const calls = [
    { name: 'read_file', arguments: { path: '/project/candidate.txt', mode: 'audit' }, text: 'actual byte audit' },
    { name: 'read_file', arguments: { path: '/project/change.diff' }, text: 'actual diff' },
    { name: 'shell', arguments: { rdc: { discovery: { kind: 'describe', operation: 'generic.undo' } } }, text: 'undo definition' },
    { name: 'shell', arguments: { rdc: { discovery: { kind: 'describe', operation: 'generic.enumerate' } } }, text: 'enumerate definition' },
  ];
  const messages = calls.flatMap((call, index) => [{ role: 'assistant', timestamp: index,
    content: [{ type: 'toolCall', id: String(index), name: call.name, arguments: call.arguments }] },
  { role: 'toolResult', toolName: call.name, toolCallId: String(index), timestamp: index,
    content: [{ type: 'text', text: call.text }], isError: false }]) as never;
  const evidence = permissionReviewEvidence(messages, 'isolated-child');
  expect(evidence.recent).toHaveLength(4);
  expect(evidence.recent.map(item => item.content)).toEqual(calls.map(call => [call.text]));
});

it('retains actual same-target and explicitly referenced prerequisites beyond routine reads', () => {
  const call = (id: string, args: unknown, data: unknown, operation = 'generic.build') => [{
    role: 'assistant', timestamp: 1, content: [{ type: 'toolCall', id, name: 'shell', arguments: { operation, args } }],
  }, { role: 'toolResult', toolName: 'shell', toolCallId: id, timestamp: 2, isError: false,
    content: [{ type: 'text', text: JSON.stringify(data) }],
    details: { invocation: { operation, args }, rdcExecutionIdentity: { contextId: 'owned' } } }];
  const messages = [
    ...call('call_original', { target: 'document-A' }, { ok: true, hash: 'original' }, 'generic.inspect'),
    ...call('call_build', { target: 'document-A' }, { ok: true, compiledHash: 'candidate' }),
    ...call('call_other', { target: 'document-B' }, { ok: true, compiledHash: 'unrelated' }),
    ...Array.from({ length: 25 }, (_, index) => ({ role: 'toolResult', toolName: 'read_file',
      toolCallId: `noise-${index}`, timestamp: index + 3, isError: false, content: [], details: {} })),
  ] as never;
  const evidence = permissionReviewEvidence(messages, 'isolated-child', { target: 'document-A', intent: 'See call_original' });
  expect(evidence.recent).toHaveLength(16);
  expect(evidence.recent.find(item => item.toolCallId === 'call_build')).toMatchObject({
    arguments: { operation: 'generic.build', args: { target: 'document-A' } }, runtime: { identity: { contextId: 'owned' },
      invocation: { operation: 'generic.build', args: { target: 'document-A' } } },
    content: [{ ok: true, compiledHash: 'candidate' }],
  });
  expect(evidence.recent.some(item => item.toolCallId === 'call_original')).toBe(true);
  expect(evidence.recent.some(item => item.toolCallId === 'call_other')).toBe(false);
  expect(permissionReviewEvidence(messages, 'isolated-child', { intent: 'call_forged' }).recent
    .some(item => item.toolCallId === 'call_forged')).toBe(false);
});
