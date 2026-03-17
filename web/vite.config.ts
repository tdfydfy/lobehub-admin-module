import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, '.', '');
  const runtimeEnv = (globalThis as { process?: { env?: Record<string, string | undefined> } }).process?.env ?? {};
  const publicBase = runtimeEnv.VITE_PUBLIC_BASE?.trim() || env.VITE_PUBLIC_BASE?.trim() || '/';

  return {
    base: publicBase,
    plugins: [react()],
    build: {
      rollupOptions: {
        input: {
          main: 'index.html',
          databaseViewer: 'database-viewer.html',
        },
      },
    },
    server: {
      host: '127.0.0.1',
      port: 4173,
      strictPort: true,
    },
    preview: {
      host: '127.0.0.1',
      port: 4173,
      strictPort: true,
    },
  };
});
