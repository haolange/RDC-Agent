declare module 'virtual:rdc-provider-catalog-index' {
  const index: import('./catalogCompiler').CompiledProviderCatalogIndex;
  export function loadProviderSurface(id: string): Promise<import('./catalogCompiler').CompiledProviderSurface | null>;
  export default index;
}
