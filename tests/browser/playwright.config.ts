import { defineConfig, devices } from "@playwright/test";
import { users } from "./users.ts";

// Browser tests of the web shell against the composed stack (fake LLM
// provider). `task e2e:browser` starts the stack and runs them; with
// KB_E2E_WEB set they test that running web shell instead.
const baseURL = process.env.KB_E2E_WEB ?? `http://localhost:${process.env.KB_WEB_PORT ?? "22300"}`;

export default defineConfig({
  testDir: ".",
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: [[process.env.CI ? "github" : "list"], ["html", { open: "never" }]],
  timeout: 60_000,
  expect: { timeout: 15_000 },
  use: {
    baseURL,
    // A failed test keeps its trace (DOM snapshots, network, console) and a screenshot.
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  projects: [
    // Signs every test user in through Dex once per run (auth.setup.ts).
    { name: "setup", testMatch: /auth\.setup\.ts$/ },
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"], storageState: users.alice.storageState },
      dependencies: ["setup"],
    },
  ],
});
