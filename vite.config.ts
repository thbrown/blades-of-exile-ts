import { createReadStream, existsSync, statSync } from 'node:fs';
import { extname, join, normalize } from 'node:path';
import type { Plugin } from 'vite';
import { defineConfig } from 'vitest/config';

/**
 * In development, serve the scenario library `scripts/build-library.ts` built
 * (`library/dist/`, gitignored) at `/library/`, standing in for the bucket.
 * Production reads the bucket named by `VITE_LIBRARY_URL`.
 */
function devLibrary(): Plugin {
  const root = join(process.cwd(), 'library', 'dist');
  const types: Record<string, string> = { '.json': 'application/json', '.png': 'image/png', '.zip': 'application/zip' };
  return {
    name: 'dev-library',
    configureServer(server) {
      server.middlewares.use('/library/', (req, res, next) => {
        const path = normalize(join(root, decodeURIComponent((req.url ?? '').split('?')[0]!)));
        if (!path.startsWith(root) || !existsSync(path) || !statSync(path).isFile()) {
          res.statusCode = 404;
          res.end();
          return;
        }
        res.setHeader('Content-Type', types[extname(path).toLowerCase()] ?? 'application/octet-stream');
        createReadStream(path).on('error', next).pipe(res);
      });
    },
  };
}

export default defineConfig(({ command }) => ({
  // GitHub Pages serves this repo at /exile-js/; keep the dev server at root
  // so local URLs (and verify-screen.mjs) don't need to change.
  base: command === 'build' ? '/exile-js/' : '/',
  plugins: [devLibrary()],
  build: {
    outDir: 'docs',
  },
  server: {
    port: 5199,
  },
  test: {
    include: ['test/**/*.test.ts'],
    setupFiles: ['test/setup.ts'],
    // Several tests parse whole scenarios off disk (21 towns each); 5s is tight
    // on a loaded machine.
    testTimeout: 30000,
  },
}));
