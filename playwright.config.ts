import { defineConfig } from '@playwright/test'

export default defineConfig({
  testDir: './tests',
  timeout: 60000,
  use: {
    baseURL: process.env.ATLAS_TEST_URL || 'http://127.0.0.1:4317/world-map/',
    channel: process.env.ATLAS_CHROME_CHANNEL || undefined,
    viewport: { width: 1200, height: 800 },
  },
  webServer: process.env.ATLAS_TEST_URL
    ? undefined
    : {
        command:
          'npm run preview -- --host 127.0.0.1 --port 4317 --strictPort --base /world-map/',
        url: 'http://127.0.0.1:4317/world-map/',
        reuseExistingServer: !process.env.CI,
      },
})
