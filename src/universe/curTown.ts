/**
 * Runtime state for the town the party is currently in — cCurTown
 * (universe/universe.hpp). Fields, dropped items and the save-slot half of the
 * party's four-town memory (`saveSetup`/`updateFields`) all live here.
 */

import { Location } from '../core/location';
import { GameRng } from '../core/rng';
import { FieldType } from '../data/fields';
import { Item } from '../data/item';
import { Terrain, TerObstruct } from '../data/terrain';
import { Town } from '../data/town';
import { Creature } from './creature';

/**
 * What the placement rules need from the wider world: the terrain table (a
 * field can't go on a wall) and the RNG (an antimagic field rolls against a
 * barrier being raised on top of it). The C++'s `cCurTown` reaches the `univ`
 * global for both; this is the same reach, narrowed to what it uses.
 */
export interface FieldHost {
  terrainType(index: number): Terrain;
  rng: GameRng;
}

/**
 * The span of field types the party's four-town memory keeps, named by the
 * C++'s own "Begin/End fields saved in town setup" comments (fields.hpp:22-30):
 * OBJECT_BLOCK through FIELD_QUICKFIRE, which is exactly one byte's worth.
 */
const SETUP_FIRST_FIELD = FieldType.OBJECT_BLOCK;
const SETUP_LAST_FIELD = FieldType.FIELD_QUICKFIRE;

/** The mask `cCurTown::is_summon_safe` tests against; see the method. */
const SUMMON_UNSAFE_FIELDS: FieldType[] = [
  FieldType.WALL_FORCE, FieldType.WALL_FIRE, FieldType.FIELD_ANTIMAGIC,
  FieldType.CLOUD_STINK, FieldType.WALL_ICE, FieldType.WALL_BLADES,
  FieldType.CLOUD_SLEEP,
  FieldType.OBJECT_BLOCK, FieldType.SPECIAL_SPOT, FieldType.OBJECT_CRATE,
  FieldType.OBJECT_BARREL, FieldType.FIELD_QUICKFIRE,
];

export class CurTown {
  monsters: Creature[] = [];
  items: Item[] = [];
  /**
   * `cPopulation::hostile` — the whole town has turned on the party. Set by
   * `setTownAttitude` and cleared on town entry (boe.town.cpp:158). `do_monsters`
   * reads it to stop even docile townsfolk from wandering idly.
   */
  monstHostile = false;
  /**
   * `cPopulation::which_town` on the *live* town — which town this creature
   * list belongs to, as far as the party's four-town memory is concerned.
   *
   * It is not the same fact as `party.townNum`, and the difference is a real
   * quirk rather than a tidy-up opportunity: `start_town_mode` sets it
   * (boe.town.cpp:156), but `cCurTown::readFrom` (universe.cpp:885) does
   * **not** — so a game resumed from a save carries the default 200 here until
   * the party enters some town the ordinary way. `end_town_mode` copies the
   * whole population into a save slot, label included, so the town the party
   * was standing in when it loaded is filed under "no town" and rebuilt from
   * presets the next time it is walked into. Copied deliberately.
   */
  monstWhichTown = 200;
  /**
   * `start_town_mode`'s `entry_dir`: 0–3 the entrance the party came in by, 9
   * put here by a script. The C++ forgets it once the town is loaded; this
   * port keeps it for IF_ENTRY_DIR, an blades-of-exile-ts opcode. A loaded game says 9.
   */
  entryDir = 9;
  /** Explored flags for the current town, [x][y]. */
  explored: Uint8Array[];
  /**
   * Permanently lit tiles, `cTown::lighting` — **the record's own array**, not
   * a copy. The C++ reads `univ.town->lighting`, which is the scenario town's
   * map, built once at load; giving the live town its own grid and filling it
   * on entry is what used to let a door opened on a previous visit relight the
   * corridor behind it. See `setUpLights`.
   */
  get lighting(): Uint8Array[] { return this.record.lighting; }
  /** Road and special-spot overlays, from the town's preset fields. */
  roads: Uint8Array[];
  specialSpots: Uint8Array[];
  /**
   * What occupies each space beyond its terrain — webs, barriers, clouds,
   * crates, bloodstains. The C++ packs these into one bitfield per square
   * (`cCurTown::fields`); a Set of FieldType per square is the same idea
   * without the 32-bit ceiling.
   */
  fields: Set<FieldType>[][];
  /**
   * `cCurTown::quickfire_present` — this town has quickfire in it, so
   * `process_fields` has to do the expensive spread pass. The C++ latches it in
   * three places (town setup, save loading, and `place_quickfire`); this port
   * latches it in `setField` instead, which is the one road they all take. It
   * is never cleared, exactly as in the C++: quickfire that burns out still
   * leaves the flag set until the town is re-entered.
   */
  quickfirePresent = false;

