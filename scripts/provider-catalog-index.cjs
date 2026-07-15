const path = require('path');
const { compileProviderCatalog } = require('../src/shared/provider-catalog/compiler.ts');
const { loadProviderCatalogManifestInput } = require('../src/shared/provider-catalog/nodeManifestLoader.ts');

const manifestRoot = path.join(
  __dirname,
  '..',
  'src',
  'shared',
  'provider-catalog',
  'manifests',
);
const catalog = compileProviderCatalog(loadProviderCatalogManifestInput(manifestRoot));
const index = catalog.index;

module.exports = index;
module.exports.default = index;
module.exports.loadProviderSurface = async (id) => catalog.surfaces.get(id) ?? null;
