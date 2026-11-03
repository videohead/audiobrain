import { defineConfig, devices } from '@playwright/test';

/** Each app serves its production preview on its own port so both can run at once. */
const port = 5178;

const chromiumExecutablePath =
  process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH;

export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  reporter: 'list',
  use: {
    baseURL: `http://127.0.0.1:${port}`,
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    launchOptions: {
      ...(chromiumExecutablePath
        ? { executablePath: chromiumExecutablePath }
        : {}),
      // Supply Chromium's deterministic test camera. The application still has
      // to call getUserMedia from an explicit user action before it can start.
      args: [
        '--use-fake-device-for-media-stream',
        '--use-fake-ui-for-media-stream',
      ],
    },
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
  webServer: {
    command: 'npm run preview',
    port,
    reuseExistingServer: false,
  },
});
