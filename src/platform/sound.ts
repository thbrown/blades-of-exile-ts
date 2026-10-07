/**
 * Sound playback over Web Audio, replacing SFML's sound buffers
 * (src/sounds.cpp). Sounds are SND0..SND99.wav; they are fetched and decoded
 * lazily on first use, then cached.
 *
 * Browsers won't start an AudioContext until the user interacts with the
 * page, so playback is silently dropped until `resume()` succeeds — the same
 * observable behaviour as running with sound switched off.
 */

/** Sound numbers the game refers to by name. */
export const Snd = {
  /** Footstep pair; the game alternates them (move_sound, boe.main.cpp:1995). */
  STEP_A: 49,
  STEP_B: 50,
  SQUISH: 55,
  CRUNCH: 47,
  SPLASH: 17,
  ENTER_TOWN: 16,
  ENTER_DUNGEON: 95,
  BUTTON: 37,
  BLOCKED: 0,
  /** A lock giving way, whether picked or bashed (boe.town.cpp:1197, :1225). */
  LOCK_OPENED: 9,
  /** A lockpick failing (boe.town.cpp:1194). */
  LOCK_FAILED: 41,
  /** get_item picking up gold/food/anything else (boe.items.cpp:486-508). */
  GOT_GOLD: 39,
  GOT_FOOD: 62,
  GOT_ITEM: 0,
  /** get_item refusing an overweight pickup — the same cue as a failed lockpick. */
  TOO_HEAVY: 41,
} as const;

/**
 * `always_async` (sounds.cpp:48; 1997's `always_asynch`, Exile.sound.c:29 —
 * the same 28). Every other sound blocks when played with a positive number:
 * see `livingSound`.
 */
export const ALWAYS_ASYNC: ReadonlySet<number> = new Set([
  6, 24, 25, 34, 37, 39, 41, 42, 43, 44, 45, 46, 47, 48, 49,
  50, 55, 61, 76, 77, 78, 79, 80, 81, 82, 83, 85, 91,
]);

/**
 * The blocking sounds a fight makes, warmed at load so the first of each
 * already knows its length: a sound still being fetched can't block, so it
 * would overlap the next. Hits (`boom_space`'s table and the armour's clang),
 * the death cries, and a PC going down.
 */
const COMBAT_SOUNDS = [
  2, 3, 4, 5, 7, 12, 14, 18, 19, 21, 29, 30, 31, 32, 33, 51, 52, 53, 60,
  69, 70, 71, 72, 73, 75, 86, 87, 88, 89, 97, 98,
];

export class SoundPlayer {
  private ctx: AudioContext | null = null;
  private buffers = new Map<number, AudioBuffer>();
  private pending = new Set<number>();
  enabled = true;

  /**
   * The scenario's own sounds, `sounds/SNDn.wav` in its package, each in
   * place of the engine's sound `n`: OBoE pushes the scenario's `sounds`
   * directory onto the resource path ahead of the game's
   * (`ResMgr::sounds.pushPath`, fileio_scen.cpp). Exile III ships all its own.
   */
  private scenarioSounds = new Map<number, () => Promise<ArrayBuffer>>();

  constructor(private baseUrl = `${import.meta.env.BASE_URL}data/sounds/`) {}

  /** Install a scenario's sounds, dropping any cached sound they replace. */
  setScenarioSounds(sounds: Map<number, () => Promise<ArrayBuffer>>): void {
    for (const n of [...this.scenarioSounds.keys(), ...sounds.keys()]) this.buffers.delete(n);
    this.scenarioSounds = new Map(sounds);
  }

  /** Call from a user-gesture handler; safe to call repeatedly. */
  async resume(): Promise<void> {
    if (!this.ctx) {
      const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!Ctor) {
        this.enabled = false;
        return;
      }
      this.ctx = new Ctor();
    }
    if (this.ctx.state === 'suspended') await this.ctx.resume();
  }

  /**
   * play_sound(n): fire and forget. A negative number means "asynchronously"
   * in the C++ (sounds.cpp:97) — the sound itself is `abs(n)`, which matters
   * because terrain stores its sound as a value the game negates.
   *
   * A sound that isn't cached yet is fetched and then played, rather than
   * dropped — otherwise the first door you open is always silent.
   */
  play(which: number): void {
    if (!this.enabled) return;
    const num = Math.abs(which);
    const buf = this.buffers.get(num);
    if (!buf) {
      void this.preload(num).then(() => this.emit(num));
      return;
    }
    this.emit(num);
  }

  /**
   * How long sound `which` holds the game when played as a blocking sound, in
   * ms — or 0 if it doesn't: async, sound off, or not loaded yet (the first
   * play of a sound not in `COMBAT_SOUNDS` overlaps rather than waits).
   */
  blockingMs(which: number): number {
    if (!this.enabled || which <= 0 || ALWAYS_ASYNC.has(which)) return 0;
    const buf = this.buffers.get(which);
    return buf ? buf.duration * 1000 : 0;
  }

  private emit(which: number): void {
    const buf = this.buffers.get(which);
    const ctx = this.ctx;
    if (!buf || !ctx || ctx.state !== 'running') return;
    const src = ctx.createBufferSource();
    src.buffer = buf;
    src.connect(ctx.destination);
    src.start();
  }

  async preload(which: number): Promise<void> {
    if (!this.enabled || this.buffers.has(which) || this.pending.has(which)) return;
    this.pending.add(which);
    try {
      await this.resume();
      if (!this.ctx) return;
      const own = this.scenarioSounds.get(which);
      let bytes: ArrayBuffer;
      if (own) bytes = await own();
      else {
        const resp = await fetch(`${this.baseUrl}SND${which}.wav`);
        if (!resp.ok) return;
        bytes = await resp.arrayBuffer();
      }
      this.buffers.set(which, await this.ctx.decodeAudioData(bytes));
    } catch {
      // A missing or undecodable sound is not worth failing the game over.
    } finally {
      this.pending.delete(which);
    }
  }

  /** Warm the cache for the sounds walking around needs. */
  async preloadCommon(): Promise<void> {
    await Promise.all([...Object.values(Snd), ...COMBAT_SOUNDS].map((n) => this.preload(n)));
  }

  /** Warm any extra sounds a scenario's content refers to (door swings, etc.). */
  async preloadAll(which: Iterable<number>): Promise<void> {
    await Promise.all([...which].map((n) => this.preload(Math.abs(n))));
  }
}
