/** Old official profile ids remain reserved so they cannot re-enter the current four-profile runtime. */
const RESERVED_TOP_LEVEL_IDS = ['ask', 'plan', 'edit'] as const;
const RESERVED_SPECIALIST_IDS = [
  'ask_agent',
  'rdc-debugger',
  'triage_agent',
  'capture_repro_agent',
  'pass_graph_pipeline_agent',
  'pixel_forensics_agent',
  'shader_ir_agent',
  'driver_device_agent',
  'skeptic_agent',
  'curator_agent',
] as const;

export const RESERVED_AGENT_IDS: ReadonlySet<string> = new Set([
  ...RESERVED_TOP_LEVEL_IDS,
  ...RESERVED_SPECIALIST_IDS.flatMap((id) => [id, id.replaceAll('_', '-'), id.replaceAll('-', '_')]),
]);

export function isReservedAgentId(id: string): boolean {
  return RESERVED_AGENT_IDS.has(id);
}
