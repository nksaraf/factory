/**
 * Quality tooling config generators for dx init templates.
 * Each function returns GeneratedFile[] that templates can spread into their file list.
 */

import type { GeneratedFile } from "./types.js";

// ─── Node / TypeScript ──────────────────────────────────────

/** Shared oxlint config for Node/TS projects. */
export function nodeOxlintConfig(): GeneratedFile {
  return {
    path: "oxlint.config.json",
    content: JSON.stringify(
      {
        $schema:
          "https://raw.githubusercontent.com/nicolo-ribaudo/oxc-project-config-schema/refs/heads/main/schema.json",
        rules: {
          "no-unused-vars": "warn",
          "no-console": "warn",
          eqeqeq: "error",
        },
        ignorePatterns: ["dist/", "node_modules/", ".output/", "build/"],
      },
      null,
      2,
    ),
  };
}

/** .prettierrc for Node projects (standalone — project template generates its own). */
export function nodePrettierConfig(): GeneratedFile {
  return {
    path: ".prettierrc",
    content: JSON.stringify(
      { semi: true, singleQuote: false, trailingComma: "all" },
      null,
      2,
    ),
  };
}

/** Vitest config for Node projects. */
export function nodeVitestConfig(): GeneratedFile {
  return {
    path: "vitest.config.ts",
    content: `import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["src/**/*.test.ts"],
  },
});
`,
  };
}

/** VSCode extensions recommendation for Node projects. */
export function vscodeExtensionsNode(): GeneratedFile {
  return {
    path: ".vscode/extensions.json",
    content: JSON.stringify(
      {
        recommendations: [
          "nicolo-ribaudo.oxc",
          "esbenp.prettier-vscode",
        ],
      },
      null,
      2,
    ),
  };
}

/** VSCode settings for Node projects (format-on-save). */
export function vscodeSettingsNode(): GeneratedFile {
  return {
    path: ".vscode/settings.json",
    content: JSON.stringify(
      {
        "editor.formatOnSave": true,
        "editor.defaultFormatter": "esbenp.prettier-vscode",
        "[typescript]": { "editor.defaultFormatter": "esbenp.prettier-vscode" },
        "[typescriptreact]": { "editor.defaultFormatter": "esbenp.prettier-vscode" },
      },
      null,
      2,
    ),
  };
}

/**
 * Quality-related additions to package.json scripts and devDependencies.
 * Returns the partial objects that templates should merge into their package.json.
 */
export function nodeQualityPackageJson(): {
  scripts: Record<string, string>;
  devDependencies: Record<string, string>;
  "simple-git-hooks": Record<string, string>;
  "lint-staged": Record<string, string[]>;
} {
  return {
    scripts: {
      lint: "oxlint .",
      "lint:fix": "oxlint --fix .",
      typecheck: "tsc --noEmit",
      "format:check": "prettier --check .",
      format: "prettier --write .",
      test: "vitest run",
    },
    devDependencies: {
      oxlint: "^0.16.0",
      vitest: "^4.1.0",
      prettier: "^3.5.0",
      "simple-git-hooks": "^2.11.0",
      "lint-staged": "^15.4.0",
    },
    "simple-git-hooks": {
      "pre-commit": "npx lint-staged",
    },
    "lint-staged": {
      "*.{ts,tsx,js,jsx}": ["oxlint --fix", "prettier --write"],
      "*.{json,md,css}": ["prettier --write"],
    },
  };
}

/**
 * All quality files for a Node standalone template.
 * Does not include .prettierrc (templates may already emit one).
 */
export function nodeQualityFiles(): GeneratedFile[] {
  return [
    nodeOxlintConfig(),
    nodeVitestConfig(),
    vscodeExtensionsNode(),
    vscodeSettingsNode(),
  ];
}

// ─── Python ─────────────────────────────────────────────────

/** Ruff + pytest config to append to pyproject.toml. */
export function pythonQualityToml(): string {
  return `
[tool.ruff]
target-version = "py311"
line-length = 120

[tool.ruff.lint]
select = ["E", "F", "I", "N", "W", "UP", "B", "SIM"]

[tool.ruff.format]
quote-style = "double"

[tool.pytest.ini_options]
testpaths = ["tests"]
python_files = ["test_*.py"]
python_functions = ["test_*"]
`;
}

