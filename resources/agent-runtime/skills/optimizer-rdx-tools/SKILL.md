---
name: optimizer-rdx-tools
description: Choose and interpret the bounded RDX operations needed to measure costs, run controlled shader interventions, and verify visual and numeric restoration. General execution only.
---

# Optimizer RDX Tools

本手册由 Optimizer Mission 通过 execute handoff 绑定给 General。先读 `$rdx-cli-shell`，再按实验 Plan 读取 [工具参考](references/tools.md) 的相关条目。它只提供测量和操作知识，不改变工具、会话或路径权限。

## 选择路径

1. 先冻结 capture、事件范围、counter、参数和采样条件；enumerate/describe 后再 sample，event duration 只解释对应事件，不冒充 frame time。
2. 用 pass/action、pipeline sections、resource usage/memory、bindings、buffer/mesh 和 shader reflection 将 Cost / Limiter / Mechanism 分开。estimate 结果是估算，不能代替驱动计数或真实采样。
3. 统计、直方图、纹理 diff 和 image diff 默认内存处理；比较必须使用相同 event、subresource、区域、格式与显示参数。形状不一致、NaN/Inf、infinite PSNR 都按明确状态解释。
4. 需要 shader intervention 时先读 edit plan 和能力，再绑定 experimentId 执行 compile/replace。baseline → intervention → variant → rollback → restored 每段都保存主进程签名回执和配对观察；错误 replacement、回滚失败或恢复测量不一致时实验不能关闭。
5. 只输出能复核收益与质量约束的最小证据。Ablation、近似估算和单次低值都不能直接成为可发布优化结论。

停止时报告已测方法、噪声边界、未测路径和恢复状态。工具列表没有“优化原因”或“安全回滚”快捷答案；这些结论必须由 `$optimization-experiment` 的实验纪律产生。

需要整帧回放测量时使用 `rd.perf.get_frame_timing`。当前 native 只在完整单队列 GPU 时间域已验证时提供该能力；不支持时不得以热点之和替代。结果是 replay GPU span，排除初始状态重建并包含回放调度空隙，不等于原程序实时帧耗时。baseline/variant/restored 必须保持方法、范围、samples、warmup、capture 一致，并核对实际 replacement 集合与主进程签名。逐次样本和噪声都应保留。
