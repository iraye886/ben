import path from 'path';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { defineConfig, loadEnv } from 'vite';

const port = Number(process.env.PORT || 5173);
const basePath = process.env.BASE_PATH || '/';
const apiUrl = process.env.API_URL || 'http://127.0.0.1:8080';
// The repo-root env files (e.g. `.env.development.local`) live two levels
// up from this workspace package, not in `artifacts/sme-management`.
const rootDir = path.resolve(import.meta.dirname, '..', '..');

export default defineConfig(({ mode }) => {
  // Loaded independently of `envDir` below so we can bridge the
  // `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` var (set by the Clerk integration)
  // to the `VITE_CLERK_PUBLISHABLE_KEY` name the app code expects.
  const rootEnv = loadEnv(mode, rootDir, '');
  const clerkPublishableKey =
    rootEnv.VITE_CLERK_PUBLISHABLE_KEY ||
    rootEnv.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY ||
    '';

  return {
    base: basePath,
    envDir: rootDir,
    define: {
      'import.meta.env.VITE_CLERK_PUBLISHABLE_KEY': JSON.stringify(clerkPublishableKey),
    },
    plugins: [
      react(),
      tailwindcss({ optimize: false }),
    ],
    resolve: {
      alias: {
        '@': path.resolve(import.meta.dirname, 'src'),
        '@assets': path.resolve(
          import.meta.dirname,
          '..',
          '..',
          'attached_assets',
        ),
      },
      dedupe: ['react', 'react-dom'],
    },
    root: path.resolve(import.meta.dirname),
    build: {
      outDir: path.resolve(import.meta.dirname, 'dist/public'),
      emptyOutDir: true,
    },
    server: {
      port,
      strictPort: true,
      host: '0.0.0.0',
      allowedHosts: true,
      proxy: {
        '/api': {
          target: apiUrl,
          changeOrigin: true,
        },
      },
      fs: {
        strict: true,
      },
    },
    preview: {
      port,
      host: '0.0.0.0',
      allowedHosts: true,
    },
  };
});
