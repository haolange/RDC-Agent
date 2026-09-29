# 右栏

`RightRail` 根据项目、会话与 `rightRailTarget` 选择项目导入面或 `SessionRightRail`；调用方直接导入入口。会话面固定为 Progress / Artifacts / Outputs / Context / Capture 五卡，空态与 populated 状态共用卡片外壳，Capture 自带标题和操作区。

数据来自 main-owned `tracePresentation.rightPanel`，各列表不重建运行时状态。Artifact 与 Output 继续保持各自语义；`CapturePanel` 及其 hooks 维护请求 scope、预览对象 URL、回放队列与历史，不把设备进程存在解释成服务成功。

Investigation Artifact 行通过所属 session 和预期 hash 调用 `investigation:read`。Report 的七节预览只投影现有 `InvestigationReport`／`reportContract`，缺失字段诚实标明未记录；原始 JSON 置于次级折叠区，不作为默认阅读面。其它 record 保持原始内容预览。

`RightRail.css` 是唯一样式入口，按 shell、共享行、调查内容、资源、项目 Capture 导入、drawer 顺序加载职责模块。声明顺序保持稳定；`CaptureReplay.css` 与调查预览保留专属样式。改样式需核对空态和有内容状态，不能只验证五个标题。

验证包括 `SessionRightRail.test.ts` 的五卡与混合状态、`useCapturePreviewUrl.test.ts` 的迟到结果与 URL 回收、回放队列和历史测试，以及 `check:right-rail`。真实 Capture 回放与设备呈现仍需独立现场证据。