  /**
   * `cCurTown::belt_present` — this town has a conveyor square in it, so
   * `push_things` has work to do. Latched from the same three places as the
   * C++: the terrain sweep in `start_town_mode`, `alter_space`, and loading a
   * saved town. Unlike `quickfirePresent` there is no single road through
   * `setField` to hang it on, because a belt is *terrain*, not a field.
   */
  beltPresent = false;

  constructor(readonly record: Town, private readonly host: FieldHost) {
    const grid = (): Uint8Array[] =>
      Array.from({ length: record.maxDim }, () => new Uint8Array(record.maxDim));
    this.explored = grid();
    this.roads = grid();
    this.specialSpots = grid();
    this.fields = Array.from({ length: record.maxDim }, () =>
      Array.from({ length: record.maxDim }, () => new Set<FieldType>()));
    // `place_preset_fields` (universe.cpp:119) runs every preset through the
    // same placement rules as a spell does, so a quickfire preset onto a wall
    // is refused here exactly as it would be mid-game. The rest of that switch
    // — the fields that can't be preset — is the `default` below.
    for (const field of record.presetFields) {
      switch (field.type) {
        case FieldType.OBJECT_BLOCK: case FieldType.SPECIAL_SPOT: case FieldType.SPECIAL_ROAD:
        case FieldType.FIELD_WEB: case FieldType.OBJECT_CRATE: case FieldType.OBJECT_BARREL:
        case FieldType.BARRIER_FIRE: case FieldType.BARRIER_FORCE: case FieldType.BARRIER_CAGE:
        case FieldType.FIELD_QUICKFIRE:
        case FieldType.SFX_SMALL_BLOOD: case FieldType.SFX_MEDIUM_BLOOD:
        case FieldType.SFX_LARGE_BLOOD: case FieldType.SFX_SMALL_SLIME:
        case FieldType.SFX_LARGE_SLIME: case FieldType.SFX_ASH:
        case FieldType.SFX_BONES: case FieldType.SFX_RUBBLE:
          this.setField(field.loc.x, field.loc.y, field.type, true);
          break;
        default:
          break;
      }
    }
  }

  /** Whether a space carries a given field (cCurTown::is_web and friends). */
  hasField(x: number, y: number, which: FieldType): boolean {
    if (!this.isOnMap(x, y)) return false;
    // The three that live in their own grids here, because the C++ packs them
    // into the same bitfield as the rest.
    if (which === FieldType.SPECIAL_EXPLORED) return this.explored[x]![y]! !== 0;
    if (which === FieldType.SPECIAL_SPOT) return this.specialSpots[x]![y]! !== 0;
    if (which === FieldType.SPECIAL_ROAD) return this.roads[x]![y]! !== 0;
    return this.fields[x]![y]!.has(which);
  }

