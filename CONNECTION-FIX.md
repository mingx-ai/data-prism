# 连接与校验累计修复 · 更新于 2026-09-07

## 最新版：表级结构参考与排序勾选

使用 `outputs/prism-strategy-fix.zip`，参见 [表级策略增强说明](STRATEGY-FIX.md)。新增两侧表结构参考、筛选字段插入、排序字段多选与逐项升降序/优先级调整。所有历史修复累计包含。

## 最新版：云器多 Schema 目录

使用 `outputs/prism-catalog-fix.zip`，参见 [目录与映射修复](CATALOG-FIX.md)。修复默认 Schema 留空时读取表目录失败，并支持跨多个 Schema 映射和已选表置顶。下列历史修复全部累计包含。

## 最新版：报告展示与统计口径

使用 `outputs/prism-report-fix.zip`，详见 [报告修复说明](REPORT-FIX.md)。新增基准/目标两行成组的数据差异明细，仅高亮差异单元格；不适用的 scale 驱动值改为“元数据说明”，不再统计成“已忽略差异”。重新执行计划后生成完整差异行和新统计口径。以下旧版功能全部累计包含。

## 对比修复（第三版，累计包含前两版）

已有 Windows 安装使用 `outputs/prism-comparison-fix.zip`。停止 Web 和 JDBC 服务，将包内 `prism` 的内容合并覆盖到原工程后重启，刷新浏览器。包内已编译，不需要重新下载依赖或编译；不包含 `.env`、业务数据、历史记录或驱动。旧名 `prism-execution-fix.zip`、`prism-connection-fix.zip` 及完整 Windows 包也同步为本版。

### 按 SQL 排序后逐条比较

在“编辑测试计划 → 统一校验策略 → 数据对齐方式”选择 **按排序位置逐条对比**。每侧查询结果的第 1 行与第 1 行、第 2 行与第 2 行对应比较；不检查业务唯一键，允许重复记录和 NULL，也不对记录去重。支持抽样及全量，差异和忽略明细使用“第 N 行”定位。若某张表开启了独立策略，请在该表的策略中切换。保存后重新执行原计划即可。

新建计划默认按排序位置比较；已有计划保持原来的按键模式，需手动切换一次。无需给已有业务表增加唯一键。普通自动 SQL 可继续按 `ts` 排序；自定义 SQL 的筛选和排序由 SQL 自身决定，抽样与全量都必须在最外层写 `ORDER BY`，窗口函数或子查询内部的排序不能代替最终结果排序。

