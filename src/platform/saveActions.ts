/**
 * What a player can do with saved games beyond playing the newest — import,
 * export, browse the tree — shared by the startup screen and the in-game Load
 * command. Nothing here needs a running game.
 */

import { TOWN_NUM_OUTDOORS } from '../universe/party';
import { isE3Save } from '../fileio/e3save';
import { readSavePreview } from '../fileio/saveIo';
import {
  SnapInfo, createTree, deleteBranch, deleteSnapshot, deleteTree, downloadFile, getAllSnapshots, getTree,
  getSnapshot, importTree, listSnaps, maxAutoOf, setMaxAuto,
} from './saveStore';
import { isZip, treeFromZip, treeToZip } from './saveZip';
import { showSaveTree } from './saveTree';

/** A file-name-safe version of a game's name. */
const fileSafe = (name: string): string => name.replace(/[\\/:*?"<>|]+/g, '_').trim() || 'exile';

/** "Fort Talrus", or "Outdoors" — for a snapshot with no recorded place. */
export function placeOf(snap: Pick<SnapInfo, 'place' | 'townNum'>): string {
  if (snap.place !== '') return snap.place;
  return snap.townNum >= TOWN_NUM_OUTDOORS ? 'Outdoors' : `Town ${snap.townNum}`;
}

export type ImportOutcome = { treeId: string; scenarioId: string } | { error: string };

/**
 * Turn a file the player picked into a tree: a zip becomes the tree it
 * holds (or a line of saves, if it is just a folder of `.exg`s), and a single
 * save becomes a new tree of one — never merged into an existing game.
 */
export async function importAsTree(file: { name: string; data: Uint8Array }): Promise<ImportOutcome> {
  if (isZip(file.data)) {
    const parsed = treeFromZip(file.data, file.name);
    if (parsed === null) return { error: 'No saved games were found in that zip.' };
    const tree = await importTree(parsed.name, parsed.scenarioId, parsed.nodes, parsed.head);
    return { treeId: tree.id, scenarioId: tree.scenarioId };
  }
  if (isE3Save(file.data)) {
    return { error: 'That is an Exile III save. Start Exile III, then use File ▸ Open Game to open it.' };
  }
  let preview;
  try {
    preview = readSavePreview(file.data);
  } catch {
    return { error: 'That file is not a Blades of Exile saved game.' };
  }
  const name = file.name.trim() || preview.pcs.find((pc) => pc.name !== '')?.name || 'Imported game';
  const { tree } = await createTree(name, {
    data: file.data, preview, kind: 'manual', reason: 'Imported',
  });
  return { treeId: tree.id, scenarioId: tree.scenarioId };
}

export async function exportTreeZip(treeId: string): Promise<void> {
  const tree = await getTree(treeId);
  if (tree === null) return;
  const zip = treeToZip(tree, await listSnaps(treeId), await getAllSnapshots(treeId));
  downloadFile(`${fileSafe(tree.name)}.zip`, zip, 'application/zip');
}

export async function downloadSnapshot(treeId: string, seq: number): Promise<void> {
  const [tree, snaps, data] = await Promise.all([getTree(treeId), listSnaps(treeId), getSnapshot(treeId, seq)]);
  if (tree === null || data === null) return;
  const day = Math.floor((snaps.find((s) => s.seq === seq)?.gameAge ?? 0) / 3700) + 1;
  downloadFile(`${fileSafe(tree.name)} day ${day}.exg`, data);
}

/**
 * Show a game's tree, to restore from. Resolves with the snapshot the player
 * chose to restore, null if they closed it, or 'deleted' if they deleted the
 * whole game — which is only offered with `canDeleteGame` (the startup screen,
 * never the game being played). `scenarioTitle` is whatever the caller knows
 * the scenario as.
 */
export async function browseTree(
  treeId: string, scenarioTitle: string, canDeleteGame = false,
): Promise<number | null | 'deleted'> {
  const [tree, snaps] = await Promise.all([getTree(treeId), listSnaps(treeId)]);
  if (tree === null) return null;
  return new Promise((resolve) => {
    const view = showSaveTree(document.body, {
      treeName: tree.name,
      scenarioTitle,
      snaps,
      head: tree.head,
      maxAuto: maxAutoOf(tree),
      placeName: placeOf,
      restore: (seq) => { view.close(); resolve(seq); },
      download: (seq) => { void downloadSnapshot(treeId, seq); },
      exportTree: () => { void exportTreeZip(treeId); },
      deleteSnapshot: async (seq) => {
        await deleteSnapshot(treeId, seq);
        return listSnaps(treeId);
      },
      deleteBranch: async (seq) => {
        await deleteBranch(treeId, seq);
        return listSnaps(treeId);
      },
      ...(canDeleteGame ? {
        deleteTree: () => {
          void deleteTree(treeId).then(() => { view.close(); resolve('deleted'); },
            (err: unknown) => { window.alert(String(err)); });
        },
      } : {}),
      setMaxAuto: async (max) => {
        await setMaxAuto(treeId, max);
        return listSnaps(treeId);
      },
      close: () => { view.close(); resolve(null); },
    });
  });
}
