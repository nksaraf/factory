import { defineConfig } from "vitepress";
import { withMermaid } from "vitepress-plugin-mermaid";

export default withMermaid(
  defineConfig({
    title: "Factory",
    description: "Developer documentation for the Factory platform",
    ignoreDeadLinks: true,
    srcExclude: [
      "**/node_modules/**",
      "control-plane/**",
      "foundation-blueprints/**",
      "superpowers/**",
      "software-factory/**",
      "reference/**",
    ],

    themeConfig: {
      nav: [
        { text: "Getting Started", link: "/getting-started/what-is-factory" },
        { text: "Concepts", link: "/concepts/" },
        { text: "Guides", link: "/guides/" },
        { text: "CLI Reference", link: "/cli/" },
        { text: "API", link: "/api/" },
        { text: "Architecture", link: "/architecture/" },
      ],

      sidebar: {
        "/getting-started/": [
          {
            text: "Getting Started",
            items: [
              {
                text: "What is Factory?",
                link: "/getting-started/what-is-factory",
              },
              {
                text: "Installation",
                link: "/getting-started/installation",
              },
              { text: "Quickstart", link: "/getting-started/quickstart" },
              {
                text: "Core Workflow",
                link: "/getting-started/core-workflow",
              },
              {
                text: "Project Structure",
                link: "/getting-started/project-structure",
              },
            ],
          },
        ],

        "/concepts/": [
          {
            text: "Mental Model",
            items: [
              { text: "Overview", link: "/concepts/" },
              {
                text: "Domains",
                collapsed: false,
                items: [
                  {
                    text: "org — Actors & Identity",
                    link: "/concepts/org",
                  },
                  {
                    text: "software — What Gets Built",
                    link: "/concepts/software",
                  },
                  {
                    text: "infra — Where Things Run",
                    link: "/concepts/infra",
                  },
                  {
                    text: "ops — What Is Running",
                    link: "/concepts/ops",
                  },
                  {
                    text: "build — How It Ships",
                    link: "/concepts/build",
                  },
                  {
                    text: "commerce — Who Pays",
                    link: "/concepts/commerce",
                  },
                ],
              },
              {
                text: "Entity Relationships",
                link: "/concepts/relationships",
              },
              { text: "Glossary", link: "/concepts/glossary" },
            ],
          },
        ],

        "/guides/": [
          {
            text: "Development",
            items: [
              {
                text: "Local Development",
                link: "/guides/local-development",
              },
              { text: "Testing", link: "/guides/testing" },
              {
                text: "Linting & Quality",
                link: "/guides/linting-and-quality",
              },
              {
                text: "Database Workflows",
                link: "/guides/database-workflows",
              },
            ],
          },
          {
            text: "Shipping",
            items: [
              { text: "New Project", link: "/guides/new-project" },
              { text: "Existing Project", link: "/guides/existing-project" },
              { text: "Deploying", link: "/guides/deploying" },
              { text: "Previews", link: "/guides/previews" },
              { text: "Releases", link: "/guides/releases" },
            ],
          },
          {
            text: "Infrastructure",
            items: [
              {
                text: "Managing Infrastructure",
                link: "/guides/infrastructure",
              },
              {
                text: "Secrets & Config",
                link: "/guides/secrets-and-config",
              },
            ],
          },
          {
            text: "Platform",
            items: [
              { text: "Software Catalog", link: "/guides/catalog" },
              { text: "AI Agents", link: "/guides/agents" },
            ],
          },
        ],

        "/cli/": [
          {
            text: "CLI Reference",
            items: [{ text: "Overview", link: "/cli/" }],
          },
          {
            text: "Inner Loop",
            collapsed: false,
            items: [
              { text: "dx up", link: "/cli/up" },
              { text: "dx dev", link: "/cli/dev" },
              { text: "dx down", link: "/cli/down" },
              { text: "dx status", link: "/cli/status" },
              { text: "dx test", link: "/cli/test" },
              { text: "dx lint", link: "/cli/lint" },
              { text: "dx check", link: "/cli/check" },
              { text: "dx logs", link: "/cli/logs" },
              { text: "dx exec", link: "/cli/exec" },
            ],
          },
          {
            text: "Shipping",
            collapsed: false,
            items: [
              { text: "dx deploy", link: "/cli/deploy" },
              { text: "dx preview", link: "/cli/preview" },
              { text: "dx release", link: "/cli/release" },
            ],
          },
          {
            text: "Infrastructure",
            collapsed: false,
            items: [
              { text: "dx infra", link: "/cli/infra" },
              { text: "dx fleet", link: "/cli/fleet" },
              { text: "dx ssh", link: "/cli/ssh" },
              { text: "dx tunnel", link: "/cli/tunnel" },
              { text: "dx scan", link: "/cli/scan" },
              { text: "dx cluster", link: "/cli/cluster" },
            ],
          },
          {
            text: "Data & Config",
            collapsed: false,
            items: [
              { text: "dx db", link: "/cli/db" },
              { text: "dx env", link: "/cli/env" },
            ],
          },
          {
            text: "Catalog & Project",
            collapsed: false,
            items: [
              { text: "dx catalog", link: "/cli/catalog" },
              { text: "dx open", link: "/cli/open" },
              { text: "dx route", link: "/cli/route" },
              { text: "dx workbench", link: "/cli/workbench" },
            ],
          },
        ],

        "/api/": [
          {
            text: "API Reference",
            items: [
              { text: "Overview", link: "/api/" },
              { text: "org", link: "/api/org" },
              { text: "software", link: "/api/software" },
              { text: "infra", link: "/api/infra" },
              { text: "ops", link: "/api/ops" },
              { text: "build", link: "/api/build" },
              { text: "commerce", link: "/api/commerce" },
            ],
          },
        ],

        "/architecture/": [
          {
            text: "Architecture",
            items: [
              { text: "Overview", link: "/architecture/" },
              { text: "Schema Design", link: "/architecture/schemas" },
              {
                text: "Catalog System",
                link: "/architecture/catalog-system",
              },
              { text: "Reconciler", link: "/architecture/reconciler" },
              {
                text: "Connection Contexts",
                link: "/architecture/connection-contexts",
              },
              {
                text: "Deployment Model",
                link: "/architecture/deployment-model",
              },
            ],
          },
        ],
      },

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
