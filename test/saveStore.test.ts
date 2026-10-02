import 'fake-indexeddb/auto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { beforeAll, describe, expect, it } from 'vitest';
import { GameRng } from '../src/core/rng';
import { Scenario } from '../src/data/scenario';
import { loadScenario } from '../src/fileio/loadScenario';
import { previewOfUniverse, readSavePreview, saveGame } from '../src/fileio/saveIo';
import { FsSource } from '../src/fileio/source';
import { buildOpcodeTable } from '../src/fileio/specialParse';
import { GameSession } from '../src/game/session';
import {
  SnapInput, appendSnapshot, createTree, deleteBranch, deleteTree, getAllSnapshots, getPartyInMemory,
  getSnapshot, importTree, listTrees, listSnaps, renameTree, setHead, setPartyInMemory,
} from '../src/platform/saveStore';
import { isZip, treeFromZip, treeToZip } from '../src/platform/saveZip';
import { PartyPreset } from '../src/universe/player';
import { Universe } from '../src/universe/universe';

const opcodes = buildOpcodeTable(
  readFileSync(new URL('../public/data/strings/specials-opcodes.txt', import.meta.url), 'utf8'),
);

let scen: Scenario;
let univ: Universe;

beforeAll(async () => {
  scen = await loadScenario(
    new FsSource(fileURLToPath(new URL('../public/scenarios/valleydy', import.meta.url))), opcodes);
  const session = new GameSession(new Universe(scen, new GameRng(), PartyPreset.DEFAULT));
  await session.startNewGame();
  univ = session.univ;
});

/** A save at a given game age. */
function snap(age: number, kind: SnapInput['kind'] = 'auto'): SnapInput {
  univ.party.age = age;
  return { data: saveGame(univ), preview: previewOfUniverse(univ), kind, reason: 'Test' };
}

describe('previewOfUniverse', () => {
  it('matches what reading the saved bytes back gives', () => {
    const bytes = saveGame(univ);
    expect(previewOfUniverse(univ)).toEqual(readSavePreview(bytes));
  });
});

describe('the tree store', () => {
  it('appends children of the head and moves it on', async () => {
    const { tree } = await createTree('Test', snap(0, 'manual'));
    for (let i = 1; i <= 3; i++) await appendSnapshot(tree.id, snap(i * 100));
    const snaps = await listSnaps(tree.id);
    expect(snaps.map((s) => [s.seq, s.parent])).toEqual([[1, null], [2, 1], [3, 2], [4, 3]]);
    expect((await listTrees()).find((s) => s.id === tree.id)?.head).toBe(4);
    const bytes = await getSnapshot(tree.id, 3);
    expect(readSavePreview(bytes!).age).toBe(200);
  });

  it('restoring then saving makes a branch, and nothing is lost', async () => {
    const { tree } = await createTree('Branchy', snap(0, 'manual'));
    for (let i = 1; i <= 4; i++) await appendSnapshot(tree.id, snap(i * 100));
    await setHead(tree.id, 3); // go back
    await appendSnapshot(tree.id, snap(350));
    const snaps = await listSnaps(tree.id);
    expect(snaps).toHaveLength(6);
    expect(snaps.filter((s) => s.parent === 3).map((s) => s.seq).sort()).toEqual([4, 6]);
  });

  it('thins a long history but keeps root and head, and stays under budget', async () => {
    const { tree } = await createTree('Long', snap(0, 'manual'));
    const input = snap(0);
    for (let i = 1; i <= 120; i++) {
      await appendSnapshot(tree.id, { ...input, preview: { ...input.preview, age: i * 200 } }, 40 * input.data.length);
    }
    const snaps = await listSnaps(tree.id);
    const info = (await listTrees()).find((s) => s.id === tree.id)!;
    expect(snaps.length).toBeLessThan(60);
    expect(snaps[0]!.parent).toBeNull();
    expect(snaps.some((s) => s.seq === info.head)).toBe(true);
    expect(info.bytes).toBe(snaps.reduce((sum, s) => sum + s.bytes, 0));
    // Connected: every parent exists.
    const ids = new Set(snaps.map((s) => s.seq));
    for (const s of snaps) if (s.parent !== null) expect(ids.has(s.parent)).toBe(true);
  });

  it('deletes an abandoned branch but not the lineage being played', async () => {
    const { tree } = await createTree('Prune', snap(0, 'manual'));
    for (let i = 1; i <= 3; i++) await appendSnapshot(tree.id, snap(i * 100));
    await setHead(tree.id, 2);
    await appendSnapshot(tree.id, snap(250)); // seq 5, child of 2; head
    await expect(deleteBranch(tree.id, 5)).rejects.toThrow();
    expect(await deleteBranch(tree.id, 3)).toBe(2); // 3 and 4
    expect((await listSnaps(tree.id)).map((s) => s.seq)).toEqual([1, 2, 5]);
  });

  it('renames and deletes a tree', async () => {
    const { tree } = await createTree('Old name', snap(0, 'manual'));
    await renameTree(tree.id, 'New name');
    expect((await listTrees()).find((s) => s.id === tree.id)?.name).toBe('New name');
    await deleteTree(tree.id);
    expect((await listTrees()).find((s) => s.id === tree.id)).toBeUndefined();
    expect(await getSnapshot(tree.id, 1)).toBeNull();
  });

  it('holds the party in memory apart from the tree', async () => {
    expect(await getPartyInMemory()).toBeNull();
    await setPartyInMemory(saveGame(univ, true));
    expect(await getPartyInMemory()).not.toBeNull();
    await setPartyInMemory(null);
    expect(await getPartyInMemory()).toBeNull();
  });
});

