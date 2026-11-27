---
name: artifact-provenance
description: Enforce ready provenance and cite investigation artifacts only by id and hash.
---

# Artifact Provenance

写入、升级或引用 `rdc.investigation` 记录时用这份方法：先按依赖顺序持久化，再满足 ready 的三个条件；委派审查时，把审查需要的材料按精确引用交出去。

## 按依赖顺序写

1. 原始工具输出可以先采集。写 Evidence 前，先持久化与实际观察状态相符的 WorldState，Evidence 再绑定它的 `worldStateId`；draft 也一样要能解析。WorldState 可以如实留下未知或未测量的字段，不为凑必填项编造安全性、排他性、读数或零值，也不把新观察挂到无关的旧 WorldState 上。
2. Evidence 先于派生的 Claim，在它的 WorldState 之后。
3. Experiment 引用的 WorldState 和 hypothesis Claim 要先持久化。设计阶段的 variant／restored 锚点写成合法的"未测量"。schema 表示不了某个锚点时，在计划门解决，不写虚构的前向引用或占位回执。计划要求的设计记录要在正式签名阶段之前写成功。
4. 能解析的引用不等于状态等价，也不足以让记录 ready。

## ready 的三个条件

1. `sourceRefs.length >= 1`，每项是 `{ artifactId, expectedHash }`，每个 `artifactId` 都能解析。
2. 每个 `expectedHash` 等于来源当前的 sha256；本记录的 `contentHash` 等于 `contentRef` 字节的 sha256。
3. `kind` 经闭集 Kind Registry 解析到 `recordType + schema`，正文通过该 schema。

用 `session://` 或 `investigation_read`／`investigation_list` 返回的身份引用，不编造 hash。正文变了而 hash 没变的记录是 `stale`。

## 委派审查时交出哪些材料

- 工具结果的 JSON 包装和它引用的图像是不同的制品。视觉审查要把所需图像的精确 URI 放进 Capsule；授予包装不会连带授予图像。独立审查 Task 会由运行时补授被授记录所引用的记录和制品，只需手动授予没有被任何记录引用的叶子材料。
- 审查者要看小段原文或差异时，用 `read_file` 的 `pinEvidence: true` 取回持久的 URI 再授予；它只保存实际返回的窗口。`totalLines` 和整文件 hash 是身份，不证明每一行都已交付，按显示范围、截断和续读覆盖所需的全部页。
- 产出报告或其他文本结果的 Task，审查对象是那份结果本身：钉住并授予它。审查只覆盖被授的那个版本，结果变了就要对新版本再审。
- 成功的 `rdc_probe` 只读查询也返回持久的证据 URI，授予时保留它记录的身份和 `truncated` 状态；它不是签名回执。
- 审查材料要包括可能限制或反驳这条主张的已有观察，不只是支持它的两端。资源值的直接依赖要附上可用的中间 usage 历史及其覆盖范围；给不全就写明缺口。
- 压缩后某条历史原生输出缺了请求参数时，owning 的 General 可以对它的 URI/hash 用 `artifact_read.includeRecordedRequest=true` 取回记录的请求；做覆盖审计时用 `includeRecordedOperationIndex=true` 取回该操作的已提交请求索引。两者都只覆盖已提交的结构化请求，不是签名回执或当前回放证据；审查者需要另行授予，不能自己查询。记录不到的保持不可得，不为补历史重新执行原生操作。