  /**
   * `cCurTown::save_setup` / `update_fields` (universe.cpp:187-204) — the
   * eight field types the party's four-town memory keeps, packed one bit each
   * exactly as the C++ packs them: it stores `fields[i][j] >> 8`, which is
   * bits 8..15 of its bitfield, i.e. OBJECT_BLOCK through FIELD_QUICKFIRE
   * (fields.hpp:22-30). Bit n here is field type 8+n, so a saved byte from
   * either engine means the same thing.
   */
  saveSetup(): Uint8Array[] {
    const dim = this.record.maxDim;
    const out: Uint8Array[] = [];
    for (let i = 0; i < dim; i++) {
      const col = new Uint8Array(dim);
      for (let j = 0; j < dim; j++) {
        let bits = 0;
        for (let f = SETUP_FIRST_FIELD; f <= SETUP_LAST_FIELD; f++)
          if (this.hasField(i, j, f)) bits |= 1 << (f - SETUP_FIRST_FIELD);
        col[j] = bits;
      }
      out.push(col);
    }
    return out;
  }

  /**
   * The restoring half. Note it **or**s onto whatever the presets already put
   * down rather than replacing it, and that crates, barrels and blocks are
   * masked out first — those go back to their preset squares, so a barrel the
   * party shoved into a corner is in its original place again on re-entry.
   */
  updateFields(setup: Uint8Array[]): void {
    const dim = this.record.maxDim;
    const mask = ~((1 << (FieldType.OBJECT_CRATE - SETUP_FIRST_FIELD))
      | (1 << (FieldType.OBJECT_BARREL - SETUP_FIRST_FIELD))
      | (1 << (FieldType.OBJECT_BLOCK - SETUP_FIRST_FIELD)));
    for (let i = 0; i < dim && i < setup.length; i++) {
      const col = setup[i]!;
      for (let j = 0; j < dim && j < col.length; j++) {
        const bits = col[j]! & mask;
        for (let f = SETUP_FIRST_FIELD; f <= SETUP_LAST_FIELD; f++)
          if (bits & (1 << (f - SETUP_FIRST_FIELD))) this.put(i, j, f, true);
      }
    }
  }

  /** The raw bit-set/bit-clear the C++'s simple setters do (`fields[x][y] |= …`). */
  private put(x: number, y: number, which: FieldType, on: boolean): boolean {
    if (which === FieldType.SPECIAL_EXPLORED) this.explored[x]![y] = on ? 1 : 0;
    else if (which === FieldType.SPECIAL_SPOT) this.specialSpots[x]![y] = on ? 1 : 0;
    else if (which === FieldType.SPECIAL_ROAD) this.roads[x]![y] = on ? 1 : 0;
    else if (on) this.fields[x]![y]!.add(which);
    else this.fields[x]![y]!.delete(which);
    return true;
  }

  /**
   * `cCurTown::is_impassable` (universe.cpp:807) — and the C++'s own TODO
   * beside it says this is wrong, since two other blockages also stop
   * movement. Kept as it ships: only BLOCK_MOVE_AND_SIGHT counts.
   */
  isImpassable(x: number, y: number): boolean {
    if (!this.isOnMap(x, y)) return false;
    const ter = this.host.terrainType(this.record.terrain[x]![y]!);
    return ter.blockage === TerObstruct.BLOCK_MOVE_AND_SIGHT;
  }

  /** `free_for_sfx` (:650) — a decal needs completely clear ground. */
  private freeForSfx(x: number, y: number): boolean {
    if (!this.isOnMap(x, y)) return false;
    return this.host.terrainType(this.record.terrain[x]![y]!).blockage === TerObstruct.CLEAR;
  }

