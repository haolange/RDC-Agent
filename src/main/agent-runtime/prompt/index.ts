/**
 * Prompt 子模块统一导出。
 *
 * - {@link PromptSections}：分段定义与默认顺序。
 * - {@link PromptAssembler}：按段落顺序组装 system prompt，含进程内缓存。
 */

export {
  DEFAULT_SECTIONS,
  DEFAULT_STATIC_SECTION_COUNT,
  sectionCapabilities,
  sectionCatalog,
  sectionContext,
  sectionIdentity,
  sectionMemory,
  sectionPermission,
  sectionProfileInstructions,
  sectionRouteCapability,
  sectionRules,
  sectionTools,
  sectionWorkspace,
} from './PromptSections';
export type { PromptContext, PromptSection } from './PromptSections';

export { DYNAMIC_BOUNDARY, PromptAssembler } from './PromptAssembler';
export type { PromptAssemblerOptions } from './PromptAssembler';
