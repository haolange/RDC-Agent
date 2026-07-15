import path from 'node:path';
import type { Plugin } from 'vite';
import { compileProviderCatalog, type CompiledProviderCatalog } from '../../shared/provider-catalog/compiler';
import {
  listProviderCatalogManifestFiles,
  loadProviderCatalogManifestInput,
} from '../../shared/provider-catalog/nodeManifestLoader';

export const PROVIDER_CATALOG_INDEX_MODULE_ID = 'virtual:rdc-provider-catalog-index';
const RESOLVED_PROVIDER_CATALOG_INDEX_MODULE_ID = `\0${PROVIDER_CATALOG_INDEX_MODULE_ID}`;
const PROVIDER_CATALOG_SURFACE_MODULE_PREFIX = 'virtual:rdc-provider-catalog-surface/';

export function providerCatalogVitePlugin(repoRoot: string): Plugin {
  const manifestRoot = path.join(repoRoot, 'src', 'shared', 'provider-catalog', 'manifests');
  let compiled: CompiledProviderCatalog | undefined;
  const compile = (): CompiledProviderCatalog => {
    compiled = compileProviderCatalog(loadProviderCatalogManifestInput(manifestRoot));
    return compiled;
  };
  return {
    name: 'rdc-provider-catalog',
    resolveId(id) {
      if (id === PROVIDER_CATALOG_INDEX_MODULE_ID) return RESOLVED_PROVIDER_CATALOG_INDEX_MODULE_ID;
      if (id.startsWith(PROVIDER_CATALOG_SURFACE_MODULE_PREFIX)) return `\0${id}`;
      return null;
    },
    load(id) {
      const catalog = compiled ?? compile();
      if (id === RESOLVED_PROVIDER_CATALOG_INDEX_MODULE_ID) {
        const loaders = [...catalog.surfaces.keys()].map((surfaceId) => (
          `${JSON.stringify(surfaceId)}:()=>import(${JSON.stringify(`${PROVIDER_CATALOG_SURFACE_MODULE_PREFIX}${encodeURIComponent(surfaceId)}`)}).then((module)=>module.default)`
        )).join(',');
        return [
          `const surfaceLoaders={${loaders}};`,
          'export async function loadProviderSurface(id){const loader=surfaceLoaders[id];return loader?loader():null;}',
          `export default ${JSON.stringify(catalog.index)};`,
        ].join('\n');
      }
      const unresolvedId = id.startsWith('\0') ? id.slice(1) : id;
      if (!unresolvedId.startsWith(PROVIDER_CATALOG_SURFACE_MODULE_PREFIX)) return null;
      const surfaceId = decodeURIComponent(unresolvedId.slice(PROVIDER_CATALOG_SURFACE_MODULE_PREFIX.length));
      const surface = catalog.surfaces.get(surfaceId);
      if (!surface) throw new Error(`Unknown compiled Provider surface: ${surfaceId}`);
      return `export default ${JSON.stringify(surface)};`;
    },
    buildStart() {
      for (const filePath of listProviderCatalogManifestFiles(manifestRoot)) this.addWatchFile(filePath);
      compile();
    },
    generateBundle() {
      const catalog = compiled ?? compile();
      this.emitFile({
        type: 'asset',
        fileName: 'provider-catalog/index.json',
        source: `${JSON.stringify(catalog.index)}\n`,
      });
    },
  };
}