/** Pre-commit config for Python projects. */
export function pythonPreCommitConfig(): GeneratedFile {
  return {
    path: ".pre-commit-config.yaml",
    content: `repos:
  - repo: https://github.com/astral-sh/ruff-pre-commit
    rev: v0.8.6
    hooks:
      - id: ruff
        args: [--fix]
      - id: ruff-format
`,
  };
}

/** Python quality files (excluding pyproject.toml additions which are inline). */
export function pythonQualityFiles(): GeneratedFile[] {
  return [
    pythonPreCommitConfig(),
    {
      path: ".vscode/extensions.json",
      content: JSON.stringify(
        { recommendations: ["charliermarsh.ruff"] },
        null,
        2,
      ),
    },
    {
      path: ".vscode/settings.json",
      content: JSON.stringify(
        {
          "[python]": {
            "editor.defaultFormatter": "charliermarsh.ruff",
            "editor.formatOnSave": true,
          },
        },
        null,
        2,
      ),
    },
  ];
}

// ─── Java ───────────────────────────────────────────────────

/** Google-style Checkstyle config. */
export function javaCheckstyleConfig(): GeneratedFile {
  return {
    path: "checkstyle.xml",
    content: `<?xml version="1.0"?>
<!DOCTYPE module PUBLIC
  "-//Checkstyle//DTD Checkstyle Configuration 1.3//EN"
  "https://checkstyle.org/dtds/configuration_1_3.dtd">
<module name="Checker">
  <module name="TreeWalker">
    <module name="AvoidStarImport"/>
    <module name="UnusedImports"/>
    <module name="RedundantImport"/>
    <module name="NeedBraces"/>
    <module name="LeftCurly"/>
    <module name="RightCurly"/>
    <module name="EmptyBlock"/>
  </module>
  <module name="FileLength">
    <property name="max" value="500"/>
  </module>
  <module name="NewlineAtEndOfFile"/>
</module>
`,
  };
}

/** Maven plugins XML for checkstyle + spotless + jacoco. */
export function javaMavenPlugins(): string {
  return `      <plugin>
        <groupId>org.apache.maven.plugins</groupId>
        <artifactId>maven-checkstyle-plugin</artifactId>
        <version>3.6.0</version>
        <configuration>
          <configLocation>checkstyle.xml</configLocation>
          <consoleOutput>true</consoleOutput>
          <failsOnError>true</failsOnError>
        </configuration>
      </plugin>
      <plugin>
        <groupId>com.diffplug.spotless</groupId>
        <artifactId>spotless-maven-plugin</artifactId>
        <version>2.44.4</version>
        <configuration>
          <java>
            <googleJavaFormat>
              <version>1.25.2</version>
            </googleJavaFormat>
          </java>
        </configuration>
      </plugin>
      <plugin>
        <groupId>org.jacoco</groupId>
        <artifactId>jacoco-maven-plugin</artifactId>
        <version>0.8.12</version>
        <executions>
          <execution>
            <goals>
              <goal>prepare-agent</goal>
            </goals>
          </execution>
          <execution>
            <id>report</id>
            <phase>test</phase>
            <goals>
              <goal>report</goal>
            </goals>
          </execution>
        </executions>
      </plugin>`;
}

/** Java quality files. */
export function javaQualityFiles(): GeneratedFile[] {
  return [javaCheckstyleConfig()];
}

// ─── Shared / Cross-runtime ─────────────────────────────────

/** .editorconfig for any project. */
export function editorConfig(): GeneratedFile {
  return {
    path: ".editorconfig",
    content: `root = true

[*]
indent_style = space
indent_size = 2
end_of_line = lf
charset = utf-8
trim_trailing_whitespace = true
insert_final_newline = true

[*.{java,py}]
indent_size = 4

[*.md]
trim_trailing_whitespace = false
`,
  };
}

/** Default .dx/conventions.yaml with quality section. */
export function dxConventionsYaml(owner: string): GeneratedFile {
  return {
    path: ".dx/conventions.yaml",
    content: `# Project conventions — enforced by dx check and CI
branches:
  pattern: "{type}/{ticket}-{slug}"
  types: [feat, fix, chore, docs, refactor, test]
  require-ticket: false

commits:
  format: conventional

quality:
  lint:
    enabled: true
    block-pr: true
  typecheck:
    enabled: true
    block-pr: true
  test:
    enabled: true
    block-pr: true
    coverage:
      enabled: false
      min-line: 0
  format:
    enabled: true
    block-pr: false
`,
  };
}
