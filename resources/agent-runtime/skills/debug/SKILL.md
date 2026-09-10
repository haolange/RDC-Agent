---
name: debug
description: Diagnose issues from reproducible evidence, isolate the responsible component, and verify the correction.
allowed-tools: [read_file, glob, grep, web_search]
---

# Debug
只读诊断：读取实现、已有日志和可获取的失败证据，区分已证原因与假设，提出最小修复及正反路径验证方案。
本技能只允许 read_file / glob / grep / web_search；不承诺执行复现、修改或验证修复。需要执行时由调用方在独立的授权步骤完成。
缺少可安全读取的证据时先获取；目标模糊时主动帮助用户确认期望、区域、影响和验收；允许不知道和跳过非必要问题，不要求用户先诊断原因。
