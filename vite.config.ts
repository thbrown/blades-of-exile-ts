import { cpSync, createReadStream, existsSync, rmSync, statSync } from 'node:fs';
import { extname, join, normalize } from 'node:path';
import type { Plugin } from 'vite';
import { defineConfig } from 'vitest/config';

/**
 * The scenario library ships inside the site for now: a build copies
 * `library/dist` to `<outDir>/library/`, where the game looks by default.
 * When `VITE_LIBRARY_URL` names a bucket instead, nothing is copied — that is
 * the whole switch-over.
 */
function embedLibrary(): Plugin {
  const from = join(process.cwd(), 'library', 'dist');
  let outDir = 'docs';
  return {
    name: 'embed-library',
    apply: 'build',
    configResolved(config) { outDir = config.build.outDir; },
    closeBundle() {
      if (process.env['VITE_LIBRARY_URL']) return;
      const to = join(process.cwd(), outDir, 'library');
      rmSync(to, { recursive: true, force: true });
      if (!existsSync(join(from, 'catalog.json'))) {
        console.warn('No library/dist/catalog.json — the site will have no scenario library. '
          + 'Run scripts/fetch-archive.mjs and scripts/build-library.ts first.');
        return;
      }
      cpSync(from, to, { recursive: true });
    },
  };
}

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
  plugins: [devLibrary(), embedLibrary()],
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
