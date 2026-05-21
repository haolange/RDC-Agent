# Reports

证据、报告、artifact 和 session outputs 的领域入口。

当前实现入口包括 `EvidenceLedger`、`ArtifactStore`、`ReportBundleService` 和 `StorageAdapter` 的输出索引逻辑。后续拆分必须保持 report/evidence 与 run/session 的引用关系可追溯。
