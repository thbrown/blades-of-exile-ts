/**
 * Mersenne Twister (MT19937), bit-for-bit compatible with C++ std::mt19937.
 *
 * Fidelity matters: BoE replays record only the seed, so combat/AI outcomes
 * are reproducible iff our generator AND the order of getRan() calls match
 * the C++ engine (../exile-wasm/src/mathutil.cpp).
 */

const N = 624;
const M = 397;
const MATRIX_A = 0x9908b0df;
const UPPER_MASK = 0x80000000;
const LOWER_MASK = 0x7fffffff;

export class MT19937 {
  private mt = new Uint32Array(N);
  private mti = N + 1;

  // std::mt19937's default seed
  constructor(seed = 5489) {
    this.seed(seed);
  }

  seed(s: number): void {
    this.mt[0] = s >>> 0;
    for (let i = 1; i < N; i++) {
      const prev = this.mt[i - 1]! ^ (this.mt[i - 1]! >>> 30);
      this.mt[i] = (Math.imul(1812433253, prev) + i) >>> 0;
    }
    this.mti = N;
  }

  /** Next uint32. */
  next(): number {
    if (this.mti >= N) this.generateBlock();
    let y = this.mt[this.mti++]!;
    y ^= y >>> 11;
    y ^= (y << 7) & 0x9d2c5680;
    y ^= (y << 15) & 0xefc60000;
    y ^= y >>> 18;
    return y >>> 0;
  }

  private generateBlock(): void {
    const mt = this.mt;
    for (let kk = 0; kk < N; kk++) {
      const y = (mt[kk]! & UPPER_MASK) | (mt[(kk + 1) % N]! & LOWER_MASK);
      mt[kk] = (mt[(kk + M) % N]! ^ (y >>> 1) ^ (y & 1 ? MATRIX_A : 0)) >>> 0;
    }
    this.mti = 0;
  }
}

function toInt16(n: number): number {
  return (n << 16) >> 16;
}

/**
 * The engine's two RNG streams, mirroring game_rand/unique_rand in
 * mathutil.cpp. Replays seed only the game stream; calls that must not
 * affect replay determinism use the unique stream.
 */
/**
 * `RAN=n` prints the first n `get_ran` calls with their arguments and result.
 * The pair on the C++ side is `BOE_TRACE_RAN=n tools/cppharness/run.sh`, which
 * prints the identical format — diffing the two is the only way to line the
 * engines up when they disagree about *which* random number a rule got, and
 * every one of the drift buckets ends up here. Read once: this is a hot path.
 */
const TRACE_RAN = Number(
  (typeof process !== 'undefined' ? process.env?.RAN : undefined) ?? 0);

export class GameRng {
  readonly game = new MT19937();
  readonly unique = new MT19937();
  /**
   * How many numbers have been drawn from each stream. Not in the C++ — this is
   * the fingerprint replay verification leans on. `get_ran`'s **call order** is
   * part of the spec, so two runs that agree on every visible value but
   * disagree here have diverged somewhere that hasn't surfaced yet.
   */
  gameDraws = 0;
  uniqueDraws = 0;
  /**
   * How many times `getRan` has been *called* on the game stream, as against
   * how many numbers those calls consumed. **These are different units and
   * confusing them cost a real investigation.**
   *
   * `get_ran(3,1,6)` is one call and three numbers. The `[ran]` trace prints
   * one line per *call*, and so does the C++'s `trace_ran`, so a draw-stream
   * diff is in calls — but `gameDraws` counts numbers. On
   * `ZKR_15-05-2025_18-04-58` that is 6,676 calls against 6,726 numbers, and
   * for a while the 50 was written down as "the two runners disagree, one of
   * them is not reproducing the recording faithfully". Neither was wrong.
   *
   * The identity, checked in `test/cppReplay.test.ts`:
   *
   *     gameDraws === sum of `times` over every traced call
   *                 + 1 for `seedLoadedReplay`'s `init_boe` draw
   */
  gameCalls = 0;

