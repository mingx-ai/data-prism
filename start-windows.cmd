@echo off
setlocal
cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 (
  echo Node.js is missing. Install Node.js 22.13+ and reopen this window.
  goto failed
)
node -e "const [major,minor]=process.versions.node.split('.').map(Number);process.exit(major>22 || major===22 && minor>=13 ? 0 : 1)"
if errorlevel 1 (
  echo Node.js 22.13 or newer is required.
  goto failed
)
if defined JAVA_HOME set "PATH=%JAVA_HOME%\bin;%PATH%"
where java >nul 2>nul
if errorlevel 1 (
  echo Java is missing. Install Java 17+ and set JAVA_HOME or PATH.
  goto failed
)
if not exist "dist-selfhost\server.mjs" goto missing_build
if not exist "dist-selfhost\public\index.html" goto missing_build
if not exist "drizzle\0000_silly_sentry.sql" goto missing_build
if not exist "jdbc-runner\target\jdbc-runner-1.0.0.jar" goto missing_build
if not exist "jdbc-runner\drivers\odps-jdbc-3.8.6-jar-with-dependencies.jar" goto missing_drivers
if not exist "jdbc-runner\drivers\clickzetta-jdbc-4.0.0.jar" goto missing_drivers

node scripts\configure.mjs
if errorlevel 1 goto failed
start "Prism JDBC" cmd /k "node scripts\start-runner.mjs"
start "Prism Web" cmd /k "node --env-file=.env dist-selfhost/server.mjs"
echo Two service windows have been opened. Check both for startup errors.
echo Default address: http://127.0.0.1:3001
echo Login: admin. Password: PRISM_ADMIN_PASSWORD in .env
echo Keep both service windows open. Press Ctrl+C in each to stop.
echo See WINDOWS.md for setup, network checks and data migration.
pause
exit /b 0

:missing_build
echo Build files are missing. Follow WINDOWS.md or use the complete runtime package.
goto failed
:missing_drivers
echo JDBC drivers are missing. Run scripts\install-drivers.cmd first.
:failed
pause
exit /b 1