  /**
   * The whole `cCurTown::set_*` family (universe.cpp:385-806) behind one
   * dispatch. Placing a field is **not** a bare bit-set: each type refuses
   * some squares outright, two of them roll against an antimagic field already
   * there (so this draws), and most cancel the fields they can't share a
   * square with. Clearing is always unconditional.
   *
   * Returns whether the field ended up on the square, which the C++'s `bool`
   * return means too — several callers print "Failed." on a false.
   */
  setField(x: number, y: number, which: FieldType, on = true): boolean {
    if (!this.isOnMap(x, y)) return false;
    if (!on) return this.put(x, y, which, false);

    const is = (f: FieldType): boolean => this.hasField(x, y, f);
    const clear = (f: FieldType): void => { this.put(x, y, f, false); };

    switch (which) {
      // --- The plain ones: explored, spot, road, block, force cage ----------
      // (`set_force_cage` carries the C++'s TODO wondering whether it should
      // check for anything at all; it doesn't.)
      case FieldType.SPECIAL_EXPLORED: case FieldType.SPECIAL_SPOT:
      case FieldType.SPECIAL_ROAD: case FieldType.OBJECT_BLOCK:
      case FieldType.BARRIER_CAGE:
        break;

      case FieldType.WALL_FORCE:
        if (this.isImpassable(x, y)) return false;
        if (is(FieldType.FIELD_ANTIMAGIC) || is(FieldType.WALL_BLADES)
          || is(FieldType.FIELD_QUICKFIRE)) return false;
        if (is(FieldType.OBJECT_CRATE) || is(FieldType.OBJECT_BARREL)
          || is(FieldType.BARRIER_FIRE) || is(FieldType.BARRIER_FORCE)) return false;
        clear(FieldType.FIELD_WEB);
        clear(FieldType.WALL_FIRE);
        break;

      case FieldType.WALL_FIRE:
        if (this.isImpassable(x, y)) return false;
        if (is(FieldType.FIELD_ANTIMAGIC) || is(FieldType.WALL_BLADES)
          || is(FieldType.FIELD_QUICKFIRE) || is(FieldType.WALL_ICE)) return false;
        if (is(FieldType.OBJECT_CRATE) || is(FieldType.OBJECT_BARREL)
          || is(FieldType.BARRIER_FIRE) || is(FieldType.BARRIER_FORCE)) return false;
        if (is(FieldType.FIELD_WEB) || is(FieldType.CLOUD_STINK)
          || is(FieldType.CLOUD_SLEEP)) return false;
        clear(FieldType.FIELD_WEB);
        break;

      case FieldType.FIELD_ANTIMAGIC:
        if (this.isImpassable(x, y)) return false;
        if (is(FieldType.FIELD_QUICKFIRE) || is(FieldType.WALL_FORCE)
          || is(FieldType.WALL_FIRE)) return false;
        clear(FieldType.WALL_FORCE);
        clear(FieldType.WALL_FIRE);
        clear(FieldType.CLOUD_STINK);
        clear(FieldType.WALL_ICE);
        clear(FieldType.WALL_BLADES);
        clear(FieldType.CLOUD_SLEEP);
        break;

      case FieldType.CLOUD_STINK:
        if (this.isImpassable(x, y)) return false;
        if (is(FieldType.WALL_FORCE) || is(FieldType.WALL_FIRE)
          || is(FieldType.WALL_ICE) || is(FieldType.WALL_BLADES)) return false;
        if (is(FieldType.FIELD_ANTIMAGIC) || is(FieldType.CLOUD_SLEEP)
          || is(FieldType.FIELD_QUICKFIRE)) return false;
        if (is(FieldType.BARRIER_FIRE) || is(FieldType.BARRIER_FORCE)) return false;
        break;

      case FieldType.WALL_ICE:
        if (this.isImpassable(x, y)) return false;
        if (is(FieldType.WALL_FORCE) || is(FieldType.WALL_BLADES)
          || is(FieldType.FIELD_ANTIMAGIC)) return false;
        if (is(FieldType.FIELD_WEB) || is(FieldType.OBJECT_CRATE)
          || is(FieldType.OBJECT_BARREL)) return false;
        if (is(FieldType.BARRIER_FIRE) || is(FieldType.BARRIER_FORCE)
          || is(FieldType.FIELD_QUICKFIRE)) return false;
        clear(FieldType.WALL_FIRE);
        clear(FieldType.CLOUD_STINK);
        break;

      case FieldType.WALL_BLADES:
        if (this.isImpassable(x, y)) return false;
        if (is(FieldType.BARRIER_FIRE) || is(FieldType.BARRIER_FORCE)
          || is(FieldType.FIELD_QUICKFIRE) || is(FieldType.FIELD_ANTIMAGIC)) return false;
        clear(FieldType.WALL_FORCE);
        clear(FieldType.WALL_FIRE);
        break;

      case FieldType.CLOUD_SLEEP:
        if (this.isImpassable(x, y)) return false;
        if (is(FieldType.BARRIER_FIRE) || is(FieldType.BARRIER_FORCE)
          || is(FieldType.FIELD_QUICKFIRE) || is(FieldType.FIELD_ANTIMAGIC)) return false;
        clear(FieldType.WALL_FORCE);
        clear(FieldType.WALL_FIRE);
        break;

      case FieldType.FIELD_WEB:
        if (this.isImpassable(x, y)) return false;
        if (is(FieldType.BARRIER_FIRE) || is(FieldType.BARRIER_FORCE)
          || is(FieldType.FIELD_QUICKFIRE)) return false;
        if (is(FieldType.WALL_FORCE) || is(FieldType.WALL_FIRE)
          || is(FieldType.FIELD_ANTIMAGIC)) return false;
        if (is(FieldType.WALL_ICE) || is(FieldType.WALL_BLADES)
          || is(FieldType.CLOUD_SLEEP)) return false;
        break;

      // The two objects sit on any terrain at all — no impassable check.
      case FieldType.OBJECT_CRATE:
        if (is(FieldType.BARRIER_FIRE) || is(FieldType.BARRIER_FORCE)
          || is(FieldType.FIELD_QUICKFIRE) || is(FieldType.OBJECT_BARREL)) return false;
        break;

      case FieldType.OBJECT_BARREL:
        if (is(FieldType.BARRIER_FIRE) || is(FieldType.BARRIER_FORCE)
          || is(FieldType.FIELD_QUICKFIRE) || is(FieldType.OBJECT_CRATE)) return false;
        break;

      case FieldType.BARRIER_FIRE:
        if (is(FieldType.OBJECT_BARREL) || is(FieldType.BARRIER_FORCE)
          || is(FieldType.FIELD_QUICKFIRE) || is(FieldType.OBJECT_CRATE)) return false;
        // A barrier raised over antimagic usually fizzles — and this draws.
        if (is(FieldType.FIELD_ANTIMAGIC) && this.host.rng.getRan(1, 0, 3) < 3) return false;
        clear(FieldType.FIELD_WEB);
        clear(FieldType.WALL_FORCE);
        clear(FieldType.WALL_FIRE);
        clear(FieldType.FIELD_ANTIMAGIC);
        clear(FieldType.CLOUD_STINK);
        clear(FieldType.WALL_ICE);
        clear(FieldType.WALL_BLADES);
        clear(FieldType.CLOUD_SLEEP);
        break;

      case FieldType.BARRIER_FORCE:
        if (is(FieldType.BARRIER_FIRE) || is(FieldType.OBJECT_BARREL)
          || is(FieldType.FIELD_QUICKFIRE) || is(FieldType.OBJECT_CRATE)) return false;
        if (is(FieldType.FIELD_ANTIMAGIC) && this.host.rng.getRan(1, 0, 2) < 2) return false;
        clear(FieldType.FIELD_WEB);
        clear(FieldType.WALL_FORCE);
        clear(FieldType.WALL_FIRE);
        clear(FieldType.FIELD_ANTIMAGIC);
        clear(FieldType.CLOUD_STINK);
        clear(FieldType.WALL_ICE);
        clear(FieldType.WALL_BLADES);
        clear(FieldType.CLOUD_SLEEP);
        break;

      case FieldType.FIELD_QUICKFIRE: {
        const ter = this.host.terrainType(this.record.terrain[x]![y]!);
        if (ter.blockage === TerObstruct.BLOCK_SIGHT) return false;
        // The C++'s own TODO here: it is odd that BLOCK_MOVE_AND_SHOOT isn't
        // on this list. Kept as it ships — quickfire spreads into those.
        if (ter.blockage === TerObstruct.BLOCK_MOVE_AND_SIGHT) return false;
        if (is(FieldType.FIELD_ANTIMAGIC) && this.host.rng.getRan(1, 0, 1) === 0) return false;
        if (is(FieldType.BARRIER_FORCE) || is(FieldType.BARRIER_FIRE)) return false;
        this.quickfirePresent = true;
        clear(FieldType.WALL_FORCE);
        clear(FieldType.WALL_FIRE);
        clear(FieldType.FIELD_ANTIMAGIC);
        clear(FieldType.CLOUD_STINK);
        clear(FieldType.WALL_ICE);
        clear(FieldType.WALL_BLADES);
        clear(FieldType.CLOUD_SLEEP);
        clear(FieldType.FIELD_WEB);
        clear(FieldType.OBJECT_CRATE);
        clear(FieldType.OBJECT_BARREL);
        clear(FieldType.BARRIER_FORCE);
        clear(FieldType.BARRIER_FIRE);
        break;
      }

      // --- The decals: clear ground, and only one of them at a time ---------
      case FieldType.SFX_SMALL_BLOOD:
        if (!this.freeForSfx(x, y)) return false;
        if (is(FieldType.SFX_MEDIUM_BLOOD) || is(FieldType.SFX_LARGE_BLOOD)) return false;
        for (const f of [FieldType.SFX_SMALL_SLIME, FieldType.SFX_LARGE_SLIME,
          FieldType.SFX_ASH, FieldType.SFX_BONES, FieldType.SFX_RUBBLE]) clear(f);
        break;

      case FieldType.SFX_MEDIUM_BLOOD:
        if (!this.freeForSfx(x, y)) return false;
        if (is(FieldType.SFX_LARGE_BLOOD)) return false;
        for (const f of [FieldType.SFX_SMALL_BLOOD, FieldType.SFX_SMALL_SLIME,
          FieldType.SFX_LARGE_SLIME, FieldType.SFX_ASH, FieldType.SFX_BONES,
          FieldType.SFX_RUBBLE]) clear(f);
        break;

      case FieldType.SFX_LARGE_BLOOD:
        if (!this.freeForSfx(x, y)) return false;
        for (const f of [FieldType.SFX_SMALL_BLOOD, FieldType.SFX_MEDIUM_BLOOD,
          FieldType.SFX_SMALL_SLIME, FieldType.SFX_LARGE_SLIME, FieldType.SFX_ASH,
          FieldType.SFX_BONES, FieldType.SFX_RUBBLE]) clear(f);
        break;

      case FieldType.SFX_SMALL_SLIME:
        if (!this.freeForSfx(x, y)) return false;
        if (is(FieldType.SFX_LARGE_SLIME)) return false;
        for (const f of [FieldType.SFX_SMALL_BLOOD, FieldType.SFX_MEDIUM_BLOOD,
          FieldType.SFX_LARGE_BLOOD, FieldType.SFX_ASH, FieldType.SFX_BONES,
          FieldType.SFX_RUBBLE]) clear(f);
        break;

      case FieldType.SFX_LARGE_SLIME:
        if (!this.freeForSfx(x, y)) return false;
        for (const f of [FieldType.SFX_SMALL_BLOOD, FieldType.SFX_MEDIUM_BLOOD,
          FieldType.SFX_LARGE_BLOOD, FieldType.SFX_SMALL_SLIME, FieldType.SFX_ASH,
          FieldType.SFX_BONES, FieldType.SFX_RUBBLE]) clear(f);
        break;

      case FieldType.SFX_ASH:
        if (!this.freeForSfx(x, y)) return false;
        for (const f of [FieldType.SFX_SMALL_BLOOD, FieldType.SFX_MEDIUM_BLOOD,
          FieldType.SFX_LARGE_BLOOD, FieldType.SFX_SMALL_SLIME, FieldType.SFX_LARGE_SLIME,
          FieldType.SFX_BONES, FieldType.SFX_RUBBLE]) clear(f);
        break;

      case FieldType.SFX_BONES:
        if (!this.freeForSfx(x, y)) return false;
        for (const f of [FieldType.SFX_SMALL_BLOOD, FieldType.SFX_MEDIUM_BLOOD,
          FieldType.SFX_LARGE_BLOOD, FieldType.SFX_SMALL_SLIME, FieldType.SFX_LARGE_SLIME,
          FieldType.SFX_ASH, FieldType.SFX_RUBBLE]) clear(f);
        break;

      case FieldType.SFX_RUBBLE:
        if (!this.freeForSfx(x, y)) return false;
        for (const f of [FieldType.SFX_SMALL_BLOOD, FieldType.SFX_MEDIUM_BLOOD,
          FieldType.SFX_LARGE_BLOOD, FieldType.SFX_SMALL_SLIME, FieldType.SFX_LARGE_SLIME,
          FieldType.SFX_ASH, FieldType.SFX_BONES]) clear(f);
        break;

      // FIELD_DISPEL and FIELD_SMASH are pattern codes, not things that sit on
      // a square — the C++ has no setter for either.
      default:
        return false;
    }

    return this.put(x, y, which, true);
  }