排序位置比较依赖两边的结果顺序。相同 `ts` 下不同内容的记录可能交换顺序，出现错位差异；可加入两边共同的其他排序字段，并保持相同的 NULL 排序规则。完全相同的重复记录不要求人为区分，但重复次数仍会比较。排序值相同不保证返回顺序稳定，参见 [MySQL 排序与 LIMIT 说明](https://dev.mysql.com/doc/refman/8.4/en/limit-optimization.html)。

原来的 **按唯一键对齐** 仍可选择：此模式要求两侧查询结果中的键非空且唯一，组合键用英文逗号分隔。留空时沿用排序字段；显式填写的键缺失时不再自动替换为备用排序字段。错误会区分结果缺字段、NULL 和重复，标注出错侧、表名、实际键及查询结果行号。

### 结构和行数兼容

- **STRING / BIGINT 的 scale 0/1**：核对包内 ClickZetta JDBC 4.0.0 驱动后，确认其 `getColumns()` 对非 DECIMAL 类型固定返回 `DECIMAL_DIGITS=1`。对于 STRING、BIGINT 等无声明小数位的类型不再据此报告结构不一致。最新版中原始 0/1 保留在证据和“元数据说明”中，不计入已忽略差异；DECIMAL 的真实 precision / scale 差异仍会校验，无需打开“忽略精度差异”。
- **MaxCompute COUNT 的 Long → BigDecimal 错误**：改为读取数值文本并精确解析，避免驱动不支持的直接类型转换。保留非负整数、一行一列的检查，不经过浮点数；超过 JavaScript 安全整数乃至 Long 上限的整数仍精确保留。

本版验证：47 项 Java 测试、13 项前端/API 核心测试、TypeScript 检查及自托管构建通过。覆盖重复/NULL 排序值、完全重复记录、顺序错位、单侧/双侧空结果、尾部多行、自定义 SQL 最外层排序、超过 10000 行全量及原始证据/忽略审计；公司真实数据库和 Windows 实机仍需重新执行验证。

## 执行兼容修复（第二版，包含第一版修复）

已有安装请使用 `outputs/prism-execution-fix.zip`，按下面相同的停止、合并覆盖和重启步骤更新。`prism-connection-fix.zip` 和完整 Windows 迁移包也同步更新为本版。

- **云器 Virtual Cluster**：编辑云器数据源，在新增的“Virtual Cluster（计算组）”字段填写真实存在且账号可使用的计算组，保存后重新执行计划。也可在 JDBC 地址中使用 `?virtualCluster=实际计算组`（已有参数时使用 `&`）。URL 和字段都填时必须一致；没有显式配置则沿用账号默认值，不假设存在 `default` 计算组。计算组未指定、不存在或不可用都可能导致查询失败。
- **表结构 SQLFeatureNotSupportedException**：兼容 MaxCompute 驱动不支持的 `getSearchStringEscape()`。字段元数据接口不受支持时，使用 `SELECT * FROM 表 WHERE 1 = 0` 获取结构，并记录回退轨迹。权限、网络等其他错误仍会报告失败。
- **MaxCompute 两层模型**：空 Schema 和旧表单预填的 `default` 默认使用两层模式，不再触发三层模式的 `SHOW SCHEMAS`。真实三层连接可在 URL 中显式指定 `odpsNamespaceSchema=true`；自定义 Schema 仍使用三层模式。两层连接不要在 URL 内携带 `schema=`。这只调整 JDBC 连接行为，不修改项目或租户设置。

重新执行已有计划即可，不需要为了计算组配置重建计划；历史失败报告保留，新执行生成新报告。更新包不含业务数据和密钥。验证包括 36 项 Java 测试、真实驱动参数解析及 JDBC 元数据不受支持时的回退测试；公司数据库仍需重测。

Virtual Cluster 参数参考：[云器计算集群使用说明](https://yunqi.tech/documents/working_with_Vclusters)。

本次修复应用侧未将独立项目 / Workspace 字段用于 JDBC 连接的问题。无需创建 MaxCompute Schema，也无需修改公司数据库或网络设置。

## 更新已有 Windows 工程

1. 在 Web、JDBC 两个服务窗口分别按 `Ctrl+C`，确认服务已停止。更新前保留旧工程副本便于恢复。
2. 解压 `outputs/prism-connection-fix.zip`，将里面的 `prism` 文件夹中的内容复制到原工程根目录，合并目录并覆盖同名文件。包内有新的 Java 引擎、前端 / API 构建产物、相关源码和说明，不需要在公司电脑重新编译。
3. 更新包不包含 `.env`、`data/web/`、`jdbc-runner/data/` 或驱动目录，原有账号密钥、数据源、计划、历史数据和驱动会保留。不要删除整个旧工程后只放入这个增量包。
4. 双击原工程中的 `start-windows.cmd`，刷新浏览器，然后编辑已有数据源并重新测试连通性。

如从头迁移，使用同步更新后的 `outputs/prism-windows-bundle.zip` 完整包；只修复已有安装则使用约 9 MiB 的增量包。

## MaxCompute

- 端点示例：`jdbc:odps:https://service.example/api`
- MaxCompute 项目名：填写真实 Project，例如 `analytics_project`。这不是 DataWorks 工作空间名。
- 默认 Schema：项目没有启用 Schema 时留空。

引擎会将独立项目名作为驱动属性 `project_name` 传入。也可以使用完整地址 `jdbc:odps:https://service.example/api?project=analytics_project`，此时独立项目名可留空；两处都填时必须一致，避免连错项目。

`No default project specified.` 表示驱动没有收到默认 Project，不能通过新建或填写 Schema 解决。旧版本的临时处理方法是直接在 JDBC URL 中补上 `project=`。地址已有其他参数时使用 `&project=`。

此外，旧模式的 MaxCompute JDBC 元数据会将 Project 放在 `TABLE_SCHEM`。本次已兼容这种返回值，按 `project.table` 查询；启用 Schema 的连接仍按 `project.schema.table` 查询。

参考：[MaxCompute JDBC 参数](https://www.alibabacloud.com/help/en/maxcompute/user-guide/usage-notes-2)、[Schema 语义](https://www.alibabacloud.com/help/en/maxcompute/user-guide/schema-related-operations)。

## 云器 Lakehouse

按公司控制台给出的 JDBC 服务地址配置，保留实例名、域名、端口和 `/api` 等接口前缀。例如：

```text
jdbc:clickzetta://instance.company.example/api/analytics_workspace
```

也可以保留到 `.../api`，在独立“云器 Workspace”字段填写 `analytics_workspace`，由平台补全。原地址止于 `/api` 时，4.0.0 驱动会将 `api` 当作 Workspace；补全后才按 `/api/Workspace` 分别解析接口前缀和 Workspace。

若需要指定计算组，按实际名称添加 `?virtualCluster=实际计算组`；不要凭空假设存在名为 `default` 的计算组。默认 Schema 可留空；填写时应为实际存在的 Schema。若 URL 已包含 `schema=`，以 URL 为准。

账号和密码始终在独立字段填写，更新时不会拼进 JDBC URL。

`Expected BEGIN_OBJECT but was STRING` 表示云器驱动解析内容时没有得到预期的 JSON 对象。修复地址后如仍出现，需要在公司环境检查：

1. 地址是否是控制台提供的 JDBC / API 服务入口，是否保留了正确的实例、服务域名和接口前缀。
2. 同一公司电脑上的 DBeaver 使用相同 JDBC 地址、账号和 4.0.0 驱动是否能连接。
3. 根据服务端 / 公司网关日志确认 HTTP 状态码、Content-Type，以及是否返回了认证页、代理提示或非预期的字符串响应。不要在排查记录中粘贴账号密钥。

新版会同时显示异常发生在“建立 JDBC 连接”还是“执行 SELECT 1”阶段。仅凭 JSON 解析错误，不能断言数据库不可达或某一种网络设备拦截。

参考：[云器 DBeaver 配置](https://www.yunqi.tech/documents/eco_integration/dbeaver-lakehouse)。

## 验证范围

本次已通过服务器版构建、TypeScript 检查和 32 项 Java 测试；其中两项直接调用迁移包内真实驱动的配置解析器，验证 Project / Workspace / Schema / 凭据传递，不发出数据库请求。仍需在公司 Windows 电脑重新测试两个真实连接，再验证表目录和小范围查询。
