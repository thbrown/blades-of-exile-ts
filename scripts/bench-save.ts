/**
 * Cost of one save: the main-thread serialise, then gzip at several levels,
 * the size, and how much a second save a few moves later differs from the first.
 * Run: npx vite-node scripts/bench-save.ts [scenario-dir-name]
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'fflate';
import { GameRng } from '../src/core/rng';
import { loadScenario } from '../src/fileio/loadScenario';
import { serialiseSave } from '../src/fileio/saveIo';
import { FsSource } from '../src/fileio/source';
import { buildOpcodeTable } from '../src/fileio/specialParse';
import { GameSession } from '../src/game/session';
import { PartyPreset } from '../src/universe/player';
import { Universe } from '../src/universe/universe';

const id = process.argv[2] ?? 'valleydy';
const opcodes = buildOpcodeTable(
  readFileSync(new URL('../public/data/strings/specials-opcodes.txt', import.meta.url), 'utf8'));
const scen = await loadScenario(
  new FsSource(fileURLToPath(new URL(`../public/scenarios/${id}`, import.meta.url))), opcodes);
const session = new GameSession(new Universe(scen, new GameRng(), PartyPreset.DEFAULT));
await session.startNewGame();

const time = <T>(f: () => T, n = 30): { ms: number; v: T } => {
  let v!: T;
  const t0 = performance.now();
  for (let i = 0; i < n; i++) v = f();
  return { ms: (performance.now() - t0) / n, v };
};

const ser = time(() => serialiseSave(session.univ).serialise());
const raw = ser.v;
console.log(`scenario ${id}: raw ${(raw.length / 1024).toFixed(0)} KB, serialise (main thread) ${ser.ms.toFixed(2)} ms`);
for (const level of [1, 3, 6] as const) {
  const g = time(() => gzipSync(raw, { level }), 10);
  console.log(`  gzip level ${level}: ${g.ms.toFixed(2)} ms -> ${(g.v.length / 1024).toFixed(1)} KB`);
}
// A later save: the world has moved a little.
session.univ.party.age += 10;
const raw2 = serialiseSave(session.univ).serialise();
let same = 0;
for (let i = 0; i < Math.min(raw.length, raw2.length); i++) if (raw[i] === raw2[i]) same++;
console.log(`  after 10 ticks: ${(same / raw.length * 100).toFixed(1)}% of bytes unchanged in place`);
