# Multi-stage build for any ERP Spring Cloud module.
# Build: docker build --build-arg SERVICE_MODULE=erp-gateway -t erp-gateway .
# Run:   docker run -p 9000:9000 -e EUREKA_URL=http://host.docker.internal:8761/eureka/ erp-gateway

ARG DOCKER_REGISTRY=docker.io/library/
FROM ${DOCKER_REGISTRY}maven:3.9-eclipse-temurin-21 AS builder

WORKDIR /build
ARG SERVICE_MODULE=erp-gateway

COPY pom.xml ./
COPY erp-common ./erp-common
COPY erp-registry ./erp-registry
COPY erp-gateway ./erp-gateway
COPY erp-auth-service ./erp-auth-service
COPY erp-crm-service ./erp-crm-service
COPY erp-scm-service ./erp-scm-service
COPY erp-finance-service ./erp-finance-service
COPY erp-integration-service ./erp-integration-service

RUN mvn -pl ${SERVICE_MODULE} -am package -DskipTests -B \
    -Dmaven.repo.local=/build/.m2/repository && \
    cp /build/${SERVICE_MODULE}/target/${SERVICE_MODULE}-*.jar /build/app.jar

ARG DOCKER_REGISTRY=docker.io/library/
FROM ${DOCKER_REGISTRY}eclipse-temurin:21-jre-alpine

WORKDIR /app
COPY --from=builder /build/app.jar /app/app.jar

ENV JAVA_OPTS="-XX:+UseContainerSupport -XX:MaxRAMPercentage=75.0"
ENTRYPOINT ["sh", "-c", "java $JAVA_OPTS -jar /app/app.jar"]
