import { defineConfig } from "@playwright/test";
export default defineConfig({
  testDir: "./tests/browser",
  workers: 1,
  use: {
    launchOptions: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE
      ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE }
      : {},
    baseURL: "http://127.0.0.1:5173",
    viewport: { width: 1440, height: 1100 },
  },
  webServer: [
    {
      command: "node tests/browser/serve.mjs",
      url: "http://127.0.0.1:4317/api/exercises",
      reuseExistingServer: false,
    },
    {
      command: "pnpm --dir packages/web dev",
      url: "http://127.0.0.1:5173",
      reuseExistingServer: false,
    },
  ],
});
