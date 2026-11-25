# Prism 数据校验平台

一个可以部署到自有服务器的数据质量工作台。前端为 React / TypeScript，平台 API 使用 Node.js 与 SQLite，JDBC 执行引擎使用 Java 17。数据源凭据在服务端使用 AES-GCM 加密保存。

## 已实现

- 云器 Lakehouse、阿里云 MaxCompute、MySQL JDBC 数据源配置、编辑、连接验证与真实元数据读取。
- 一个计划内配置多组基准 / 目标数据源；选择基准表，按 10 / 20 / 50 条分页，全选当前页或整个搜索结果。
- 基准表与目标表左右映射，目标 Schema 可切换，支持非同名表。
- 表结构、总行数、数据三种校验；指定行数默认 100、上限 10000；全量模式使用 JDBC 流式读取和磁盘临时表对齐。
- 统一筛选、备用筛选、排序、备用排序；支持按排序位置逐条比较或按唯一键对齐，表级独立策略优先。
- 每种校验的基准 / 目标 SQL 可以分别配置；`${变量}` 支持字符串、数值和标识符。字符串和数值用 PreparedStatement 绑定。
- 精度误差、精度属性忽略、多项特殊空值等价规则；规则可使用变量。
- 复制计划、修改参数、执行、暂停 / 恢复、取消、删除；实时展示当前表、完成张数、百分比和各维度结果。
- 每次执行冻结计划与参数快照。后续编辑或删除计划不会改变历史报告。
- 可视化报告与 HTML / JSON 下载，包含执行 SQL、绑定参数、结果样本、差异明细和生效规则。
- **被忽略的差异也保留证据**：对齐键、字段、两侧原始值、规则、解析后的阈值、精确误差。最终通过仍标记“忽略 N 处”。
- 忽略差异逐条写入完整 NDJSON 审计文件，支持分页查看及全量下载。页面 / JSON 报告内嵌前 1000 条，完整审计不受此限制。审计写入失败会令校验报错，不能显示通过。

内置演示数据和“精度与空值容忍 · 审计示例”。演示连接始终有标记，不会表示你的真实数据源连接成功。

## 本地运行

**公司 Windows 电脑迁移**：见 [Windows 运行与联调说明](WINDOWS.md)。可使用包含源码、构建产物和 JDBC 驱动的 `outputs/prism-windows-bundle.zip`，安装 Node.js / Java 后双击 `start-windows.cmd`；也可在 Windows 从源码构建。

需要 Node.js 22.13+、Java 17+、Maven 3.9+。

```bash
npm ci
node scripts/configure.mjs
bash scripts/install-drivers.sh
npm run build:selfhost
mvn -f jdbc-runner/pom.xml package
```

分别在两个终端运行：

```bash
npm run start:runner
```

```bash
npm run start:selfhost
```

访问 <http://127.0.0.1:3001>。如果 `.env` 配置了 `PRISM_ADMIN_PASSWORD`，浏览器会弹出登录框，默认用户名为 `admin`，密码见该变量。

当前环境也可通过 `npm run dev` 运行带热更新的开发工作台；它使用 `.dev.vars` 和独立的本地 D1 数据，不与服务器版的 SQLite 文件混用。如第一次开发运行缺少数据库表：

```bash
npx wrangler d1 execute site-creator-d1 --local --config wrangler.local.jsonc --file drizzle/0000_silly_sentry.sql --persist-to .wrangler/state
```

## 部署到自己的服务器

1. 将项目复制到服务器，安装 Docker Engine 和 Compose，先执行 `node scripts/configure.mjs` 生成 `.env`。已有 `.env` 时保留原有密钥，仅补充缺失的管理员密码。
2. 安装驱动：`bash scripts/install-drivers.sh`。也可以把已经下载好的两个驱动 JAR 放入 `jdbc-runner/drivers/`。
3. 执行：

```bash
docker compose up -d --build
```

4. 使用你的 HTTPS 反向代理转发到服务器 `127.0.0.1:3000`。保留原始 Host 请求头。默认不向公网暴露 Java 网关；Compose 内部服务使用共享令牌通信。
5. 用 `.env` 中的管理员账号登录工作台，在“数据源”填写真实连接信息，点击“验证连通性”。

