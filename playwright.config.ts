import { defineConfig, devices } from '@playwright/test';

// Default: SwiftShader software WebGL (works on any CI machine). FREESKI_GPU=1 runs the same tests in the
// installed Microsoft Edge on the real GPU (machines where SwiftShader is too slow for the timing-based checks).
const realGpu = process.env.FREESKI_GPU === '1';
const gpuArgs = realGpu
  ? ['--ignore-gpu-blocklist']
  : ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'];
const channel = realGpu ? { channel: 'msedge' } : {};

/**
 * Two projects: the production preview build and the Vite dev server. The dev server runs React
 * StrictMode (double-mounted effects), which is where the blank-viewport bug lived, so rendering tests
 * run against both.
 */
export default defineConfig({
  testDir: './e2e',
  timeout: 120_000,
  expect: { timeout: 20_000 },
  fullyParallel: false,
  workers: 1,
  reporter: 'list',
  use: { viewport: { width: 1280, height: 720 } },
  projects: [
    {
      name: 'preview',
      use: {
        ...devices['Desktop Chrome'],
        baseURL: 'http://localhost:4173',
        ...channel,
        launchOptions: { args: gpuArgs },
      },
    },
    {
      name: 'dev',
      testMatch: /rendering\.spec\.ts/,
      use: {
        ...devices['Desktop Chrome'],
        baseURL: 'http://localhost:5173',
        ...channel,
        launchOptions: { args: gpuArgs },
      },
    },
  ],
  webServer: [
    {
      command: 'npm run build && npm run preview -- --port 4173 --strictPort',
      url: 'http://localhost:4173',
      reuseExistingServer: !process.env.CI,
      timeout: 180_000,
    },
    {
      command: 'npx vite --port 5173 --strictPort',
      url: 'http://localhost:5173',
      reuseExistingServer: !process.env.CI,
      timeout: 120_000,
    },
  ],
});
