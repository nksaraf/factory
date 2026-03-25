const path = require("path")
const config = require("@rio.js/tailwindcss3")
/** @type {import('tailwindcss').Config} */
const anotherConfig = require("./src/tailwind.v3")

function source(pkg, extensions = ["ts", "tsx"]) {
  return [
    `${path.join(
      path.dirname(require.resolve(pkg)),
      `**/*.${
        extensions.length > 1 ? `{${extensions.join(",")}}` : extensions[0]
      }`
    )}`,
    `!${path.join(
      path.dirname(require.resolve(pkg)),
      `./node_modules/**/*.${
        extensions.length > 1 ? `{${extensions.join(",")}}` : extensions[0]
      }`
    )}`,
  ]
}

module.exports = {
  content: {
    files: [
      "./index.html",
      ...source("@rio.js/ui", ["tsx"]),
      ...source("@rio.js/app-ui", ["tsx"]),
      ...source("@rio.js/table-ui", ["tsx"]),
      ...source("@rio.js/gis-ui", ["tsx"]),
      ...source("@rio.js/auth-ui", ["tsx"]),
      ...source("@rio.js/datalake-ui", ["tsx"]),
      ...source("@rio.js/workflows-ui", ["tsx"]),
      ...source("@rio.js/agents-ui", ["tsx"]),
      ...source("@rio.js/gis.flows", ["tsx", "json"]),
      ...source("@rio.js/agents.core", ["tsx", "json"]),
      ...source("@rio.js/gis.core", ["tsx", "json"]),
      ...source("@rio.js/auth.core", ["tsx", "json"]),
      ...source("@rio.js/app.core", ["tsx", "json"]),
      ...source("@rio.js/settings.user", ["tsx", "json"]),
      ...source("@rio.js/settings.organization", ["tsx", "json"]),
      // ...source("@rio.js/enterprise.core", ["tsx", "json"]),
      ...source("streamdown", ["js", "tsx"]),
      "./src/**/*.{ts,tsx,json}",
    ],
    transform: {
      json: (content) =>
        `export default ${JSON.stringify(JSON.parse(content))}`,
    },
  },
  darkMode: ["class"],
  // theme: {
  //   extend: {
  //     colors: {
  //       border: "hsl(var(--border))",
  //       input: "hsl(var(--input))",
  //       ring: "hsl(var(--ring))",
  //       background: "hsl(var(--background))",
  //       foreground: "hsl(var(--foreground))",
  //       primary: {
  //         DEFAULT: "hsl(var(--primary))",
  //         foreground: "hsl(var(--primary-foreground))",
  //       },
  //       secondary: {
  //         DEFAULT: "hsl(var(--secondary))",
  //         foreground: "hsl(var(--secondary-foreground))",
  //       },
  //       destructive: {
  //         DEFAULT: "hsl(var(--destructive))",
  //         foreground: "hsl(var(--destructive-foreground))",
  //       },
  //       muted: {
  //         DEFAULT: "hsl(var(--muted))",
  //         foreground: "hsl(var(--muted-foreground))",
  //       },
  //       accent: {
  //         DEFAULT: "hsl(var(--accent))",
  //         foreground: "hsl(var(--accent-foreground))",
  //       },
  //       popover: {
  //         DEFAULT: "hsl(var(--popover))",
  //         foreground: "hsl(var(--popover-foreground))",
  //       },
  //       card: {
  //         DEFAULT: "hsl(var(--card))",
  //         foreground: "hsl(var(--card-foreground))",
  //       },
  //       sidebar: {
  //         DEFAULT: "hsl(var(--sidebar))",
  //         foreground: "hsl(var(--sidebar-foreground))",
  //         primary: "hsl(var(--sidebar-primary))",
  //         "primary-foreground": "hsl(var(--sidebar-primary-foreground))",
  //         accent: "hsl(var(--sidebar-accent))",
  //         "accent-foreground": "hsl(var(--sidebar-accent-foreground))",
  //         border: "hsl(var(--sidebar-border))",
  //         ring: "hsl(var(--sidebar-ring))",
  //       },
  //       chart: {
  //         1: "hsl(var(--chart-1))",
  //         2: "hsl(var(--chart-2))",
  //         3: "hsl(var(--chart-3))",
  //         4: "hsl(var(--chart-4))",
  //         5: "hsl(var(--chart-5))",
  //       },
  //     },
  //     borderRadius: {
  //       xl: "calc(var(--radius) + 4px)",
  //       lg: "var(--radius)",
  //       md: "calc(var(--radius) - 2px)",
  //       sm: "calc(var(--radius) - 4px)",
  //     },
  //     fontFamily: {
  //       sans: ["var(--font-sans)"],
  //       serif: ["var(--font-serif)"],
  //       mono: ["var(--font-mono)"],
  //     },
  //   },
  // },
  ...anotherConfig,
  plugins: [
    ...(anotherConfig.plugins || []),
    require("@tailwindcss/typography"),
  ],
}