  // The real `dispel_fields` is `game/fieldEffects.ts` — it rolls a save per
  // field type and needs the RNG, so it doesn't belong on the map state. The
  // deterministic clear that used to live here cleared far too much.

  isLit(x: number, y: number): boolean {
    return this.isOnMap(x, y) && this.lighting[x]![y]! !== 0;
  }

  isRoad(x: number, y: number): boolean {
    return this.isOnMap(x, y) && this.roads[x]![y]! !== 0;
  }

  isOnMap(x: number, y: number): boolean {
    return x >= 0 && y >= 0 && x < this.record.maxDim && y < this.record.maxDim;
  }

  isExplored(x: number, y: number): boolean {
    return this.isOnMap(x, y) && this.explored[x]![y]! !== 0;
  }

  makeExplored(x: number, y: number): void {
    if (this.isOnMap(x, y)) this.explored[x]![y] = 1;
  }

  /**
   * cCurTown::is_special (universe.cpp:301) — note this scans the town's
   * special_locs list, *not* the SPECIAL_SPOT field flag. The flag only
   * controls the white marker the map draws; the list is what actually runs.
   */
  isSpecialSpot(x: number, y: number): boolean {
    if (!this.isOnMap(x, y)) return false;
    return this.record.specialLocs.some((l) => l.x === x && l.y === y && l.spec >= 0);
  }

