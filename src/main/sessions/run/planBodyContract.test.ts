import { describe, expect, it } from 'vitest';
import { splitPlanAppendix } from '@shared/utils/planAppendix';
import { assertReaderFacingPlan, findInternalReferences } from './planBodyContract';
import { composePlanMarkdown, sectionsFromMarkdown } from './sessionPlanArtifact';

// A desensitized plan restored to the previous six-block template, which asked the planner to cite
// dereferenceable URIs and hashes inline.
const previousTemplatePlan = {
  title: '地面阴影条纹的调查计划',
  summary: ['确认条纹来自哪次阴影写入', '区分深度偏移与采样精度两种解释'],
  content: [
    '## 目标与边界',
    '用户目标：说明地面阴影出现条纹的原因。成功标准：可恢复实验确认主因。',
    '## 输入与参考依据',
    '- 锚点 Evidence `invart-0113088f6739-1795001979310`（cross-validated），来源 `session://tool-outputs/call_e2bb2bd081ad47049847df097cd733dc.json`，sha256 `657c8c1a897a4c09790edf25c02ec5bc3ef0b57e3c776567eb2bd2a326bd4627`。',
    '- 历史卡片 `session://investigation/records/claim-7.json` 适用条件未核对。',
    '## 候选方向与选择依据',
    '| 解释 | 预测 | 区分检查 |\n|---|---|---|\n| 深度偏移过小 | 增大偏移后条纹消失 | 修改偏移常量 |\n| 采样精度不足 | 换高精度格式后条纹消失 | 对照读数 |',
    '## 执行策略与依赖',
    '先完成 Task `task_1795001979310_9f3a2b1c`，再委派审查。入口回执 `rdc-lifecycle-8391ac0f-4168-403c-bc10-1ac266f518d3.json`。',
    '## 决策与循环',
    '审查指出缺口时补证；战略失效时保存 Checkpoint。',
    '## 交付与重新对齐',
    '交付结论、证据与未知项。',
  ].join('\n'),
};

// The same plan in the reader-facing template: object names in the body, references in the appendix.
const readerFacingPlan = {
  title: '地面阴影条纹从哪次写入开始、是什么造成的',
  summary: ['确认条纹来自哪次阴影写入', '区分深度偏移与采样精度两种解释'],
  content: [
    '## 要解决的问题',
    '用户原话：地面阴影有条纹。查到可恢复实验确认主因为止。',
    '## 已经知道的',
    '阴影贴图在主光源阴影 pass 写入；地面区域已由两条独立路径对上。',
    '## 打算怎么查',
    '| 解释 | 成立时会看到什么 | 用什么检查区分 |\n|---|---|---|\n| 深度偏移过小 | 增大偏移后条纹消失 | 修改偏移常量 |\n| 采样精度不足 | 换高精度格式后条纹消失 | 对照读数 |',
    '1. 读阴影 pass 前后的同一区域读数。\n2. 读深度偏移常量。\n3. 做偏移常量的可恢复实验。',
    '## 可能需要你参与的地方',
    '需要你批准修改偏移常量的可恢复实验。',
    '## 什么时候停，交付什么',
    '实验确认主因、独立审查通过后交付；两种解释都被排除时停下交回规划。',
    '## Execution references',
    '- 锚点 Evidence `invart-0113088f6739-1795001979310`（cross-validated），来源 `session://tool-outputs/call_e2bb2bd081ad47049847df097cd733dc.json`，sha256 `657c8c1a897a4c09790edf25c02ec5bc3ef0b57e3c776567eb2bd2a326bd4627`。',
    '- 历史卡片 `session://investigation/records/claim-7.json`。',
    '- 前置 Task `task_1795001979310_9f3a2b1c`；入口回执 `rdc-lifecycle-8391ac0f-4168-403c-bc10-1ac266f518d3.json`。',
  ].join('\n'),
};

describe('reader-facing plan body', () => {
  it('rejects a previous-template plan that cites internal references in the body', () => {
    expect(() => assertReaderFacingPlan(previousTemplatePlan)).toThrow(/PLAN_BODY_INTERNAL_REFERENCE/);
    const kinds = new Set(findInternalReferences(previousTemplatePlan.content).map((entry) => entry.kind));
    expect([...kinds].sort()).toEqual(['hash', 'record id', 'session artifact URI', 'task or execution id', 'uuid']);
  });

  it('accepts the rewritten plan and keeps every former body reference in the appendix', () => {
    expect(() => assertReaderFacingPlan(readerFacingPlan)).not.toThrow();
    const markdown = composePlanMarkdown(readerFacingPlan);
    const { body, appendix } = splitPlanAppendix(markdown);
    expect(findInternalReferences(body)).toEqual([]);
    const moved = new Set(findInternalReferences(appendix).map((entry) => entry.value));
    for (const reference of findInternalReferences(previousTemplatePlan.content)) expect(moved).toContain(reference.value);
    expect(sectionsFromMarkdown(markdown).map((section) => section.heading)).toEqual(['要解决的问题', '已经知道的', '打算怎么查', '可能需要你参与的地方', '什么时候停，交付什么']);
  });

  it('requires the execution references to be the planner\'s last section', () => {
    const misplaced = { ...readerFacingPlan, content: `${readerFacingPlan.content}\n## 补充\n还有一项。` };
    expect(() => assertReaderFacingPlan(misplaced)).toThrow(/must be the last section/);
  });
});