describe('tree zip', () => {
  it('round-trips a tree, branches included', async () => {
    const { tree } = await createTree('Zipped', snap(0, 'manual'));
    for (let i = 1; i <= 3; i++) await appendSnapshot(tree.id, snap(i * 100, i === 2 ? 'milestone' : 'auto'));
    await setHead(tree.id, 2);
    await appendSnapshot(tree.id, snap(250));
    const snaps = await listSnaps(tree.id);
    const info = (await listTrees()).find((s) => s.id === tree.id)!;
    const zip = treeToZip(info, snaps, await getAllSnapshots(tree.id));
    expect(isZip(zip)).toBe(true);
    const parsed = treeFromZip(zip, 'fallback')!;
    expect(parsed.name).toBe('Zipped');
    expect(parsed.head).toBe(info.head);
    expect(parsed.nodes.map((n) => [n.seq, n.parent, n.kind])).toEqual(snaps.map((s) => [s.seq, s.parent, s.kind]));
    const imported = await importTree(parsed.name, parsed.scenarioId, parsed.nodes, parsed.head);
    expect((await listSnaps(imported.id)).map((s) => [s.seq, s.parent])).toEqual(snaps.map((s) => [s.seq, s.parent]));
    // And it carries on from where it was.
    const next = await appendSnapshot(imported.id, snap(400));
    expect(next.snap.seq).toBe(info.nextSeq);
    expect(next.snap.parent).toBe(info.head);
  });

  it('turns a plain zip of saves into a straight line, oldest first', async () => {
    const { zipSync } = await import('fflate');
    const a = snap(500).data;
    const b = snap(100).data;
    const zip = zipSync({ 'late.exg': a, 'early.exg': b, 'notes.txt': new Uint8Array([1, 2]) });
    const parsed = treeFromZip(zip, 'Folder')!;
    expect(parsed.nodes.map((n) => n.preview.age)).toEqual([100, 500]);
    expect(parsed.nodes.map((n) => n.parent)).toEqual([null, 1]);
    expect(parsed.name).toBe('Folder');
  });

  it('refuses things that are not saves', () => {
    expect(treeFromZip(new Uint8Array([1, 2, 3, 4, 5]), 'x')).toBeNull();
  });
});