  /**
   * cCurTown::is_summon_safe (universe.cpp:239) — "is there anything on this
   * square that a creature should not be dropped onto?". `find_clear_spot` is
   * its only caller, and it is the last of that function's six tests.
   *
   * The C++ writes the set as a bit mask: `SPECIAL_SPOT | OBJECT_CRATE |
   * OBJECT_BARREL | OBJECT_BLOCK | FIELD_QUICKFIRE | **254**`, and the 254 is
   * the interesting part — bits 1 to 7 of the low byte, which is every field
   * type from `WALL_FORCE` to `CLOUD_SLEEP` written as a range rather than by
   * name, with bit 0 (`SPECIAL_EXPLORED`) masked off because a square being
   * explored is not a hazard. Its own comment says so. **`FIELD_WEB`,
   * `BARRIER_FIRE` and `BARRIER_FORCE` are not in the set** — the barriers
   * because `is_blocked` has already refused them, the web for no reason
   * anyone left behind.
   */
  isSummonSafe(x: number, y: number): boolean {
    if (!this.isOnMap(x, y)) return false;
    return SUMMON_UNSAFE_FIELDS.some((f) => this.hasField(x, y, f));
  }

  /** take_explored — put the fog back over a square. */
  takeExplored(x: number, y: number): void {
    if (this.isOnMap(x, y)) this.explored[x]![y] = 0;
  }

  /** A live, alive monster occupying a space (accounting for multi-tile size). */
  monsterAt(where: Location): Creature | null {
    for (const m of this.monsters) {
      if (!m.isAlive) continue;
      if (
        where.x >= m.curLoc.x &&
        where.x < m.curLoc.x + m.xWidth &&
        where.y >= m.curLoc.y &&
        where.y < m.curLoc.y + m.yWidth
      )
        return m;
    }
    return null;
  }
}
