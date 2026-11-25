# 在公司 Windows 电脑运行 Prism

Prism 的服务器版由浏览器页面、Node.js API / SQLite 和 Java JDBC 服务组成，可以整体复制到 Windows 原生运行。真实数据库连接从 **Windows 电脑上的 Java 进程** 发起，所以该电脑需要接入公司网络 / VPN，并拥有相应数据库权限。

建议先用原生方式联调。本步骤不需要 Docker、WSL 或 Bash。

## 方式一：使用已构建的迁移包

`outputs/prism-windows-bundle.zip` 包含工程源码、前端 / Node.js 构建产物、Java 执行引擎，以及 MaxCompute / 云器 JDBC 驱动；MySQL 驱动已经打入执行引擎 JAR。它不包含 Node.js、Java 运行时，也不包含当前电脑的密钥、真实数据源配置或历史数据。

1. 安装 Windows 版 **Node.js 22 LTS（至少 22.13）** 和 **Java 17 JDK**，确保 `node`、`java` 可在终端运行。如果使用 `JAVA_HOME`，应指向 JDK 根目录。
2. 解压迁移包到当前用户可写的本地目录，例如 `C:\Prism`。不要在 ZIP 内直接启动。
3. 双击根目录 `start-windows.cmd`。首次启动生成 `.env`，并打开两个服务窗口。看到各自的监听地址后，在浏览器打开 `http://127.0.0.1:3001`。
4. 默认用户名 `admin`；用记事本打开 `.env`，查看 `PRISM_ADMIN_PASSWORD` 的值作为密码。
5. 保持两个服务窗口开启。停止时在两个窗口中分别按 `Ctrl+C`，再关闭窗口。

此方式运行时不需要 `npm ci`、Maven 或下载依赖；重新修改、构建代码时才需要它们。应用页面资源随包提供，但真实数据库连接仍需要访问对应数据库服务。

## 方式二：在 Windows 从源码构建

安装 Node.js 22 LTS（至少 22.13）、Java 17 JDK、Maven 3.9+，重新打开 PowerShell，进入工程根目录执行。使用 `.cmd` 命令可避免 PowerShell 将 `npm` 解析为受执行策略限制的 `npm.ps1`。

```powershell
cd C:\Prism
node --version
java -version
mvn.cmd -version

npm.cmd ci
node scripts/configure.mjs
.\scripts\install-drivers.cmd
npm.cmd run build:selfhost
mvn.cmd -f jdbc-runner/pom.xml package
```

每一步成功后再执行下一步。如果公司通过内部 npm / Maven 镜像下载依赖，按公司要求配置 npm registry 与 Maven settings。迁移包已经带有两个驱动 JAR 时，可跳过驱动安装步骤。

然后运行：

```powershell
.\start-windows.cmd
```

也可以在工程根目录的两个 PowerShell 窗口分别执行：

```powershell
node scripts/start-runner.mjs
```

```powershell
node --env-file=.env dist-selfhost/server.mjs
```

使用服务器版的 `build:selfhost` / `start:selfhost`。`npm run dev` 使用另一套开发数据库，与服务器版 SQLite 数据独立。

不要从 Mac 复制 `node_modules` 到 Windows 复用：其中包含操作系统 / CPU 架构相关的构建工具。从源码构建时在 Windows 运行 `npm.cmd ci` 重新安装。

## 在公司网络内按顺序验证

1. **平台启动**：能登录页面；两个服务窗口均正常。演示数据只用于检查界面和演示流程，不能证明真实数据库已连接。
2. **真实数据源连接**：在“数据源”中新建真实 MaxCompute、云器 Lakehouse 和 MySQL 连接，填写公司提供的 JDBC URL、账号和密码，逐个点击“验证连通性”。当前 Java 实现会连接数据库并执行 `SELECT 1`。
3. **读取元数据**：新建校验计划，确认能读取各数据源的 Schema、表和字段。连接测试成功不等于具有读取全部业务表的权限。
4. **小范围校验**：先选一组静态表或固定业务分区，选择按稳定排序逐条比较或按唯一键对齐，运行结构、行数和 100 行数据校验，检查报告中的 SQL、参数和差异。
5. **其余功能**：验证配置编辑、计划复制、参数替换、报告 HTML / JSON 导出、忽略差异审计下载；使用运行时间足够长的小任务检查暂停 / 恢复 / 取消，再逐步验证全量读取。
6. **重启持久化**：停止两个服务后重新启动，检查数据源、计划和历史报告。运行中的任务若被重启中断，需要重新执行。

