import { describe, expect, it } from 'vitest';
import path from 'node:path';
import { existsSync } from 'node:fs';
import { compileProviderCatalog, dedicatedToolCallingFactSourceIds } from './compiler';
import { loadProviderCatalogManifestInput } from './nodeManifestLoader';
import {
  PROVIDER_ADAPTER_IMPLEMENTATIONS,
  providerAdapterIdForProtocol,
} from './implementationRegistry';
import {
  PROTOCOL_WIRE_FIXTURE_COVERAGE,
} from './protocolWireFixtureCoverage';
import {
  hasImplementedStructuredToolAdapter,
  isAgentToolExecutableModel,
} from '../utils/agentToolCapability';
import type { LlmProviderProtocol } from '../types/settings';

const manifestRoot = path.resolve(process.cwd(), 'src/shared/provider-catalog/manifests');
const fixtureRoot = path.resolve(process.cwd(), 'src/main/agent-runtime/providers/__fixtures__');

describe('Agent tool-calling catalog audit', () => {
  const catalog = compileProviderCatalog(loadProviderCatalogManifestInput(manifestRoot));

  it('never marks toolCalling supported without an implemented structured-tool adapter', () => {
    const violations: string[] = [];
    for (const compiled of catalog.surfaces.values()) {
      for (const model of compiled.surface.models) {
        if (model.toolCalling.state !== 'supported') continue;
        if (!hasImplementedStructuredToolAdapter(model.route.protocol)) {
          violations.push(`${compiled.surface.id}/${model.modelId} protocol ${model.route.protocol}`);
        }
      }
    }
    expect(violations).toEqual([]);
  });

  it('keeps primary executable eligibility on source-backed supported routes only', () => {
    const illegalExecutable: string[] = [];
    for (const compiled of catalog.surfaces.values()) {
      for (const model of compiled.surface.models) {
        const executable = isAgentToolExecutableModel({
          enabled: model.enabled !== false,
          availability: model.availability === 'unavailable' ? 'unavailable' : 'available',
          selection: model.selection,
          toolCalling: model.toolCalling,
          route: model.route,
        });
        if (executable && model.toolCalling.state !== 'supported') {
          illegalExecutable.push(`${compiled.surface.id}/${model.modelId}`);
        }
        if (model.selection.pickerVisibility === 'primary' && model.toolCalling.state === 'unknown') {
          expect(executable).toBe(false);
        }
      }
    }
    expect(illegalExecutable).toEqual([]);
  });

  it('binds supported models to a dedicated tools fact source when the surface declares one', () => {
    const missing: string[] = [];
    for (const compiled of catalog.surfaces.values()) {
      const dedicated = dedicatedToolCallingFactSourceIds(compiled.surface);
      if (dedicated.length === 0) continue;
      for (const model of compiled.surface.models) {
        if (model.toolCalling.state !== 'supported') continue;
        const bound = model.fieldFactSourceIds?.toolCalling;
        if (!bound || !dedicated.includes(bound)) {
          missing.push(`${compiled.surface.id}/${model.modelId}`);
        }
      }
    }
    expect(missing).toEqual([]);
  });

  it('covers every registered adapter protocol in the structured-tool gate', () => {
    for (const adapter of Object.values(PROVIDER_ADAPTER_IMPLEMENTATIONS)) {
      for (const protocol of adapter.protocols) {
        expect(hasImplementedStructuredToolAdapter(protocol)).toBe(true);
      }
    }
  });

  it('binds supported toolCalling only to protocols with a wire fixture', () => {
    const missing: string[] = [];
    for (const compiled of catalog.surfaces.values()) {
      for (const model of compiled.surface.models) {
        if (model.toolCalling.state !== 'supported') continue;
        const protocol = model.route.protocol as LlmProviderProtocol;
        const coverage = PROTOCOL_WIRE_FIXTURE_COVERAGE[protocol];
        if (!coverage) {
          missing.push(`${compiled.surface.id}/${model.modelId} protocol ${protocol} has no fixture mapping`);
          continue;
        }
        const streamFile = coverage.transport === 'jsonl' ? 'stream.jsonl' : 'stream.sse';
        if (!existsSync(path.join(fixtureRoot, coverage.dir, streamFile))) {
          missing.push(`${compiled.surface.id}/${model.modelId} missing ${coverage.dir}/${streamFile}`);
        }
        if (!existsSync(path.join(fixtureRoot, coverage.dir, 'expected.md'))) {
          missing.push(`${compiled.surface.id}/${model.modelId} missing ${coverage.dir}/expected.md`);
        }
      }
    }
    expect(missing).toEqual([]);
  });

  it('never treats embedding-named models as Agent-executable picker models', () => {
    expect(catalog).not.toHaveProperty('embeddings');
    for (const compiled of catalog.surfaces.values()) {
      for (const model of compiled.surface.models) {
        expect(isAgentToolExecutableModel({
          enabled: model.enabled !== false,
          availability: model.availability === 'unavailable' ? 'unavailable' : 'available',
          selection: model.selection,
          toolCalling: model.toolCalling,
          route: model.route,
        }) && model.modelId.includes('embedding')).toBe(false);
      }
    }
  });

  it('covers every registered adapter protocol in the wire-fixture matrix', () => {
    for (const adapter of Object.values(PROVIDER_ADAPTER_IMPLEMENTATIONS)) {
      for (const protocol of adapter.protocols) {
        const coverage = PROTOCOL_WIRE_FIXTURE_COVERAGE[protocol];
        expect(coverage, protocol).toBeDefined();
        expect(coverage.adapterId).toBe(providerAdapterIdForProtocol(protocol));
      }
    }
  });
});
