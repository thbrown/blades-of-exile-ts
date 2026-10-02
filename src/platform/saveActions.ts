/**
 * What a player can do with saved games beyond playing the newest — import,
 * export, browse the tree — shared by the startup screen and the in-game Load
 * command. Nothing here needs a running game.
 */

import { TOWN_NUM_OUTDOORS } from '../universe/party';
import { isE3Save } from '../fileio/e3save';
import { readSavePreview } from '../fileio/saveIo';
import {
  SnapInfo, createSeries, deleteBranch, downloadFile, getAllSnapshots, getSeries, getSnapshot, importSeries,
  listSnaps,
} from './saveStore';
import { isZip, seriesFromZip, seriesToZip } from './saveZip';
import { showSaveTree } from './saveTree';

/** A file-name-safe version of a game's name. */
const fileSafe = (name: string): string => name.replace(/[\\/:*?"<>|]+/g, '_').trim() || 'exile';

/** "Fort Talrus", or "Outdoors" — for a snapshot with no recorded place. */
export function placeOf(snap: Pick<SnapInfo, 'place' | 'townNum'>): string {
  if (snap.place !== '') return snap.place;
  return snap.townNum >= TOWN_NUM_OUTDOORS ? 'Outdoors' : `Town ${snap.townNum}`;
}

export type ImportOutcome = { seriesId: string; scenarioId: string } | { error: string };

/**
 * Turn a file the player picked into a series: a zip becomes the series it
 * holds (or a line of saves, if it is just a folder of `.exg`s), and a single
 * save becomes a new series of one — never merged into an existing game.
 */
export async function importAsSeries(file: { name: string; data: Uint8Array }): Promise<ImportOutcome> {
  if (isZip(file.data)) {
    const parsed = seriesFromZip(file.data, file.name);
    if (parsed === null) return { error: 'No saved games were found in that zip.' };
    const series = await importSeries(parsed.name, parsed.scenarioId, parsed.nodes, parsed.head);
    return { seriesId: series.id, scenarioId: series.scenarioId };
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
  const { series } = await createSeries(name, {
    data: file.data, preview, kind: 'manual', reason: 'Imported',
  });
  return { seriesId: series.id, scenarioId: series.scenarioId };
}

export async function exportSeriesZip(seriesId: string): Promise<void> {
  const series = await getSeries(seriesId);
  if (series === null) return;
  const zip = seriesToZip(series, await listSnaps(seriesId), await getAllSnapshots(seriesId));
  downloadFile(`${fileSafe(series.name)}.zip`, zip, 'application/zip');
}

export async function downloadSnapshot(seriesId: string, seq: number): Promise<void> {
  const [series, snaps, data] = await Promise.all([getSeries(seriesId), listSnaps(seriesId), getSnapshot(seriesId, seq)]);
  if (series === null || data === null) return;
  const day = Math.floor((snaps.find((s) => s.seq === seq)?.gameAge ?? 0) / 3700) + 1;
  downloadFile(`${fileSafe(series.name)} day ${day}.exg`, data);
}

/**
 * Show the restore tree for a series. Resolves with the snapshot the player
 * chose to restore, or null if they closed it. `scenarioTitle` is whatever
 * the caller knows the scenario as.
 */
export async function browseSeries(seriesId: string, scenarioTitle: string): Promise<number | null> {
  const [series, snaps] = await Promise.all([getSeries(seriesId), listSnaps(seriesId)]);
  if (series === null) return null;
  return new Promise((resolve) => {
    const view = showSaveTree(document.body, {
      seriesName: series.name,
      scenarioTitle,
      snaps,
      head: series.head,
      placeName: placeOf,
      restore: (seq) => { view.close(); resolve(seq); },
      download: (seq) => { void downloadSnapshot(seriesId, seq); },
      exportSeries: () => { void exportSeriesZip(seriesId); },
      deleteBranch: async (seq) => {
        await deleteBranch(seriesId, seq);
        return listSnaps(seriesId);
      },
      close: () => { view.close(); resolve(null); },
    });
  });
}