真实网络联调尚未在公司 Windows 电脑执行。MaxCompute、云器和 MySQL 的实际兼容性、权限与网络是否足够，以上述真实测试结果为准。

如需自动化检查，在已安装构建依赖并完成构建后执行：

```powershell
npm.cmd run test:core
npm.cmd run test:app
mvn.cmd -f jdbc-runner/pom.xml test
```

自动化测试使用演示数据 / H2 等本地测试数据，不代替公司三种数据库联调。

## 网络问题排查

PowerShell 中按实际主机名、端口替换以下占位值：

```powershell
Resolve-DnsName <数据库主机名>
Test-NetConnection <MySQL主机名> -Port <实际端口>
Test-NetConnection <MaxCompute或云器主机名> -Port <实际端口>
```

默认示例中 MySQL 使用 3306，HTTPS 端点使用 443，以公司提供的实际地址为准。这些命令只检查 DNS / TCP；最终仍需平台内的 JDBC 查询验证。

| 现象 | 优先检查 |
| --- | --- |
| 本机页面无法打开 | Web 窗口报错、Node 版本、3001 端口是否被占用 |
| JDBC 服务无法启动 | Java 版本、`JAVA_HOME`、8081 端口、引擎 JAR 是否存在 |
| 提示找不到驱动类 | 两个外置 JAR 是否放在 `jdbc-runner/drivers/`，重启 JDBC 服务 |
| DNS 错误或连接超时 | 公司网络 / VPN、实际域名和端口、网络白名单 |
| TLS / PKIX 证书错误 | 公司证书是否按 IT 要求加入 Java 信任库 |
| 认证失败或表权限不足 | 账号、密码、项目 / Workspace / Schema 与授权 |
| 连接测试通过，但元数据 / 全量读取失败 | 对应操作权限、驱动配置、下载限制及数据传输所需端点 |

浏览器能访问某个网页，不代表 Java 已采用相同的代理或证书设置。MaxCompute SQL 访问端点和结果下载（Tunnel 等）端点应按实际部署向管理员确认；仅放通一个域名可能仍不足以完成结果读取。参考：[MaxCompute Endpoint](https://www.alibabacloud.com/help/en/maxcompute/user-guide/endpoints)、[JDBC 连接参数](https://www.alibabacloud.com/help/en/maxcompute/user-guide/usage-notes-2)。

默认 Web 监听 `127.0.0.1:3001`，JDBC 监听 `127.0.0.1:8081`，只供该电脑使用。更换端口时，在 `.env` 同时配置 Web 的 `PORT`，或 JDBC 的 `PRISM_PORT` 与匹配的 `JDBC_GATEWAY_URL`，修改后重启两个服务。

## 是否要迁移当前配置和历史记录

迁移包默认使用新工作空间，首次运行会初始化演示数据，真实连接在公司电脑内重新录入即可。

若要保留当前电脑的数据，先停止当前 Node.js / Java 服务，确认已退出，再单独复制以下内容到新电脑相同位置：

- `.env`：必须保留原 `SOURCE_KEY`，否则无法解密旧数据源凭据；同机原生部署应检查 `JDBC_GATEWAY_URL=http://127.0.0.1:8081`。
- `data/web/`：平台 SQLite 数据，复制整个目录，包括可能存在的 WAL / SHM 文件。
- `jdbc-runner/data/`：执行结果与完整审计文件；若配置了 `PRISM_WEB_DATA` / `PRISM_DATA_DIR`，复制实际配置的目录并调整 Windows 路径。

这三项包含密钥或业务数据，应通过公司允许的方式单独迁移。配置脚本会保留已有 `.env`。不要在服务仍运行时只复制 `prism.sqlite` 主文件。

运行包不携带 `node_modules`、Mac 开发缓存、`.dev.vars` 或 `.wrangler` 数据。如需迁移开发模式中的数据，需另行导出导入，不能当作服务器版 SQLite 文件直接替换。

## 平台兼容性依据

启动脚本使用当前系统的路径分隔符，并用 Node 原生 `.env` 解析处理 Windows 换行。Java 官方说明 Windows classpath 使用分号，macOS / Linux 使用冒号：[Java 17 启动参数](https://docs.oracle.com/en/java/javase/17/docs/specs/man/java.html)。Node.js 从 22.13 起无需实验开关即可使用本工程依赖的内置 SQLite：[Node.js SQLite 文档](https://nodejs.org/download/release/v22.13.0/docs/api/sqlite.html)。本次本地检查在 macOS 执行，未将其作为 Windows 实机验证。
