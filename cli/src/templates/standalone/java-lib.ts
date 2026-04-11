import type { TemplateVars, GeneratedFile } from "../types.js"
import { toJavaPackage } from "../types.js"
import { javaMavenPlugins, javaQualityFiles } from "../quality-configs.js"

export function generate(vars: TemplateVars): GeneratedFile[] {
  const { name, description } = vars
  const javaName = toJavaPackage(name)

  const files: GeneratedFile[] = []

  // pom.xml
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

  <groupId>software.lepton.lib</groupId>
  <artifactId>${name}</artifactId>
  <version>0.0.1-SNAPSHOT</version>
  <packaging>jar</packaging>
  <name>${name}</name>
  <description>${description}</description>

  <properties>
    <java.version>21</java.version>
  </properties>

  <build>
    <plugins>
${javaMavenPlugins()}
    </plugins>
  </build>
</project>
`,
  })

  // package-info.java
  files.push({
    path: `src/main/java/software/lepton/lib/${javaName}/package-info.java`,
    content: `/**
 * ${description}
 */
package software.lepton.lib.${javaName};
`,
  })

  // .gitignore
  files.push({
    path: ".gitignore",
    content: `target/
.idea/
*.class
*.jar
.settings/
.project
.classpath
`,
  })

  // Quality tooling configs
  files.push(...javaQualityFiles())

  return files
}
