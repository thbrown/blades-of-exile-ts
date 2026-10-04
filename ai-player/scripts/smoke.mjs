/**
 * Drives the MCP server the way Claude Code would — over stdio, through the
 * SDK's client — and checks each tool does something sensible. Headless, on
 * a throwaway browser profile. Needs the game reachable at EXILE_URL (or it
 * starts `npx vite` itself).
 *
 *   node ai-player/scripts/smoke.mjs          (SHOW=1 prints every observation)
 */

import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const profile = mkdtempSync(join(tmpdir(), 'exile-ai-smoke-'));
const transport = new StdioClientTransport({
  command: 'node',
  args: [join(HERE, '..', 'server', 'server.mjs')],
  env: { ...process.env, EXILE_HEADLESS: process.env.EXILE_HEADLESS ?? '1', EXILE_PROFILE: profile },
});
const client = new Client({ name: 'smoke', version: '1.0.0' });
await client.connect(transport);

const failures = [];
const check = (what, ok, detail) => {
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${what}${ok || detail === undefined ? '' : `\n${detail}`}`);
  if (!ok) failures.push(what);
};
const call = async (name, args = {}) => {
  const res = await client.callTool({ name, arguments: args });
  const t = res.content.filter((c) => c.type === 'text').map((c) => c.text).join('\n');
  if (process.env.SHOW) console.log(`--- ${name} ${JSON.stringify(args)}\n${t}\n`);
  return { res, t };
};

try {
  const tools = (await client.listTools()).tools.map((t) => t.name);
  check('the server lists its tools', ['observe', 'screenshot', 'press', 'move', 'choose', 'start_game'].every((n) => tools.includes(n)), tools.join(' '));

  let r = await call('observe');
  check('with no game, it shows the main menu', r.t.includes('MAIN MENU'), r.t);

  r = await call('start_game', { scenario: 'valleydy', seed: 1 });
  // A scenario can open with a message; answer whatever is up until the town shows.
  for (let i = 0; i < 6 && !/== (TOWN|OUTDOORS)/.test(r.t); i++) {
    const name = /\[([^\]]+)\]/.exec(r.t.split('Choices:')[1] ?? '')?.[1] ?? 'okay';
    r = await call('choose', { name });
  }
  check('a new game reaches the town', /== TOWN/.test(r.t), r.t);
  check('the view has a map, a legend and the party', r.t.includes('y=') && r.t.includes('Legend:') && r.t.includes('@')
    && r.t.includes('Party ('), r.t);
  check('it lists the toolbar and a pack', r.t.includes('Toolbar: MAGE') && r.t.includes("pack"), r.t);

  const at = (t) => /centred on \((\d+),(\d+)\)/.exec(t)?.slice(1).join(',');
  const start = at(r.t);
  r = await call('move', { direction: 'east', steps: 1 });
  check('move walks the party', at(r.t) !== start, `${start} -> ${at(r.t)}\n${r.t}`);

  r = await call('press', { keys: ['l'] });
  check('l starts looking', /AIMING|Look|look/.test(r.t), r.t);
  r = await call('press', { keys: ['Escape'] });

  r = await call('press', { keys: ['m'] });
  check('m opens the spell picker, listed', r.t.includes('CHOOSING A SPELL') && r.t.includes('[spell1]'), r.t);
  r = await call('choose', { name: 'cancel' });
  check('cancel closes it', !r.t.includes('CHOOSING A SPELL'), r.t);

  r = await call('toolbar', { button: 'LOOK' });
  check('a toolbar button by name', !r.t.startsWith('No LOOK'), r.t);
  await call('press', { keys: ['Escape'] });

  r = await call('item', { slot: 1, button: 'info' });
  check('an inventory button opens the item sheet', r.t.includes('DIALOG'), r.t);
  const close = /\[(done|okay|ok)\]/i.exec(r.t)?.[1] ?? 'done';
  r = await call('choose', { name: close });
  check('and closes', !r.t.startsWith('== DIALOG'), r.t);

  const shot = await call('screenshot');
  const img = shot.res.content.find((c) => c.type === 'image');
  check('a screenshot comes back as a PNG', img?.mimeType === 'image/png' && img.data.length > 1000);
  if (img && process.env.SHOTS_DIR) writeFileSync(join(process.env.SHOTS_DIR, 'ai-smoke.png'), Buffer.from(img.data, 'base64'));

  r = await call('checkpoint', { note: 'smoke test' });
  check('checkpoint saves', r.t.includes('Saved.'), r.t);
} finally {
  await client.close();
  rmSync(profile, { recursive: true, force: true });
}
console.log(failures.length ? `FAILED: ${failures.length}` : 'PASS');
process.exit(failures.length ? 1 : 0);
