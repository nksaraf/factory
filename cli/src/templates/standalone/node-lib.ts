import type { TemplateVars, GeneratedFile } from "../types.js";
import { nodeQualityPackageJson, nodeQualityFiles, nodePrettierConfig } from "../quality-configs.js";

export function generate(vars: TemplateVars): GeneratedFile[] {
  const { name } = vars;

  const files: GeneratedFile[] = [];

  // package.json
  files.push({
    path: "package.json",
    content: JSON.stringify(
      {
        name,
        version: "0.0.1",
        type: "module",
        main: "dist/index.js",
        types: "dist/index.d.ts",
        scripts: {
          build: "tsc",
          dev: "tsc --watch",
          ...nodeQualityPackageJson().scripts,
        },
        dependencies: {},
        devDependencies: {
          typescript: "^5.9.3",
          ...nodeQualityPackageJson().devDependencies,
        },
        "simple-git-hooks": nodeQualityPackageJson()["simple-git-hooks"],
        "lint-staged": nodeQualityPackageJson()["lint-staged"],
      },
      null,
      2,
    ),
  });

  // tsconfig.json
  files.push({
    path: "tsconfig.json",
    content: JSON.stringify(
      {
        compilerOptions: {
          target: "ES2022",
          module: "ESNext",
          moduleResolution: "bundler",
          esModuleInterop: true,
          strict: true,
          skipLibCheck: true,
          declaration: true,
          outDir: "./dist",
          resolveJsonModule: true,
          isolatedModules: true,
        },
        include: ["src/**/*.ts"],
      },
      null,
      2,
    ),
  });

  // src/index.ts
  files.push({
    path: "src/index.ts",
    content: `// Export your library's public API here.\n`,
  });

  // .gitignore
  files.push({
    path: ".gitignore",
    content: `node_modules/
dist/
`,
  });

  // Quality tooling configs
  files.push(nodePrettierConfig());
  files.push(...nodeQualityFiles());

  return files;
}
