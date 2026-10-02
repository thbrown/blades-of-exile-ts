/**
 * A tree as a zip — what a player downloads to move a whole game's history,
 * and what uploading one turns back into a tree. Inside: `tree.json` (the
 * tree), one `NNNN.exg` per snapshot, and `NNNN.png` for each thumbnail. Every
 * `.exg` is a real save the desktop build opens, so the zip is also just a
 * folder of saves; one without a `tree.json` imports as a straight line of
 * snapshots in the order they were played.
 */

import { unzipSync, zipSync } from 'fflate';
import { SavePreview, readSavePreview } from '../fileio/saveIo';
import { ImportedNode, TreeInfo, SnapInfo } from './saveStore';
import { SnapKind } from './saveRetention';

const KINDS: readonly SnapKind[] = ['auto', 'milestone', 'manual'];

interface TreeJson {
  version: 1;
  name: string;
  scenarioId: string;
  head: number;
  nodes: {
    seq: number; parent: number | null; kind: SnapKind; reason: string; place?: string; savedAt: number;
    file: string; thumb?: string;
  }[];
}

const pad = (seq: number): string => String(seq).padStart(4, '0');

export function isZip(data: Uint8Array): boolean {
  return data.length > 4 && data[0] === 0x50 && data[1] === 0x4b && data[2] === 0x03 && data[3] === 0x04;
}

export function treeToZip(
  tree: Pick<TreeInfo, 'name' | 'scenarioId' | 'head'>,
  snaps: readonly SnapInfo[],
  blobs: ReadonlyMap<number, Uint8Array>,
): Uint8Array {
  const files: Record<string, Uint8Array | [Uint8Array, { level: 0 }]> = {};
  const json: TreeJson = {
    version: 1, name: tree.name, scenarioId: tree.scenarioId, head: tree.head, nodes: [],
  };
  for (const s of snaps) {
    const data = blobs.get(s.seq);
    if (data === undefined) continue;
    const file = `${pad(s.seq)}.exg`;
    // Already gzipped, and a PNG/WebP already compressed: store, don't deflate again.
    files[file] = [data, { level: 0 }];
    const node: TreeJson['nodes'][number] = {
      seq: s.seq, parent: s.parent, kind: s.kind, reason: s.reason, place: s.place, savedAt: s.savedAt, file,
    };
    if (s.thumb) {
      node.thumb = `${pad(s.seq)}.thumb`;
      files[node.thumb] = [s.thumb, { level: 0 }];
    }
    json.nodes.push(node);
  }
  files['tree.json'] = new TextEncoder().encode(JSON.stringify(json, null, 1));
  return zipSync(files);
}

export interface ParsedTree {
  name: string;
  scenarioId: string;
  head: number;
  nodes: ImportedNode[];
  /** Entries that were not readable saves. */
  skipped: number;
}

/** Null if the bytes are not a zip or hold no saves at all. */
export function treeFromZip(data: Uint8Array, fallbackName: string): ParsedTree | null {
  let entries: Record<string, Uint8Array>;
  try {
    entries = unzipSync(data);
  } catch {
    return null;
  }
  let skipped = 0;
  const preview = (bytes: Uint8Array): SavePreview | null => {
    try { return readSavePreview(bytes); } catch { skipped++; return null; }
  };

  // `series.json` is what a tree's zip held when trees were called series.
  const jsonBytes = entries['tree.json'] ?? entries['series.json'];
  if (jsonBytes !== undefined) {
    let json: TreeJson | null = null;
    try { json = JSON.parse(new TextDecoder().decode(jsonBytes)) as TreeJson; } catch { json = null; }
    if (json !== null && Array.isArray(json.nodes)) {
      const nodes: ImportedNode[] = [];
      for (const n of json.nodes) {
        const bytes = entries[n.file];
        const p = bytes === undefined ? null : preview(bytes);
        if (bytes === undefined || p === null) { if (bytes === undefined) skipped++; continue; }
        const thumb = n.thumb !== undefined ? entries[n.thumb] : undefined;
        nodes.push({
          seq: n.seq, parent: n.parent, data: bytes, preview: p,
          kind: KINDS.includes(n.kind) ? n.kind : 'auto', reason: String(n.reason ?? ''), place: typeof n.place === 'string' ? n.place : '',
          ...(typeof n.savedAt === 'number' ? { savedAt: n.savedAt } : {}),
          ...(thumb ? { thumb } : {}),
        });
      }
      // A node whose parent didn't survive hangs from the nearest that did, or
      // becomes a root; a tree has one root, so any extras hang from the first.
      const have = new Set(nodes.map((n) => n.seq));
      const byId = new Map(json.nodes.map((n) => [n.seq, n.parent]));
      for (const n of nodes) {
        let at = n.parent;
        while (at !== null && !have.has(at)) at = byId.get(at) ?? null;
        n.parent = at;
      }
      const roots = nodes.filter((n) => n.parent === null);
      for (const extra of roots.slice(1)) extra.parent = roots[0]!.seq;
      if (nodes.length === 0) return null;
      const head = have.has(json.head) ? json.head : nodes[nodes.length - 1]!.seq;
      return { name: json.name || fallbackName, scenarioId: json.scenarioId ?? nodes[0]!.preview.scenarioId, head, nodes, skipped };
    }
  }

  // No (usable) tree.json: every `.exg` inside, in the order it was played.
  const found: { bytes: Uint8Array; preview: SavePreview }[] = [];
  for (const [name, bytes] of Object.entries(entries)) {
    if (!/\.(exg|sav)$/i.test(name) || /(^|\/)__MACOSX\//.test(name)) continue;
    const p = preview(bytes);
    if (p !== null) found.push({ bytes, preview: p });
  }
  if (found.length === 0) return null;
  found.sort((a, b) => a.preview.age - b.preview.age);
  const nodes: ImportedNode[] = found.map((f, i) => ({
    seq: i + 1, parent: i === 0 ? null : i, data: f.bytes, preview: f.preview, kind: 'manual', reason: 'Imported',
  }));
  return { name: fallbackName, scenarioId: found[0]!.preview.scenarioId, head: nodes.length, nodes, skipped };
}
