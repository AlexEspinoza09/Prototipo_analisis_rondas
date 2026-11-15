import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [react()],
  server: {
    host: true,
    port: 5173,
    // File-change events from a Windows bind mount never reach the Docker
    // container, so Vite must poll or it keeps serving stale modules.
    watch: { usePolling: true, interval: 300 },
  },
});
