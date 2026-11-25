#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
mkdir -p jdbc-runner/drivers
mvn -B org.apache.maven.plugins:maven-dependency-plugin:3.8.1:copy -Dartifact=com.aliyun.odps:odps-jdbc:3.8.6:jar:jar-with-dependencies -DoutputDirectory=jdbc-runner/drivers
mvn -B org.apache.maven.plugins:maven-dependency-plugin:3.8.1:copy -Dartifact=com.clickzetta:clickzetta-jdbc:4.0.0 -DoutputDirectory=jdbc-runner/drivers