`web-data` 保存平台 SQLite 数据，`runner-data` 保存执行结果与完整忽略差异审计文件。备份时同时备份这两个数据卷以及 `.env` 中的 `SOURCE_KEY`。密钥丢失后无法解密已保存的凭据。不要把 `.env`、`.dev.vars` 或数据卷加入代码仓库。

部署文件：根目录 `Dockerfile`、`compose.yaml`、`jdbc-runner/Dockerfile`。本次已构建原生 Node 与 Java 产物；当前电脑的 Docker daemon 未运行，容器实际启动还需在服务器验证。

## 数据源参数

| 数据源 | 驱动类 | JDBC 地址示例 |
| --- | --- | --- |
| MaxCompute | `com.aliyun.odps.jdbc.OdpsDriver` | `jdbc:odps:https://service.cn-hangzhou.maxcompute.aliyun.com/api?project=your_project&enableLimit=false` |
| 云器 Lakehouse | `com.clickzetta.client.jdbc.ClickZettaDriver` | `jdbc:clickzetta://your_instance.cn-shanghai-alicloud.api.clickzetta.com/your_workspace?virtualCluster=default` |
| MySQL | `com.mysql.cj.jdbc.Driver` | `jdbc:mysql://host:3306/database?useCursorFetch=true&useSSL=true` |

用户名 / AccessKey ID、密码 / AccessKey Secret 在单独字段填写，URL 内不接受密码。

**项目与 Workspace 会用于实际连接**：MaxCompute 可以只填写 `jdbc:odps:https://服务地址/api`，再在独立的“MaxCompute 项目名”字段填写项目；引擎会传入驱动要求的 `project_name`。URL 已有 `project=` 时可省略独立字段；同时填写时必须一致。默认 Schema 可留空，不能代替项目名。

云器支持 `jdbc:clickzetta://实例.服务域名/Workspace` 和 `jdbc:clickzetta://实例.服务域名/api/Workspace`。若只填写域名或 `/api`，引擎会使用独立的“云器 Workspace”补全路径。请保留公司控制台给出的实例、域名、端口和接口前缀。Schema 可选；地址内已有 Schema 时优先使用地址内的值。Virtual Cluster 按实际环境通过 URL 的 `virtualCluster=` 参数指定。

已有 Windows 安装的更新步骤见 [连接配置修复说明](CONNECTION-FIX.md)。

执行兼容修复：云器数据源提供独立的 Virtual Cluster（计算组）字段，参数会用于连接测试和实际校验；MaxCompute 的空 Schema / 旧 `default` 字段默认使用两层模式；兼容 JDBC 不支持搜索模式转义或字段元数据的情况。使用累计更新包 `outputs/prism-execution-fix.zip`，步骤见上述说明。

已配置驱动版本：MySQL Connector/J 9.2.0（打包在服务内）、云器 JDBC 4.0.0、MaxCompute JDBC 3.8.6（使用官方带依赖的 JAR）。云器和 MaxCompute JAR 放在 `jdbc-runner/drivers`，不提交到源码仓库。

