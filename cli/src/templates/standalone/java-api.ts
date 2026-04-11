import {
  componentLabels,
  labelsToYaml,
  resourceLabels,
} from "../compose-labels.js"
import { javaMavenPlugins, javaQualityFiles } from "../quality-configs.js"
import type { GeneratedFile, TemplateVars } from "../types.js"
import { toJavaPackage } from "../types.js"

export function generate(vars: TemplateVars): GeneratedFile[] {
  const { name, owner, description } = vars
  const javaName = toJavaPackage(name)

  const files: GeneratedFile[] = []

  // pom.xml (parent)
  files.push({
    path: "pom.xml",
    content: `<?xml version="1.0" encoding="UTF-8"?>
<project xmlns="http://maven.apache.org/POM/4.0.0"
         xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
         xsi:schemaLocation="http://maven.apache.org/POM/4.0.0 http://maven.apache.org/xsd/maven-4.0.0.xsd">
  <modelVersion>4.0.0</modelVersion>

  <parent>
    <groupId>org.springframework.boot</groupId>
    <artifactId>spring-boot-starter-parent</artifactId>
    <version>3.3.5</version>
    <relativePath/>
  </parent>

  <groupId>software.lepton</groupId>
  <artifactId>${name}</artifactId>
  <version>0.0.1-SNAPSHOT</version>
  <packaging>pom</packaging>
  <name>${name}</name>
  <description>${description}</description>

  <properties>
    <java.version>21</java.version>
  </properties>

  <modules>
    <module>server</module>
  </modules>
</project>
`,
  })

  // server/pom.xml
  files.push({
    path: "server/pom.xml",
    content: `<?xml version="1.0" encoding="UTF-8"?>
<project xmlns="http://maven.apache.org/POM/4.0.0"
         xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
         xsi:schemaLocation="http://maven.apache.org/POM/4.0.0 http://maven.apache.org/xsd/maven-4.0.0.xsd">
  <modelVersion>4.0.0</modelVersion>

  <parent>
    <groupId>software.lepton</groupId>
    <artifactId>${name}</artifactId>
    <version>0.0.1-SNAPSHOT</version>
  </parent>

  <artifactId>${name}-server</artifactId>
  <name>${name}-server</name>

  <dependencies>
    <dependency>
      <groupId>org.springframework.boot</groupId>
      <artifactId>spring-boot-starter-web</artifactId>
    </dependency>
    <dependency>
      <groupId>org.springframework.boot</groupId>
      <artifactId>spring-boot-starter-actuator</artifactId>
    </dependency>
    <dependency>
      <groupId>org.flywaydb</groupId>
      <artifactId>flyway-core</artifactId>
    </dependency>
    <dependency>
      <groupId>org.flywaydb</groupId>
      <artifactId>flyway-database-postgresql</artifactId>
    </dependency>
    <dependency>
      <groupId>org.postgresql</groupId>
      <artifactId>postgresql</artifactId>
      <scope>runtime</scope>
    </dependency>
    <dependency>
      <groupId>org.springdoc</groupId>
      <artifactId>springdoc-openapi-starter-webmvc-ui</artifactId>
      <version>2.6.0</version>
    </dependency>
    <dependency>
      <groupId>org.projectlombok</groupId>
      <artifactId>lombok</artifactId>
      <optional>true</optional>
    </dependency>
  </dependencies>

  <build>
    <plugins>
      <plugin>
        <groupId>org.springframework.boot</groupId>
        <artifactId>spring-boot-maven-plugin</artifactId>
        <configuration>
          <excludes>
            <exclude>
              <groupId>org.projectlombok</groupId>
              <artifactId>lombok</artifactId>
            </exclude>
          </excludes>
        </configuration>
      </plugin>
${javaMavenPlugins()}
    </plugins>
  </build>
</project>
`,
  })

  // Application.java
  files.push({
    path: `server/src/main/java/software/lepton/service/${javaName}/Application.java`,
    content: `package software.lepton.service.${javaName};

import org.springframework.boot.SpringApplication;
import org.springframework.boot.autoconfigure.SpringBootApplication;

@SpringBootApplication
public class Application {

    public static void main(String[] args) {
        SpringApplication.run(Application.class, args);
    }
}
`,
  })

  // HealthController.java
  files.push({
    path: `server/src/main/java/software/lepton/service/${javaName}/config/HealthController.java`,
    content: `package software.lepton.service.${javaName}.config;

import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RestController;

import java.util.Map;

@RestController
public class HealthController {

    @GetMapping("/health")
    public Map<String, String> health() {
        return Map.of("status", "ok");
    }
}
`,
  })

  // application.yml
  files.push({
    path: "server/src/main/resources/application.yml",
    content: `server:
  port: 8080
  servlet:
    context-path: /api/v1/${name}

spring:
  datasource:
    url: \${DATABASE_URL:jdbc:postgresql://localhost:5432/postgres}
    username: \${DATABASE_USER:postgres}
    password: \${DATABASE_PASSWORD:postgres}
    driver-class-name: org.postgresql.Driver

  flyway:
    enabled: true
    locations: classpath:db/migration
    baseline-on-migrate: true
`,
  })

  // V1__init.sql
  files.push({
    path: "server/src/main/resources/db/migration/V1__init.sql",
    content: `-- Initial migration placeholder
-- Add your schema definitions here
`,
  })

  // Dockerfile
  files.push({
    path: "Dockerfile",
    content: `FROM maven:3.9-eclipse-temurin-21-alpine AS builder

WORKDIR /app

COPY pom.xml .
COPY server/pom.xml server/
RUN mvn dependency:go-offline -B

COPY . .
RUN mvn package -DskipTests -B

FROM eclipse-temurin:21-jre-alpine AS runner

WORKDIR /app

COPY --from=builder /app/server/target/*.jar app.jar

ENV JAVA_OPTS=""
EXPOSE 8080

ENTRYPOINT ["sh", "-c", "java $JAVA_OPTS -jar app.jar"]
`,
  })

  // docker-compose.yaml
  const svcLabels = componentLabels({
    type: "service",
    owner,
    description,
    runtime: "java",
    port: { number: 8080, name: "http", protocol: "tcp" },
  })

  const pgLabels = resourceLabels({
    type: "database",
    owner,
    description: `PostgreSQL database for ${name}`,
    port: { number: 5432, name: "postgresql", protocol: "tcp" },
  })

  files.push({
    path: "docker-compose.yaml",
    content: `services:
  ${name}:
    build: .
    ports:
      - "8080:8080"
    environment:
      DATABASE_URL: jdbc:postgresql://${name}-postgres:5432/postgres
      DATABASE_USER: postgres
      DATABASE_PASSWORD: postgres
    depends_on:
      ${name}-postgres:
        condition: service_healthy
    labels:
${labelsToYaml(svcLabels, 6)}

  ${name}-postgres:
    image: postgres:16-alpine
    ports:
      - "5432:5432"
    environment:
      POSTGRES_USER: postgres
      POSTGRES_PASSWORD: postgres
      POSTGRES_DB: postgres
    volumes:
      - ${name}-pgdata:/var/lib/postgresql/data
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U postgres"]
      interval: 5s
      timeout: 5s
      retries: 5
    labels:
${labelsToYaml(pgLabels, 6)}

volumes:
  ${name}-pgdata:
`,
  })

  // .gitignore
  files.push({
    path: ".gitignore",
    content: `# Build output
target/
*.class
*.jar
*.war

# IDE
.idea/
*.iml
.vscode/
.project
.classpath
.settings/

# OS
.DS_Store
Thumbs.db

# Env
.env
*.log
`,
  })

  // Quality tooling configs
  files.push(...javaQualityFiles())

  return files
}
