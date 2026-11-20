const path = require('path');
const { compileProviderCatalog } = require('../src/main/provider-catalog/catalogCompiler.ts');
const { loadProviderCatalogManifestInput } = require('../src/main/provider-catalog/manifestLoader.ts');

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
