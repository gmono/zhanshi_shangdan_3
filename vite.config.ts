import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import { rm } from 'node:fs/promises';

const host = process.env.TAURI_DEV_HOST;
export default defineConfig({
  plugins: [react(), { name: 'exclude-zoomify-from-frontend-bundle', closeBundle: async () => { await rm('dist/zoomify', { recursive: true, force: true }); } }],
  clearScreen: false,
  server: {
    host: host || '0.0.0.0', port: 1420, strictPort: true,
    hmr: host ? { protocol: 'ws', host, port: 1421 } : undefined,
    watch: { ignored: ['**/src-tauri/**', '**/public/zoomify/**', '**/assets/source-images/**', '**/tmp/**', '**/out/**'] },
  },
  test: { environment: 'node', include: ['src/**/*.test.ts'] },
});
