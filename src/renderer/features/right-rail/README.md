# 右栏

`RightRail` 根据项目、会话与 `rightRailTarget` 选择项目导入面或 `SessionRightRail`；调用方直接导入入口。会话面固定为 Progress / Artifacts / Outputs / Context / Capture 五卡，空态与 populated 状态共用卡片外壳，Capture 自带标题和操作区。

数据来自 main-owned `tracePresentation.rightPanel`，各列表不重建运行时状态。Artifact 与 Output 继续保持各自语义；`CapturePanel` 及其 hooks 维护请求 scope、当前预览对象 URL 与回放队列，不把设备进程存在解释成服务成功。

Investigation Artifact 行通过所属 session 和预期 hash 调用 `investigation:read`。Report 的七节预览只投影现有 `InvestigationReport`／`reportContract`，缺失字段诚实标明未记录；原始 JSON 置于次级折叠区，不作为默认阅读面。其它 record 保持原始内容预览。

`RightRail.css` 是唯一样式入口，按 shell、共享行、调查内容、资源、项目 Capture 导入、drawer 顺序加载职责模块。声明顺序保持稳定；`CaptureReplay.css` 与调查预览保留专属样式。改样式需核对空态和有内容状态，不能只验证五个标题。

`CaptureWorkspace` 拥有唯一当前画面，组合始终存在的 `CaptureReplayControls`；人工和 Agent 共用同一实际 EID 轨道与主进程状态。interactionLock 仅禁用人工操作，不切换图片来源或控件版本。后台操作证据存档保留，不提供独立历史浏览 UI。Progress 不另设会话级 Stop。

验证包括五卡与混合状态、`CaptureWorkspace.test.ts` 的接管/解锁/控件身份与实际 EID 操作、`useCapturePreview.test.ts` 的同 EID 刷新/重试/迟到隔离及 URL 回收，以及 `check:right-rail`。真实模型接管与设备呈现证据分别记录。