  seedGame(seed: number): void {
    this.game.seed(seed);
    this.gameDraws = 0;
    this.gameCalls = 0;
    this.traced = 0;
    this.seeded = true;
  }

  /** Reseed the unique stream, which nothing replays. */
  seedUnique(seed: number): void {
    this.unique.seed(seed);
    this.uniqueDraws = 0;
  }

  /** Verbatim port of get_ran(times, min, max, use_unique_ran). */
  getRan(times: number, min: number, max: number, useUnique = false): number {
    if (max < min) max = min;
    // Note the early return: a zero-width range draws *nothing*, so it doesn't
    // move the stream and mustn't count as a draw either.
    if (max === min) return toInt16(times * min);
    let toRet = 0;
    for (let i = 1; i < times + 1; i++) {
      let store: number;
      if (useUnique) {
        store = this.unique.next();
        this.uniqueDraws++;
      } else {
        store = this.game.next();
        this.gameDraws++;
      }
      toRet = toInt16(toRet + min + (store % (max - min + 1)));
    }
    // **The game stream only** — `unique` is never seeded by a replay and is
    // deliberately outside the replay's determinism, so tracing it interleaves
    // numbers with no counterpart on the other side, which reads as "the
    // streams diverge on the first draw" when they in fact agree.
    if (!useUnique) this.gameCalls++;
    if (!useUnique && this.seeded && TRACE_RAN > 0 && ++this.traced <= TRACE_RAN) {
      // eslint-disable-next-line no-console
      console.log(`    [ran] ${this.traced} get_ran(${times},${min},${max}) = ${toRet}`);
      // Only the draw asked for. The C++'s pair (`trace_ran`, guarded by
      // `n == stack_at`) prints one stack, not one per draw — a stray second
      // print here used to bury it under every other draw's.
      if (process.env.RANSTACK && String(this.traced) === process.env.RANSTACK) console.log(new Error('here').stack);
    }
    return toRet;
  }

  /** How many draws `RAN=n` has printed so far. */
  private traced = 0;

  /**
   * Whether the game stream has been seeded yet. `RAN=n` stays quiet until it
   * has: a recording that loads a save is seeded *after* `startNewGame`, whose
   * setup draws thousands of numbers that have no counterpart in the C++, and
   * tracing those just spends the budget before the comparable part starts.
   */
  private seeded = false;
}

/**
 * The seed a live game starts from: `?seed=N` if the page was given one, else
 * the clock.
 *
 * Exile III seeds its one generator **once, at launch**, from the time:
 * `srand(GetCurrentTime())` (10e8:0190), milliseconds since Windows started,
 * of which `srand` keeps the low 16 bits. Loading a saved game doesn't reseed,
 * and a save holds no seed, so the same save rolls differently each time the
 * game is run. OBoE seeds `game_rand` from `time(nullptr)` at startup and
 * never seeds `unique_rand` at all. Until 2026-10-01 this port seeded neither,
 * so every page load replayed the same dice from mt19937's default seed.
 *
 * Not the original's numbers either way: Exile III's generator is Borland's
 * `rand()` and its call order is its own (DIVERGENCES.md). What matches is
 * that a fresh run is a fresh roll. `?seed=` is a blades-of-exile-ts addition, for
 * play-testing: the same seed and the same moves give the same game.
 */
export function launchSeed(search: string, now: number = Date.now()): number {
  const pinned = new URLSearchParams(search).get('seed');
  if (pinned !== null && /^\d+$/.test(pinned)) return Number(pinned) >>> 0;
  return now >>> 0;
}

/**
 * Seed both streams for a live game. The unique stream gets its own value off
 * the same seed, so a pinned seed pins it too.
 */
export function seedForLaunch(rng: GameRng, seed: number): void {
  rng.seedGame(seed);
  rng.seedUnique((seed ^ 0x9e3779b9) >>> 0);
}

