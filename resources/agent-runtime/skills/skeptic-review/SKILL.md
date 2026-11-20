---
name: skeptic-review
description: Challenge Claims from Evidence, Experiments, negatives, and unknowns. Do not rewrite the Generator narrative.
allowed-tools: [subagent_report, turn_complete, artifact_read, investigation_schema, investigation_read, investigation_write, investigation_list, knowledge_browse, knowledge_search, knowledge_read, knowledge_compile]
---

# Skeptic Review

在独立上下文里审查别人写下的主张时用这份方法：读被审记录和获授的原始证据，找出会让结论不成立的缺口写成 Challenge，其余意见作为备注返回。不继承生成方的叙事、Task 列表和回放租约。

## 怎样审

1. 读被引用的 Claim、Evidence、Experiment，以及运行时随之补授的依赖。优先用给定的精确 URI 和 hash，不做大范围搜索。
2. 逐条问：有证据支持吗？范围写对了吗？因果或反事实主张有合格的实验吗（`S-CAUSAL-01`）？
3. 每个发现先分档。判断方法：如果这一项最终证明是另一种情况，结论的措辞要不要改？
   - **阻断**（要改）：缺一项关键证据、有没排除的替代解释、实验有混淆变量、范围被扩大、等级被非法抬高。写一条 Challenge。
   - **备注**（不用改）：结论照样成立，只是某个细节还没证明，或者多一个对照会更好。写进结果的 `unresolved`，`blocker: not_required`，`gap` 写清是什么，`resumeWhen` 写在什么条件下值得补。不写 Challenge。
4. `requiredFollowUp` 写一项具体的区分检查：某个事件、像素区域、干预或缺的制品，不写新叙事。
5. 已经站得住的主张不动。缺证据时要求补证，不自行编一个替代原因；替代解释和未知项保持可见。

## ChallengeRecord

```text
challengeId          stable id
targetRef            { type: claim | evidence | experiment, id }  — id must resolve
challengeKind        contradiction | missing_evidence | alternative | scope | unknown | methodology
statement            the gap, conflict, or illegal upgrade
requiredFollowUp     the single distinguishing check General should turn into a Task
status               open | resolved | wont_fix
resolutionClaimId    required when status == resolved; must resolve to a ClaimRecord
```

这是 `investigation_write` 的 `record` 正文，不是整个写入信封。ready 的 Challenge 在信封里带非空 `sourceRefs: [{ artifactId, expectedHash }]`，取自你实际读过的 `investigation_read`／`investigation_list` 返回的 artifactId 和 contentHash；`targetRef`、`worldStateId` 或 URI 不能代替，也不复制工具输出里的 hash。制品状态 `ready` 和审查状态 `record.status: open` 是两回事。

## 几类主张的审法

- **资源值的直接依赖**：看生产者到消费者区间内的 usage 历史和相关版本或子资源，不只看两端的绑定。注意中间写入和截断、空值、只有绑定的观察。一次写入不证明完整覆盖，没查过的区间也不证明内容没变。
- **`rd.resource.get_usage`**：分类针对的是被查询的资源，不是该事件的输出附件；附件不同不否定记录到的读取，记录到的读取也不证明某个像素的值或一条连续的值依赖。
- **文件与图像**：整文件的字节或差异审计证明修改范围，不证明读懂了；全局主张需要完整的语义覆盖。细节判断先看实际给到的图像字节和区域。
- **多步定量主张**：核对输入、单位、假设和计算方法，用获授的确定性计算或带真实输入与输出的计算记录核验。在只读范围内核不了时，限定精度，并返回需要 General 去取的计算和来源。

## 返回

- 审查完成可以带着 open Challenge 返回：审完不等于主张被接受，也不以父记录已更新为前提。返回覆盖范围、发现和限制。
- General 负责更新父记录，并为每个 open Challenge 建一个 Task（subject 引用 challengeId 和 requiredFollowUp）。审查者不调用 `task_create`，不替换父记录，只写自己的 Challenge。
- 读取被拒，或预算不够覆盖剩余的读取、写入和 `turn_complete` 时，返回 partial 并写明哪一步没做：没写出来的 Challenge 不等于没有问题。可读但还没读元数据的授权内容是剩余步骤，不是缺外部输入。
- 冻结的任务明确要求一项你没有授权的写入时，先指出来，由父级走计划修订；不要悄悄略过。
- `subagent_report` 只用于有意义的进展、阻塞或需要决定的事，不发例行心跳。

不升降 Claim 等级，不写 Knowledge，不写报告。没有合格实验的因果 Claim 不标 ready。Checkpoint 的 `openChallenges` 里的编号必须能解析到这里写的记录。用户没有要求时不调用 `memory_write`。
