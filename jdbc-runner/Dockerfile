FROM maven:3.9-eclipse-temurin-17 AS build
WORKDIR /build
COPY pom.xml ./
COPY src ./src
RUN mvn -B -q package
FROM eclipse-temurin:17-jre
WORKDIR /app
COPY --from=build /build/target/jdbc-runner-1.0.0.jar /app/prism-runner.jar
ENV PRISM_BIND=0.0.0.0 PRISM_PORT=8081 PRISM_DATA_DIR=/data
RUN groupadd --system prism && useradd --system --gid prism prism && mkdir -p /data /drivers && chown -R prism:prism /data /drivers
USER prism
EXPOSE 8081
CMD ["java","-cp","/app/prism-runner.jar:/drivers/*","tech.prism.Runner"]
