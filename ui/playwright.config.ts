import { defineConfig, devices } from "@playwright/test"

const isCI = !!process.env.CI
const env = process.env.NODE_ENV?.trim()
const deploymentURL = process.env.DEPLOYMENT_URL
const baseURL = deploymentURL
  ? deploymentURL
  : env === "dev"
    ? "http://localhost:3000/"
    : "https://smartmarket.ai/"

console.log(`Running tests on ${baseURL}`)

export default defineConfig({
  timeout: 1000 * 100,
  workers: isCI ? 6 : 2,
  retries: 0,
  forbidOnly: isCI,

  outputDir: ".test/spec/output",
  snapshotPathTemplate:
    ".test/spec/snaps/{projectName}/{testFilePath}/{arg}{ext}",
  testMatch: "*.spec.{ts,tsx}",
  use: {
    baseURL,
  },
  reporter: [
    [
      "html",
      {
        outputFolder: ".test/spec/results",
        open: "never",
      },
    ],
    isCI ? ["github"] : ["line"],
  ],
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
  expect: {
    toHaveScreenshot: { maxDiffPixelRatio: 0.01 },
  },
})
