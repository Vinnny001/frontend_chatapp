import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  build: {
    rollupOptions: {
      // bg.html: the encryption-only page Android uses for notifications (no UI).
      input: { main: 'index.html', bg: 'bg.html' },
    },
  },
  server: {
    port: 5173,
    host: true, // reachable from phones/emulators on the same network
  },
});
