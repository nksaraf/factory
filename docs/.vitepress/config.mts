import { defineConfig } from "vitepress";
import { withMermaid } from "vitepress-plugin-mermaid";
import fs from "node:fs";
import path from "node:path";

const docsRoot = path.resolve(__dirname, "..");

function readModeFromFile(filePath: string): string | undefined {
  try {
    const content = fs.readFileSync(filePath, "utf-8");
    const match = content.match(/^---([\s\S]*?)---/m);
    if (!match) return undefined;

    const frontmatter = match[1];
    const modeMatch = frontmatter.match(/^\s*mode:\s*([a-zA-Z0-9_-]+)/m);
    return modeMatch ? modeMatch[1].toLowerCase() : undefined;
  } catch {
    return undefined;
  }
}

function buildModeGroupedSidebar(dir: string, basePath: string = "/"): any[] {
  const entries = fs
    .readdirSync(dir, { withFileTypes: true })
    .filter(
      (e) => e.isFile() && e.name.endsWith(".md") && e.name !== "index.md"
    )
    .sort((a, b) => a.name.localeCompare(b.name));

  const modeOrder = [
    "general",
    "strategy",
    "operations",
    "performance",
    "other",
  ];
  const modeLabels: Record<string, string> = {
    strategy: "Strategy",
    operations: "Operations",
    performance: "Performance",
    other: "Other",
    general: "General",
  };

  const grouped: Record<string, any[]> = {};

  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    const relativePath = path.join(basePath, entry.name);
    const rawMode = readModeFromFile(fullPath) ?? "other";
    const mode = modeOrder.includes(rawMode) ? rawMode : "other";

    const link = relativePath.replace(/\.md$/, "");
    const item = {
      text: titleFromFilename(entry.name),
      link: "/" + link.replace(/^\//, ""),
    };

    if (!grouped[mode]) {
      grouped[mode] = [];
    }
    grouped[mode].push(item);
  }

  const result: any[] = [];
  for (const key of modeOrder) {
    const items = grouped[key];
    if (!items || items.length === 0) continue;
    result.push({
      text: modeLabels[key],
      collapsed: true,
      items,
    });
  }

  return result;
}

function titleFromFilename(filename: string): string {
  return filename
    .replace(/\.md$/, "")
    .replace(/[-_]/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase())
    .replace(/\b(Blueprints?|Requirements?)\b/gi, "")
    .replace(/\s{2,}/g, " ")
    .trim()
    .replace(/README/i, "Overview");
}

function buildSidebarGroup(dir: string, basePath: string = "/"): any[] {
  const basename = path.basename(dir);
  if (
    basename === "feature-requirements" ||
    basename === "feature-blueprints"
  ) {
    return buildModeGroupedSidebar(dir, basePath);
  }

  const entries = fs
    .readdirSync(dir, { withFileTypes: true })
    .filter((e) => !e.name.startsWith(".") && e.name !== "node_modules")
    .sort((a, b) => {
      if (a.name === "README.md") return -1;
      if (b.name === "README.md") return 1;
      const aIsDir = a.isDirectory() ? 0 : 1;
      const bIsDir = b.isDirectory() ? 0 : 1;
      if (aIsDir !== bIsDir) return aIsDir - bIsDir;
      return a.name.localeCompare(b.name);
    });

  const items: any[] = [];

  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    const relativePath = path.join(basePath, entry.name);

    if (entry.isDirectory()) {
      const children = buildSidebarGroup(fullPath, relativePath);
      if (children.length > 0) {
        items.push({
          text: titleFromFilename(entry.name),
          collapsed: true,
          items: children,
        });
      }
    } else if (entry.name.endsWith(".md") && entry.name !== "index.md") {
      const link = relativePath.replace(/\.md$/, "");
      items.push({
        text: titleFromFilename(entry.name),
        link: "/" + link.replace(/^\//, ""),
      });
    }
  }

  return items;
}

const sidebar = buildSidebarGroup(docsRoot);

export default withMermaid(
  defineConfig({
    title: "Smart Market Platform",
    description: "Product & engineering documentation for Smart Market",
    ignoreDeadLinks: true,
    srcExclude: ["**/node_modules/**"],

    themeConfig: {
      nav: [
        { text: "Product", link: "/product-overview/product-description" },
        {
          text: "Features",
          link: "/feature-requirements/ai-data-analyst-assistant-requirements",
        },
        {
          text: "Blueprints",
          link: "/feature-blueprints/ai-data-analyst-assistant-blueprint",
        },
        { text: "API", link: "/api/" },
        { text: "Services", link: "/services/platform/" },
      ],

      sidebar,

      search: {
        provider: "local",
      },

      outline: {
        level: [2, 3],
      },
    },

    mermaid: {},
  })
);
