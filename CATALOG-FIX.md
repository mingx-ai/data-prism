# 云器多 Schema 表目录与映射修复 · 2026-09-07

使用 `outputs/prism-catalog-fix.zip` 累计更新包。停止 Web、JDBC 两个服务，将包内 `prism` 内容合并覆盖到原工程，重启并刷新浏览器，再进入原计划的“表选择与映射”。无需重新编译或重建数据源/计划；包内不含 `.env`、业务数据、历史记录或驱动。完整 Windows 包和旧名更新包同步包含此修复。

## 默认 Schema 留空时报错的原因

连接测试执行 SELECT 1，可以在未指定 Schema 时成功。旧目录查询调用云器驱动的 getTables(workspace, null, ...)，驱动会执行依赖当前 Schema 的 SHOW TABLES，导致 invalid SCHEMA。填默认 Schema 虽能绕过错误，但只会得到该 Schema 的表。

新版先在明确的 Workspace 下枚举可见 Schema，再对每个 Schema 显式读取表和视图。默认 Schema 可以留空；填写默认 Schema 也不限制计划的映射范围。Workspace 若仅写在 JDBC 地址中，则使用驱动解析后的 Workspace。目录读取失败会标明 Workspace 和 Schema，不将权限错误静默当作空目录。

## 映射页

- 已勾选表在筛选后、分页前置顶；取消勾选后回到未选区，原目录顺序在各区内保持稳定。
- 新增“全部基准 Schema”筛选，可按 Schema 或表名搜索。
- 每张目标表可分别选择目标 Schema，列表包含可见目录中的多个 Schema，而非仅数据源默认 Schema。
- 不同 Schema 的同名表分别保留。自动映射优先同 Schema 同名表；没有同 Schema 匹配但存在唯一同名候选时自动选择；多个候选时留空由用户选择，避免随意映射第一张表。

更新后重新进入计划会读取新目录。原有映射保存的基准/目标 Schema 继续生效，后续查询仍使用映射中的完整表名。

验证：52 项 Java 测试、20 项前端/API 核心测试、TypeScript 检查及自托管构建通过。覆盖默认 Schema 空/非空、Workspace 从连接解析、跨 Schema 同名表、具体 Schema 权限失败、已选表排序/分页和模糊映射。已核对包内 ClickZetta JDBC 4.0.0 的元数据 SQL 构造行为；公司真实数据库和 Windows 实机仍需验证。
