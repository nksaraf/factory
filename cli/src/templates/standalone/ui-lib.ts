import type { TemplateVars, GeneratedFile } from "../types.js";

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
        peerDependencies: {
          react: ">=18",
          "react-dom": ">=18",
        },
        devDependencies: {
          typescript: "^5.9.3",
          react: "^19.0.0",
          "react-dom": "^19.0.0",
          "@types/react": "^19.0.0",
          tailwindcss: "^3.4.0",
        },
        scripts: {
          build: "tsc",
          dev: "tsc --watch",
        },
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
          target: "ES2020",
          jsx: "react-jsx",
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
        include: ["src/**/*.ts", "src/**/*.tsx"],
      },
      null,
      2,
    ),
  });

  // tailwind.config.cjs
  files.push({
    path: "tailwind.config.cjs",
    content: `/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ["./src/**/*.{ts,tsx}"],
  theme: {
    extend: {},
  },
  plugins: [],
};
`,
  });

  // src/index.ts
  files.push({
    path: "src/index.ts",
    content: `// Export your components here.\n`,
  });

  // src/components/.gitkeep
  files.push({
    path: "src/components/.gitkeep",
    content: ``,
  });

  // .gitignore
  files.push({
    path: ".gitignore",
    content: `node_modules/
dist/
`,
  });

  return files;
}
