import { cpSync, createReadStream, existsSync, readdirSync, rmSync, statSync } from 'node:fs';
import { extname, join, normalize } from 'node:path';
import type { Plugin } from 'vite';
import { defineConfig } from 'vitest/config';
import { exile3ConversionVersion } from './tools/e3convert/version';

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
 * Exile III on the published site. The converted copy is a modified one of
 * Spiderweb's game, and its licence lets it be redistributed only unaltered
 * (vendor/exile3/README.md), so the build leaves `scenarios/exile3/` out and
 * ships the installer as it is, at `exile3/`, with its README; the player's
 * browser converts it (src/platform/exile3.ts). The dev server serves the
 * installer at the same path, for trying that route locally.
 */
function exile3Installer(): Plugin {
  const vendor = join(process.cwd(), 'vendor', 'exile3');
  let outDir = 'docs';
  return {
    name: 'exile3-installer',
    configResolved(config) { outDir = config.build.outDir; },
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const path = (req.url ?? '').split('?')[0]!;
        if (!path.endsWith('/exile3/EXL3INST.EXE')) { next(); return; }
        res.setHeader('Content-Type', 'application/octet-stream');
        createReadStream(join(vendor, 'EXL3INST.EXE')).pipe(res);
      });
    },
    closeBundle() {
      if (!existsSync(join(process.cwd(), outDir))) return;
      rmSync(join(process.cwd(), outDir, 'scenarios', 'exile3'), { recursive: true, force: true });
      // The installer goes beside the Exile III pages (exile3/*.html), so
      // only its own files are replaced, not the whole directory.
      const to = join(process.cwd(), outDir, 'exile3');
      for (const f of readdirSync(vendor)) rmSync(join(to, f), { recursive: true, force: true });
      cpSync(vendor, to, { recursive: true });
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
  plugins: [devLibrary(), embedLibrary(), exile3Installer()],
  define: { __EXILE3_VERSION__: JSON.stringify(exile3ConversionVersion()) },
  build: {
    outDir: 'docs',
    // The game, and the two Exile III reference pages (src/pages/).
    rollupOptions: {
      input: {
        main: join(process.cwd(), 'index.html'),
        // Under exile3/, in case other scenarios get pages of their own.
        items: join(process.cwd(), 'exile3', 'items.html'),
        map: join(process.cwd(), 'exile3', 'map.html'),
      },
    },
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
