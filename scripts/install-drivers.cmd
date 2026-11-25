@echo off
setlocal
cd /d "%~dp0.."
where mvn >nul 2>nul
if errorlevel 1 (
  echo Maven is missing. Install Maven 3.9+ and add its bin directory to PATH.
  exit /b 1
)
if not exist "jdbc-runner\drivers" mkdir "jdbc-runner\drivers"
call mvn -B org.apache.maven.plugins:maven-dependency-plugin:3.8.1:copy -Dartifact=com.aliyun.odps:odps-jdbc:3.8.6:jar:jar-with-dependencies -DoutputDirectory=jdbc-runner/drivers
if errorlevel 1 exit /b 1
call mvn -B org.apache.maven.plugins:maven-dependency-plugin:3.8.1:copy -Dartifact=com.clickzetta:clickzetta-jdbc:4.0.0 -DoutputDirectory=jdbc-runner/drivers
if errorlevel 1 exit /b 1
echo JDBC drivers are ready.