参考：[云器 JDBC 连接说明](https://www.yunqi.tech/documents/ecosystem-all)、[云器驱动类名](https://www.yunqi.tech/documents/concepts)、[MaxCompute JDBC 使用说明](https://www.alibabacloud.com/help/en/maxcompute/user-guide/usage-notes-2)、[MaxCompute 下载限制](https://www.alibabacloud.com/help/en/maxcompute/user-guide/faq-about-jdbc)、[MySQL Connector/J](https://dev.mysql.com/doc/connector-j/en/)。

MaxCompute 全量读取需要相应的下载权限，并解除驱动的下载行数限制。引擎会将全量读取行数与 COUNT(*) 交叉检查，读取不完整时标记错误。当前尚未使用你的真实账号完成三种外部数据源的联调。

## 策略与审计约定

### 生效顺序

1. 开启表级策略时，整张表使用表级策略的完整配置。
2. 未开启时，使用计划统一策略。
3. 每个维度如配置自定义 SQL，则该侧自定义 SQL 优先，不再自动追加统一筛选或排序。全量指读取该 SQL 的完整结果，自定义 LIMIT 仍然生效。
4. 主筛选发生字段缺失错误时才尝试备用筛选；其他 SQL 错误会直接报告。
5. 主排序字段不可用时，按备用字段列表顺序选择两边共同存在的字段。

### 数据对齐

新建计划默认**按排序位置逐条对比**：按 SQL 返回顺序，第 N 行与第 N 行对应比较，无需业务唯一键，允许重复和 NULL，保留重复记录次数。抽样、全量均支持。相同排序值下的不同记录可能交换顺序，需用补充排序字段和一致的 NULL 排序规则稳定两边顺序；自定义 SQL 必须在最外层包含 ORDER BY。

也可选择**按唯一键对齐**：先按排序选取查询范围，再在磁盘中按业务唯一键或复合键匹配。仅此模式会检查键缺失、NULL 和重复。键留空时沿用排序字段，显式键缺失不会被备用排序替换。旧计划默认保持按键模式，已有计划可在统一策略或独立表级策略切换；历史执行快照不会改变。

全量读取不限制在 10000 行；SQLite / H2 文件和完整审计需要足够磁盘空间。每个任务顺序处理表，执行服务默认并发两个任务。暂停在当前表结束后生效，取消在查询返回 / 结果读取检查点生效，正在阻塞的数据库查询可能需要等待超时。

### 精度与特殊内容

- 数值内容采用 `BigDecimal` 计算绝对误差，支持大整数和精确阈值，不使用 JavaScript 浮点数比较生产数据。
- 结构精度忽略只应用于数值类型的 precision / scale 属性，不会掩盖缺列、类型或可空性变化。
- 特殊内容列表中的值彼此之间以及与真正的 NULL 视为等价。例如 `\N` 与 NULL 可接受，但 `\N` 与普通业务字符串不会被忽略。
- 报告中显示字符串的 JSON 表示，例如 `"\\N"`，以区别真正的 NULL、空串和字符串 `"NULL"`。
- 忽略差异审计记录规则与解析后的参数。例：原值 `1.234567`、目标 `1.2345`、绝对差 `0.000067`、允许阈值 `0.0001`，结果为通过但保留该差异。
- 旧版本只保留数量的历史记录不会伪造补全证据；页面会提示缺少历史审计，重新执行后生成完整明细。

### 自定义 SQL

只允许单条 SELECT / WITH 查询，不支持分号、多语句、DDL、DML 或可执行块注释。执行账号仍应使用数据库侧只读权限。

```sql
SELECT * FROM ${table}
WHERE dt = ${biz_date}
ORDER BY id
LIMIT ${limit}
```

值变量不要额外加引号。`${table}` 为已引用的完整表名，`${schema}` 为已引用的 Schema，`${limit}` 为验证后的整数。`identifier` 类型变量只允许字母、数字和下划线。

MaxCompute 会读取 JDBC 驱动实际使用的 schema 命名空间开关：关闭时使用 `project.table`，开启时使用 `project.schema.table`，避免将默认 schema 误当成项目名。[MaxCompute schema 语义](https://www.alibabacloud.com/help/en/maxcompute/user-guide/schema-related-operations)。

结构自定义 SQL 返回 `name, type, nullable, precision, scale`。行数自定义 SQL 返回一个非负整数（一行一列）。抽样自定义 SQL 显式包含稳定 ORDER BY，且返回行数不超过计划限制，否则报错。

### 结果保存

SQL 详情保留完整查询轨迹，包含元数据探测、实际 SQL、参数和全量 COUNT(*) 核对；失败查询也记录尝试步骤。

报告保留每侧前 100 条原始查询结果、前 1000 条未忽略差异与前 1000 条忽略差异；**完整忽略差异另存逐行审计文件，可在表详情下载全部**。统计覆盖完整比对范围。原始数据全量导出不是报告样本下载。

计划快照冻结配置，并不意味着三个不同数据库具有同一个事务快照。建议比较固定业务分区或停止变动的表；全量比对会检查 COUNT(*) 与实际返回行数是否一致。执行服务重启后，未完成任务标记为中断错误，完整历史记录保留；使用原计划重新执行。

## 验证

```bash
npm run test:core          # 不监听端口的 API、审计、精度与导出测试
npm run test:app           # 完整 HTTP 鉴权 / 重启持久化集成测试
mvn -f jdbc-runner/pom.xml test
npx tsc --noEmit
npm run build:selfhost
```

JDBC 集成测试使用真实 H2 JDBC 连接，覆盖三维度、10053 行全量读取、精确误差、特殊空值、缺失字段回退、变量安全、暂停恢复、1500 条完整忽略审计以及审计写入失败不能通过。

页面包含可选 WebMCP 读取计划与打开报告工具，浏览器不支持时不会影响使用。本次未进行浏览器自动化或 WebMCP 运行时验证。

交付验证：TypeScript 检查、服务器版前端 / API 构建与 Java 打包已通过；核心 API / 导出测试 12 项、H2 JDBC 引擎测试 21 项通过。Docker Compose 配置通过语法检查。

2026-09-06 Windows 迁移准备：已修复 Java 启动脚本的跨平台 classpath、Windows 换行配置读取和工作目录处理，新增 Windows 启动 / 驱动安装脚本及迁移说明。服务器版构建、Java 全新打包通过；`npm run test:app` 的 20 项测试（含核心测试、HTTP 鉴权与重启持久化）和 21 项 H2 JDBC 引擎测试在 macOS 通过。Windows 实机启动以及三种真实数据库的网络、权限和功能仍需在公司电脑联调。

2026-09-06 连接配置修复：修复独立项目 / Workspace 未用于连接、MaxCompute 两层命名空间的 Project 被误当 Schema 的问题，并说明云器非预期 JSON 响应发生的连接测试阶段。新增 11 项连接配置回归测试，其中两项使用包内真实 MaxCompute 3.8.6 / 云器 4.0.0 驱动解析器，无需连接外部数据库；完整 Java 测试共 32 项通过。实际公司网络仍需重测。

2026-09-06 对比修复：新增排序位置逐条比较；修复 STRING/BIGINT scale 0/1 误报及 MaxCompute COUNT 的 Long 转 BigDecimal 异常。累计包 `outputs/prism-comparison-fix.zip` 已编译可直接覆盖，详见 [更新说明](CONNECTION-FIX.md)。47 项 Java 测试、13 项核心测试、TypeScript 检查和自托管构建通过，公司实机待联调。

2026-09-07 报告修复：数据差异按基准/目标两行成组，仅高亮差异单元格，支持字段搜索、分页和长内容全文查看；保存前 100 组完整差异行，HTML 导出同步。非适用 scale 驱动值单列元数据说明，不再混入策略忽略。使用累计包 `outputs/prism-report-fix.zip`，参见 [更新说明](REPORT-FIX.md)。50 项 Java 测试、18 项前端/API 核心测试及构建通过。旧报告保持历史记录，重新执行生成新统计和完整差异行。

2026-09-07 云器表目录修复：默认 Schema 留空也可枚举 Workspace 下多个可见 Schema；默认值不再限制表映射范围。映射页已选表置顶，支持基准 Schema 筛选，多候选同名表需明确选择。累计更新包 `outputs/prism-catalog-fix.zip`，详见 [目录修复说明](CATALOG-FIX.md)。52 项 Java 测试、20 项核心测试、类型检查与构建通过。

2026-09-07 表级策略增强：打开表级策略即可查看两侧字段结构，筛选支持插入字段名，排序支持字段多选、逐项升降序及优先级调整。累计包 `outputs/prism-strategy-fix.zip`，详见 [使用说明](STRATEGY-FIX.md)。53 项 Java 测试和 23 项核心测试、类型检查及构建通过。

2026-09-07 表级规则简化：移除表级两个备用字段并停用其旧隐藏值；新增忽略数据对比字段复选框，实际被跳过差异保留审计。最新累计包仍为 `outputs/prism-strategy-fix.zip`。55 项 Java + 25 项前端/API 核心测试通过。

表级策略的唯一键支持字段复选框，多选组成复合键，兼容已有键配置与变量；更新方式见 `STRATEGY-FIX.md`。

测试计划支持“带参执行”：临时覆盖已定义计划变量，本次值保存在执行快照中，原计划默认值不变。

数据源与计划页支持 JSON 导入/导出（全选或部分选择）。导入创建副本；数据源不迁移密码，计划需确认数据源映射。原始查询结果长字段可点击查看全文；测试报告列表仅展示已结束任务。详见 `STRATEGY-FIX.md`。

新计划默认使用 `ds = ${ds}`，排序和唯一键不再预选 id。表级策略逐项覆盖统一策略，未指定项继承统一策略，可单项恢复继承。

版本归档见 `outputs/RELEASES.md`。后续发布包必须使用日期、序号与功能名，禁止覆盖已有版本。

20260909-05：移除统一策略的筛选与对齐配置和执行兜底逻辑，筛选、排序和对齐只使用表级规则。旧计划仅在全局配置过的内容需在表级补配。
