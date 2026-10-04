import { createHash } from 'node:crypto';
import {
  cpSync, createReadStream, existsSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync,
} from 'node:fs';
import { extname, join, normalize, relative, resolve, sep } from 'node:path';
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
    configResolved(config) { outDir = resolve(config.root, config.build.outDir); },
    closeBundle() {
      if (process.env['VITE_LIBRARY_URL']) return;
      const to = join(outDir, 'library');
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
    configResolved(config) { outDir = resolve(config.root, config.build.outDir); },
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const path = (req.url ?? '').split('?')[0]!;
        if (!path.endsWith('/exile3/EXL3INST.EXE')) { next(); return; }
        res.setHeader('Content-Type', 'application/octet-stream');
        createReadStream(join(vendor, 'EXL3INST.EXE')).pipe(res);
      });
    },
    closeBundle() {
      if (!existsSync(outDir)) return;
      rmSync(join(outDir, 'scenarios', 'exile3'), { recursive: true, force: true });
      // The installer goes beside the Exile III pages (exile3/*.html), so
      // only its own files are replaced, not the whole directory.
      const to = join(outDir, 'exile3');
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

/**
 * The service worker that makes the published site an offline-capable PWA
 * (src/platform/serviceWorker.js says what it caches and why). After a build,
 * it lists every file in the output that a player needs without a network —
 * all of it except the library's previews and scenario zips and the Exile III
 * installer, which are large and fetched only on demand, and the bundled
 * scenarios, each cached whole once played (only the `scenario.xml` and
 * `preview.png` the startup screen shows are precached). It writes the
 * worker to `<outDir>/sw.js` with those lists, each scenario's files under a
 * hash of their contents, and a version hashed from every file and the
 * worker's own source, so a build that changes any of them installs afresh.
 *
 * Must come after `embedLibrary()` and `exile3Installer()` in `plugins`: it
 * lists what their `closeBundle` hooks (synchronous, so run in order) leave.
 */
function serviceWorker(): Plugin {
  const source = join(process.cwd(), 'src', 'platform', 'serviceWorker.js');
  const onDemand = [/^library\/files\//, /^library\/previews\//, /^exile3\/EXL3INST\.EXE$/];
  const scenarioFile = /^scenarios\/([^/]+)\/(.+)$/;
  const startupScreen = new Set(['scenario.xml', 'preview.png']);
  const sha = (data: string | Buffer): string => createHash('sha256').update(data).digest('hex').slice(0, 16);
  let root = '';
  return {
    name: 'service-worker',
    apply: 'build',
    configResolved(config) { root = resolve(config.root, config.build.outDir); },
    closeBundle() {
      if (!existsSync(root)) return;
      const files: string[] = [];
      const scenarios: Record<string, { hash: string; files: string[] }> = {};
      const scenarioHashes: Record<string, string[]> = {};
      const walk = (dir: string): void => {
        for (const name of readdirSync(dir).sort()) {
          const full = join(dir, name);
          if (statSync(full).isDirectory()) { walk(full); continue; }
          const path = relative(root, full).split(sep).join('/');
          if (path === 'sw.js' || onDemand.some((re) => re.test(path))) continue;
          const [, id, file] = scenarioFile.exec(path) ?? [];
          if (id && file && !startupScreen.has(file)) {
            (scenarios[id] ??= { hash: '', files: [] }).files.push(file);
            (scenarioHashes[id] ??= []).push(`${file}\0${sha(readFileSync(full))}`);
            continue;
          }
          files.push(path);
        }
      };
      walk(root);
      for (const [id, entry] of Object.entries(scenarios)) entry.hash = sha(scenarioHashes[id]!.join('\n'));
      const template = readFileSync(source, 'utf8');
      const hash = createHash('sha256').update(template);
      for (const f of files) hash.update(f).update('\0').update(readFileSync(join(root, f)));
      for (const [id, entry] of Object.entries(scenarios)) hash.update(`${id}\0${entry.hash}`);
      const worker = template
        .replace('__SW_VERSION__', () => hash.digest('hex').slice(0, 16))
        .replace('__SW_PRECACHE__', () => JSON.stringify(files))
        .replace('__SW_SCENARIOS__', () => JSON.stringify(scenarios));
      writeFileSync(join(root, 'sw.js'), worker);
    },
  };
}

export default defineConfig(({ command }) => ({
  // GitHub Pages serves this repo at /blades-of-exile-ts/; keep the dev server at root
  // so local URLs (and verify-screen.mjs) don't need to change.
  base: command === 'build' ? '/blades-of-exile-ts/' : '/',
  plugins: [devLibrary(), embedLibrary(), exile3Installer(), serviceWorker()],
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
