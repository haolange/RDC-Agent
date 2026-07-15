declare module 'virtual:rdc-provider-catalog-index' {
  const index: import('../provider-catalog/compiler').CompiledProviderCatalogIndex;
  export function loadProviderSurface(
    id: string,
  ): Promise<import('../provider-catalog/compiler').CompiledProviderSurface | null>;
  export default index;
}
