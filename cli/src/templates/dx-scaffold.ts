/**
 * dx-scaffold.ts — Template files for dx project scaffolding.
 * Generates .dx/hooks, .gitattributes, .github/workflows, .cursor/rules,
 * and the package.json dx key.
 */
import type { GeneratedFile } from "./types.js";

// ─── .dx/hooks ──────────────────────────────────────────────

function hookScript(hookName: string, dxSubcommand: string): string {
  return `#!/bin/sh
# dx git-hook: ${hookName}
command -v dx >/dev/null 2>&1 || { echo "dx not found. Install: curl -fsSL https://factory.lepton.software/install | sh"; exit 1; }
exec dx git-hook ${dxSubcommand}
`;
}

export function dxHookFiles(): GeneratedFile[] {
  return [
    {
      path: ".dx/hooks/commit-msg",
      content: `#!/bin/sh
# dx git-hook: validate commit message conventions
command -v dx >/dev/null 2>&1 || { echo "dx not found. Install: curl -fsSL https://factory.lepton.software/install | sh"; exit 1; }
exec dx git-hook commit-msg "$1"
`,
    },
    {
      path: ".dx/hooks/pre-commit",
      content: hookScript("lint staged files", "pre-commit"),
    },
    {
      path: ".dx/hooks/pre-push",
      content: hookScript("run quality checks", "pre-push"),
    },
    {
      path: ".dx/hooks/post-merge",
      content: `#!/bin/sh
# dx git-hook: sync local state after merge
command -v dx >/dev/null 2>&1 || exit 0
exec dx sync --quiet
`,
    },
    {
      path: ".dx/hooks/post-checkout",
      content: `#!/bin/sh
# dx git-hook: sync local state after checkout
[ "$3" = "1" ] || exit 0
command -v dx >/dev/null 2>&1 || exit 0
exec dx sync --quiet
`,
    },
  ];
}

// ─── .gitattributes ─────────────────────────────────────────

export function gitattributes(): GeneratedFile {
  return {
    path: ".gitattributes",
    content: `# Auto-detect text files and normalize line endings
* text=auto eol=lf

# Force LF for shell scripts
*.sh text eol=lf
*.bash text eol=lf

# Force CRLF for Windows scripts
*.cmd text eol=crlf
*.bat text eol=crlf
*.ps1 text eol=crlf

# Binary files
*.png binary
*.jpg binary
*.jpeg binary
*.gif binary
*.ico binary
*.woff binary
*.woff2 binary
*.ttf binary
*.eot binary
*.pdf binary
*.zip binary
*.gz binary
*.tar binary
`,
  };
}

// ─── .github/workflows/dx.yaml ─────────────────────────────

export function githubWorkflow(): GeneratedFile {
  return {
    path: ".github/workflows/dx.yaml",
    content: `name: dx

on:
  pull_request:
    branches: [main]
  push:
    tags: ['v*']

jobs:
  check:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - run: dx check

  deploy-preview:
    if: github.event_name == 'pull_request'
    needs: check
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - run: dx deploy preview

  deploy-prod:
    if: startsWith(github.ref, 'refs/tags/v')
    needs: check
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - run: dx deploy prod
`,
  };
}

// ─── .github/pull_request_template.md ───────────────────────

export function prTemplate(): GeneratedFile {
  return {
    path: ".github/pull_request_template.md",
    content: `## What

<!-- Brief description of the change -->

## Why

<!-- What problem does this solve? Link to issue if applicable -->

## How to test

<!-- Steps to verify this change works -->

## Checklist

- [ ] \`dx check\` passes locally
- [ ] Tests added/updated for new behavior
- [ ] Breaking changes documented (if any)
`,
  };
}

// ─── .cursor/rules ──────────────────────────────────────────

export function cursorRules(name: string): GeneratedFile {
  return {
    path: ".cursor/rules",
    content: `This project (${name}) uses the dx platform. Key context:

- docker-compose.yaml defines all services and infrastructure
- package.json dx key defines conventions, quality gates, and deploy rules
- Git hooks in .dx/hooks/ enforce conventions — use standard git commands
- Conventional commits required: feat|fix|chore|refactor|test|docs|perf|ci
- Run \`dx dev\` to start local environment, \`dx check\` to validate before pushing
- Run \`dx status --json\` for structured project state
- Run \`dx config --json\` for detected tools and pipeline configuration
`,
  };
}

// ─── .npmrc ─────────────────────────────────────────────────

export function npmrc(): GeneratedFile {
  return {
    path: ".npmrc",
    content: `save-exact=true
engine-strict=true
fund=false
audit-level=high
`,
  };
}

// ─── .node-version ──────────────────────────────────────────

export function nodeVersion(): GeneratedFile {
  return {
    path: ".node-version",
    content: "22\n",
  };
}

// ─── dx key for package.json ────────────────────────────────

export interface DxPackageJsonOptions {
  name: string;
  owner: string;
  type: "monorepo" | "service" | "frontend" | "library";
}

export function dxPackageJsonKey(opts: DxPackageJsonOptions): Record<string, any> {
  return {
    version: "1.0.0",
    type: opts.type,
    team: opts.owner,
    conventions: {
      commits: "conventional",
      branching: "trunk",
    },
    deploy: {
      preview: {
        trigger: "pull-request",
        ttl: "72h",
      },
      production: {
        trigger: "release-tag",
        approval: true,
      },
    },
  };
}

// ─── Updated .gitignore ─────────────────────────────────────

export function gitignore(): GeneratedFile {
  return {
    path: ".gitignore",
    content: `# Dependencies
node_modules/

# Build output
dist/
.output/
target/
build/

# Python
__pycache__/
*.pyc
.venv/

# dx local state
.dx/local/
.dx/cache/
.dx/state/
.dx/dev/

# Environment (generated by dx dev)
.env
.env.local

# Docker
docker-compose.override.yaml

# IDE (personal, not project settings)
.idea/
*.swp
*.swo

# OS
.DS_Store
Thumbs.db

# Logs
*.log
`,
  };
}
