import {defineConfig,devices} from '@playwright/test';
export default defineConfig({
  testDir:'tests/e2e',timeout:90000,expect:{timeout:30000},workers:1,
  reporter:[['list'],['html',{outputFolder:'tmp/e2e/playwright-report',open:'never'}]],
  outputDir:'tmp/e2e/test-results',
  use:{baseURL:`http://127.0.0.1:${process.env.E2E_FRONTEND_PORT||1430}`,trace:'retain-on-failure',screenshot:'only-on-failure'},
  projects:[{name:'chromium-tablet',use:{...devices['iPad Pro 11'],browserName:'chromium',launchOptions:process.env.E2E_CHROMIUM_EXECUTABLE?{executablePath:process.env.E2E_CHROMIUM_EXECUTABLE}:undefined}},{name:'webkit-ipad',use:{...devices['iPad Pro 11'],browserName:'webkit'}}],
  webServer:{command:'node scripts/e2e-server.mjs',url:`http://127.0.0.1:${process.env.E2E_FRONTEND_PORT||1430}`,timeout:180000,reuseExistingServer:false},
});
