/**
 * ScenarioSource — where scenario files come from. One abstraction covers
 * bundled unpacked scenarios (fetch), uploaded .boes tarballs (in-memory,
 * later), and test fixtures (fs).
 */

export interface ScenarioSource {
  /**
   * The scenario's directory name — what a save file records as `SCENARIO`
   * and what `locate_scenario` looks up when the save is loaded again.
   */
  readonly id: string;
  /** Read a text file by scenario-relative path (e.g. "towns/town1.spec"). */
  getText(path: string): Promise<string>;
  /** Read a binary file (e.g. "graphics/sheet0.png"). */
  getBinary(path: string): Promise<Uint8Array>;
}

/** The last non-empty path segment, which is the scenario's directory name. */
function lastSegment(path: string): string {
  const parts = path.split('/').filter((p) => p !== '');
  return parts[parts.length - 1] ?? '';
}

export class FetchSource implements ScenarioSource {
  readonly id: string;

  /** Called after each file finishes fetching, so a caller can drive a progress bar. */
  constructor(private baseUrl: string, private onLoad?: (path: string) => void) {
    if (!this.baseUrl.endsWith('/')) this.baseUrl += '/';
    this.id = lastSegment(this.baseUrl);
  }

  private async get(path: string): Promise<Response> {
    const resp = await fetch(this.baseUrl + path);
    if (!resp.ok) throw new Error(`failed to fetch ${this.baseUrl}${path}: ${resp.status}`);
    this.onLoad?.(path);
    return resp;
  }

  async getText(path: string): Promise<string> {
    return (await this.get(path)).text();
  }

  async getBinary(path: string): Promise<Uint8Array> {
    return new Uint8Array(await (await this.get(path)).arrayBuffer());
  }
}

/** Node-only source for tests; dynamic import keeps it out of the bundle. */
export class FsSource implements ScenarioSource {
  readonly id: string;

  constructor(private dir: string) {
    this.id = lastSegment(dir.replace(/\\/g, '/'));
  }

  async getText(path: string): Promise<string> {
    const { readFile } = await import('node:fs/promises');
    const { join } = await import('node:path');
    return readFile(join(this.dir, path), 'utf8');
  }

  async getBinary(path: string): Promise<Uint8Array> {
    const { readFile } = await import('node:fs/promises');
    const { join } = await import('node:path');
    return new Uint8Array(await readFile(join(this.dir, path)));
  }
}
