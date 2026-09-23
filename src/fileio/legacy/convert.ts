/**
 * The `import_legacy` family — each legacy record turned into this port's
 * data model, one function per C++ method:
 *
 *   cTerrain::import_legacy   terrain.cpp        → convertTerrain
 *   cSpecial::import_legacy   special.cpp        → convertSpecial
 *   cMonster::import_legacy   monster.cpp        → convertMonster (+ addAbil)
 *   cItem::import_legacy      item.cpp           → convertItem
 *   cTownperson::import_legacy monster.cpp       → convertTownperson
 *   cOutdoors::cWandering     outdoors.cpp       → convertOutWandering
 *   cTown::cField             town.cpp           → convertPresetField
 *   cSpeech::import_legacy    talking.cpp        → convertTalkNodes
 *
 * These are OBoE's conversions and are kept exactly, odd corners included —
 * they are what turned the four bundled scenarios into the XML this port has
 * been measured against, so matching them is matching the corpus.
 */

import { FieldType } from '../../data/fields';
import { Item, ItemAbil, ItemType, ItemUse, defaultItem } from '../../data/item';
import {
  Attitude, DamageType, Monster, MonstTime, defaultMonster,
} from '../../data/monster';
import {
  MonstAbil, MonstGen, MonstMissile, MonstSummon, SpellPat,
} from '../../data/monsterAbility';
import { OutWandering } from '../../data/outdoors';
import { PIC_DLOG, SpecType, SpecialNode, emptySpecialNode } from '../../data/special';
import { Spell } from '../../data/spell';
import { TalkNode, TalkNodeType, emptyTalkNode } from '../../data/talking';
import {
  StepSound, TerObstruct, TerSpec, Terrain, TrimType, defaultTerrain,
} from '../../data/terrain';
import { ShopItemType } from '../../data/shop';
import { PresetField, Townperson, defaultTownperson } from '../../data/town';
import { SpecCtx } from '../../game/specials/context';
import { PartyStatus, Race, Skill, Status } from '../../universe/skills';
import {
  LegacyCreatureStart, LegacyItem, LegacyMonster, LegacyOutWandering, LegacySpecial,
  LegacyTalkNode, LegacyTerrain,
} from './structs';

/** pictypes.hpp. */
const PIC_TER = 1;
const PIC_MONST = 3;

/** `NO_PIC` — "no picture here" (pictypes.hpp). */
const NO_PIC = -1;

/** `cTerrain::i` after import: the index, or one of these two markers. */
export const LEGACY_SPECIAL_SPOT = 3000;
export const LEGACY_ROAD = 3001;

// ---------------------------------------------------------------- terrain

/** Graphics that are the archetype of their ground type (terrain.cpp). */
const ARCHETYPES = new Set([0, 2, 5, 18, 32, 46, 74, 88, 100, 110, 123, 157, 163, 215, 216, 400, 404]);

const ARENAS = [
  1, 1, 0, 0, 0, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 2, 2,
  2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2,
  2, 2, 2, 2, 2, 2, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
  0, 3, 3, 3, 3, 3, 3, 5, 5, 5, 6, 6, 7, 7, 1, 1, 8, 9, 10, 11,
  11, 11, 12, 13, 13, 9, 9, 9, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1,
  1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1,
  1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1,
  1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1,
  1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1,
  1, 0, 1, 1, 1, 1, 1, 1, 1, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0,
  0, 0, 1, 0, 2, 0, 0, 1, 1, 1, 1, 0, 2, 1, 1, 1, 0, 1, 1, 1,
  1, 1, 0, 0, 0, 0, 1, 0, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1,
  1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1,
  4, 4, 4, 4, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1,
];

const GROUND = [
  0, 0, 1, 1, 1, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 3, 3,
  3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 4, 4, 4, 4, 4, 4, 4, 4,
  4, 4, 4, 4, 4, 4, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5,
  5, 5, 5, 5, 5, 5, 5, 0, 0, 0, 0, 0, 0, 0, 9, 0, 0, 1, 1, 1,
  1, 1, 1, 0, 0, 1, 1, 1, 10, 10, 10, 10, 10, 10, 10, 10, 10, 10, 10, 10,
  11, 11, 11, 11, 11, 11, 11, 11, 11, 11, 12, 12, 12, 12, 12, 12, 12, 12, 12, 12,
  12, 0, 0, 13, 13, 13, 13, 13, 13, 13, 13, 13, 13, 13, 13, 13, 13, 13, 13, 13,
  13, 13, 13, 13, 13, 13, 13, 13, 13, 13, 13, 13, 13, 13, 13, 13, 13, 14, 14, 14,
  14, 14, 14, 15, 15, 15, 15, 15, 15, 15, 15, 15, 15, 15, 15, 15, 15, 15, 0, 0,
  0, 1, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 3, 3, 3, 3, 1, 1, 1, 1,
  1, 1, 0, 1, 4, 1, 1, 0, 13, 14, 15, 1, 4, 13, 13, 16, 17, 0, 16, 16,
  16, 16, 17, 17, 17, 17, 0, 1, 18, 19, 13, 20, 0, 13, 0, 0, 0, 0, 0, 0,
  2, 2, 2, 2, 0, 0, 15, 15, 15, 15, 15, 13, 13, 1, 1, 1, 1, 1, 1, 4,
  6, 6, 6, 6, 7, 6, 0, 0, 0, 0, 0, 0, 13, 13,
];

const TRIMS = [
  0, 0, 0, 0, 0, 0, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 0, 0,
  2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 0, 0, 2, 3, 4, 5, 6, 7,
  8, 9, 10, 11, 12, 13, 0, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 0,
  0, 18, 0, 18, 18, 0, 18, 0, 0, 0, 0, 0, 0, 0, 14, 0, 0, 0, 0, 0,
  0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1,
  1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1,
  1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
  0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
  0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
  0, 0, 0, 0, 0, 0, 0, 18, 18, 18, 18, 18, 18, 18, 18, 18, 18, 18, 0, 0,
  18, 18, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 16, 16, 0, 16, 16,
  16, 16, 16, 16, 16, 16, 0, 0, 0, 0, 0, 0, 18, 0, 0, 0, 18, 18, 18, 18,
  18, 18, 18, 18, 18, 18, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
  14, 14, 14, 14, 14, 17, 18, 0, 0, 0, 0, 0, 0, 0,
];

const TRIM_TERS = [
  99, 99, 99, 99, 99, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 4, 4,
  4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 1, 1, 1, 1, 1, 1, 1, 1,
  1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 99,
  99, 1, 99, 1, 1, 99, 1, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99,
  99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99,
  99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99,
  99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99,
  99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99,
  99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99,
  99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 4, 4, 4, 4, 99, 99, 99, 99,
  99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 0, 1, 99, 0, 0,
  0, 0, 1, 1, 1, 1, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99,
  0, 0, 0, 0, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99,
  99, 99, 99, 99, 99, 2, 99, 99, 99, 99, 99, 99, 99, 99,
];

/** eDirection values `WATERFALL_CAVE` and the conveyors use (location.hpp). */
const DIR_N = 0;
const DIR_E = 2;
const DIR_S = 4;
const DIR_W = 6;

/**
 * `cTerrain::import_legacy`. Returns the terrain and its `i` afterwards —
 * the index, or `LEGACY_SPECIAL_SPOT` / `LEGACY_ROAD` for a terrain the old
 * game used to paint a special spot or a road, which the town and sector
 * imports turn into fields.
 */
export function convertTerrain(old: LegacyTerrain, index: number): { ter: Terrain; mark: number } {
  const ter = defaultTerrain();
  let i = index;
  let picture = old.picture;
  // "all archetypes except lava lack a special ability"
  ter.isArchetype = ARCHETYPES.has(picture) && ((old.special === 0) === (old.picture !== 404));
  ter.blockage = old.blockage as TerObstruct;
  let trimTer: number;
  if (picture >= 0 && picture < 260) {
    ter.combatArena = ARENAS[picture]!;
    ter.groundType = GROUND[picture]!;
    ter.trimType = TRIMS[picture]! as TrimType;
    trimTer = TRIM_TERS[picture]!;
  } else if (picture >= 400 && picture < 140 + 274) {
    ter.combatArena = ARENAS[picture - 140]!;
    ter.groundType = GROUND[picture - 140]!;
    ter.trimType = TRIMS[picture - 140]! as TrimType;
    trimTer = TRIM_TERS[picture - 140]!;
    picture += 560;
  } else {
    ter.combatArena = 1;
    ter.groundType = 255;
    ter.trimType = TrimType.NONE;
    trimTer = 0;
  }
  ter.trimTer = trimTer === 99 ? -1 : trimTer;
  ter.flag1 = old.flag1;
  ter.flag2 = old.flag2;
  switch (old.special) {
    case 0:
      if (i === 7 || i === 10 || i === 13 || i === 16) {
        ter.special = TerSpec.NONE;
        ter.flag1 = 87;
        ter.flag2 = ter.flag3 = 0;
      } else if (picture === 215 || (picture >= 218 && picture <= 221)) {
        picture = 215;
        ter.special = TerSpec.NONE;
        ter.flag1 = 63;
        ter.flag2 = ter.flag3 = 0;
      } else if (picture === 216 || (picture >= 222 && picture <= 225)) {
        picture = 215;
        ter.special = TerSpec.NONE;
        ter.flag1 = 62;
        ter.flag2 = ter.flag3 = 0;
      } else if (picture === 143) {
        ter.special = TerSpec.BED;
        ter.flag1 = 230;
        ter.flag2 = ter.flag3 = 0;
      } else if ((picture >= 61 && picture <= 66) || picture === 961 || picture === 962) {
        ter.special = TerSpec.BRIDGE;
        ter.flag1 = ter.flag2 = ter.flag3 = 0;
      } else {
        ter.special = TerSpec.NONE;
        ter.flag1 = -1;
        ter.flag2 = ter.flag3 = 0;
      }
      break;
    case 1:
      ter.special = TerSpec.CHANGE_WHEN_STEP_ON;
      if (ter.flag2 === 200) ter.flag2 = -1;
      ter.flag3 = 0;
      break;
    case 2: ter.special = TerSpec.DAMAGING; ter.flag3 = DamageType.FIRE; break;
    case 3: ter.special = TerSpec.DAMAGING; ter.flag3 = DamageType.COLD; break;
    case 4: ter.special = TerSpec.DAMAGING; ter.flag3 = DamageType.MAGIC; break;
    case 5: ter.special = TerSpec.DANGEROUS; ter.flag3 = Status.POISON; break;
    case 6: ter.special = TerSpec.DANGEROUS; ter.flag3 = Status.DISEASE; break;
    case 7:
      ter.special = TerSpec.CRUMBLING;
      ter.flag2 = 0; // destroyed by Move Mountains but not by quickfire
      break;
    case 8: ter.special = TerSpec.LOCKABLE; ter.flag3 = 0; break;
    case 9: ter.special = TerSpec.UNLOCKABLE; ter.flag3 = 0; break; // can't bash
    case 10: ter.special = TerSpec.UNLOCKABLE; ter.flag3 = 1; break; // can bash
    case 11: ter.special = TerSpec.IS_A_SIGN; ter.flag3 = 0; break;
    case 12: ter.special = TerSpec.CALL_SPECIAL; ter.flag2 = 1; ter.flag3 = -1; break; // local
    case 13: ter.special = TerSpec.CALL_SPECIAL; ter.flag2 = 0; ter.flag3 = -1; break; // global
    case 14: ter.special = TerSpec.IS_A_CONTAINER; ter.flag3 = 0; break;
    case 15:
      ter.special = TerSpec.WATERFALL_CAVE;
      ter.flag1 = DIR_S;
      ter.flag2 = 5;
      ter.flag3 = 90;
      break;
    case 16: ter.special = TerSpec.CONVEYOR; ter.flag1 = DIR_N; ter.flag3 = 0; break;
    case 17: ter.special = TerSpec.CONVEYOR; ter.flag1 = DIR_E; ter.flag3 = 0; break;
    case 18: ter.special = TerSpec.CONVEYOR; ter.flag1 = DIR_S; ter.flag3 = 0; break;
    case 19: ter.special = TerSpec.CONVEYOR; ter.flag1 = DIR_W; ter.flag3 = 0; break;
    case 20: ter.special = TerSpec.BLOCKED_TO_MONSTERS; ter.flag3 = 0; break;
    case 21: ter.special = TerSpec.TOWN_ENTRANCE; ter.flag3 = 0; break;
    case 22: ter.special = TerSpec.CHANGE_WHEN_USED; ter.flag3 = 0; break;
    case 23: ter.special = TerSpec.CALL_SPECIAL_WHEN_USED; ter.flag2 = 0; ter.flag3 = -1; break;
    default: break;
  }
  ter.transToWhat = old.transToWhat;
  ter.flyOver = old.flyOver !== 0;
  ter.boatOver = old.boatOver !== 0;
  // "because it's now redundant and unhelpful"
  ter.blockHorse = ter.special === TerSpec.DANGEROUS ? false : old.blockHorse !== 0;
  ter.lightRadius = old.lightRadius;
  ter.stepSound = old.stepSound as StepSound;
  // The XML writer keeps a shortcut only in 1..126, and this port reads it back
  // as a one-character string.
  ter.shortcutKey = old.shortcutKey > 0 && old.shortcutKey < 0x7f ? String.fromCharCode(old.shortcutKey) : '';
  const object = (num: number, px: number, py: number, sx: number, sy: number): void => {
    ter.objNum = num;
    ter.objPos = { x: px, y: py };
    ter.objSize = { x: sx, y: sy };
  };
  switch (picture) {
    // Rubbles, plus pentagram as a bonus
    case 68: object(1, 0, 0, 2, 1); break;
    case 69: object(1, 1, 0, 2, 1); break;
    case 86: object(2, 0, 0, 2, 1); break;
    case 87: object(2, 1, 0, 2, 1); break;
    case 247: picture = 210; object(3, 0, 0, 2, 2); break;
    case 248: picture = 211; object(3, 1, 0, 2, 2); break;
    case 249: picture = 212; object(3, 0, 1, 2, 2); break;
    case 250: picture = 213; object(3, 1, 1, 2, 2); break;
    // Roads
    case 202: picture = 0; i = LEGACY_ROAD; break;
    case 203: picture = 2; i = LEGACY_ROAD; break;
    case 204: picture = 32; i = LEGACY_ROAD; break;
    // Special spaces
    case 207: picture = 0; i = LEGACY_SPECIAL_SPOT; break;
    case 208: picture = 123; i = LEGACY_SPECIAL_SPOT; break;
    case 209: picture = 157; i = LEGACY_SPECIAL_SPOT; break;
    case 210: picture = 163; i = LEGACY_SPECIAL_SPOT; break;
    case 211: picture = 2; i = LEGACY_SPECIAL_SPOT; break;
    case 212: picture = 32; i = LEGACY_SPECIAL_SPOT; break;
    // Misc
    case 215: case 218: case 219: case 220: case 221:
    case 222: case 223: case 224: case 225:
      picture = 216;
      break;
    case 233: picture = 137; break;
    case 213: picture = 214; break;
    case 214: picture = 215; break;
    case 246: picture = 209; break;
    case 251: picture = 207; break;
    case 252: picture = 208; break;
    default: break;
  }
  ter.picture = picture;
  ter.mapPic = picture < 1000 ? picture : NO_PIC;
  if (i === 1) { ter.frillFor = 0; ter.frillChance = 10; }
  else if (i === 3) { ter.frillFor = 2; ter.frillChance = 15; }
  else if (i === 4) { ter.frillFor = 2; ter.frillChance = 10; }
  else if (i === 37) { ter.frillFor = 36; ter.frillChance = 25; }
  return { ter, mark: i };
}

// ---------------------------------------------------------------- specials

/** Terrain pictures a legacy dialog node names, remapped as terrains are. */
function remapTerrainPic(pic: number): number {
  switch (pic) {
    case 247: return 210;
    case 248: return 211;
    case 249: return 212;
    case 250: return 213;
    case 202: return 0;
    case 203: return 2;
    case 204: return 32;
    case 207: return 0;
    case 208: return 123;
    case 209: return 210;
    case 210: return 163;
    case 211: return 2;
    case 212: return 32;
    case 218: case 219: case 220: case 221:
    case 222: case 223: case 224: case 225:
    case 215: return 216;
    case 233: return 137;
    case 213: return 214;
    case 214: return 215;
    case 246: return 209;
    case 251: return 207;
    case 252: return 208;
    default: return pic;
  }
}

/** The legacy node types that were simply renumbered. */
const SIMPLE_NODES: Record<number, SpecType> = {
  0: SpecType.NONE, 1: SpecType.SET_SDF, 2: SpecType.INC_SDF, 3: SpecType.DISPLAY_MSG,
  5: SpecType.DISPLAY_SM_MSG, 6: SpecType.FLIP_SDF, 12: SpecType.CHANGE_TIME,
  13: SpecType.SCEN_TIMER_START, 14: SpecType.PLAY_SOUND, 15: SpecType.CHANGE_HORSE_OWNER,
  16: SpecType.CHANGE_BOAT_OWNER, 17: SpecType.SET_TOWN_VISIBILITY,
  18: SpecType.MAJOR_EVENT_OCCURRED, 19: SpecType.FORCED_GIVE, 20: SpecType.BUY_ITEMS_OF_TYPE,
  21: SpecType.CALL_GLOBAL, 22: SpecType.SET_SDF_ROW, 23: SpecType.COPY_SDF, 25: SpecType.REST,
  27: SpecType.END_SCENARIO, 50: SpecType.ONCE_GIVE_ITEM, 51: SpecType.ONCE_GIVE_SPEC_ITEM,
  52: SpecType.ONCE_NULL, 53: SpecType.ONCE_SET_SDF, 54: SpecType.ONCE_DISPLAY_MSG,
  61: SpecType.ONCE_OUT_ENCOUNTER, 62: SpecType.ONCE_TOWN_ENCOUNTER, 80: SpecType.SELECT_TARGET,
  81: SpecType.DAMAGE, 82: SpecType.AFFECT_HP, 84: SpecType.AFFECT_XP,
  85: SpecType.AFFECT_SKILL_PTS, 86: SpecType.AFFECT_DEADNESS, 98: SpecType.AFFECT_STAT,
  101: SpecType.AFFECT_GOLD, 102: SpecType.AFFECT_FOOD, 103: SpecType.AFFECT_ALCHEMY,
  130: SpecType.IF_SDF, 131: SpecType.IF_TOWN_NUM, 132: SpecType.IF_RANDOM,
  133: SpecType.IF_HAVE_SPECIAL_ITEM, 134: SpecType.IF_SDF_COMPARE, 147: SpecType.IF_DAY_REACHED,
  150: SpecType.IF_EVENT_OCCURRED, 155: SpecType.IF_SDF_EQ, 174: SpecType.TOWN_MOVE_PARTY,
  175: SpecType.TOWN_HIT_SPACE, 176: SpecType.TOWN_EXPLODE_SPACE, 177: SpecType.TOWN_LOCK_SPACE,
  178: SpecType.TOWN_UNLOCK_SPACE, 179: SpecType.TOWN_SFX_BURST,
  180: SpecType.TOWN_CREATE_WANDERING, 181: SpecType.TOWN_PLACE_MONST,
  184: SpecType.TOWN_GENERIC_LEVER, 185: SpecType.TOWN_GENERIC_PORTAL,
  186: SpecType.TOWN_GENERIC_BUTTON, 187: SpecType.TOWN_GENERIC_STAIR,
  191: SpecType.TOWN_RELOCATE, 192: SpecType.TOWN_PLACE_ITEM, 195: SpecType.TOWN_TIMER_START,
  213: SpecType.RECT_DESTROY_ITEMS, 214: SpecType.RECT_CHANGE_TER, 215: SpecType.RECT_SWAP_TER,
  216: SpecType.RECT_TRANS_TER, 217: SpecType.RECT_LOCK, 218: SpecType.RECT_UNLOCK,
  225: SpecType.OUT_MAKE_WANDER, 227: SpecType.OUT_PLACE_ENCOUNTER, 228: SpecType.OUT_MOVE_PARTY,
  // Added in the Windows version, later on the Mac.
  29: SpecType.SDF_RANDOM, 156: SpecType.IF_SPECIES, 196: SpecType.TOWN_CHANGE_LIGHTING,
  197: SpecType.TOWN_SET_ATTITUDE,
};

const PLACE_FIELD: Record<number, FieldType> = {
  200: FieldType.WALL_FIRE, 201: FieldType.WALL_FORCE, 202: FieldType.WALL_ICE,
  203: FieldType.WALL_BLADES, 204: FieldType.CLOUD_STINK, 205: FieldType.CLOUD_SLEEP,
  206: FieldType.FIELD_QUICKFIRE, 207: FieldType.BARRIER_FIRE, 208: FieldType.BARRIER_FORCE,
  209: FieldType.FIELD_DISPEL,
};

const AFFECT_STATUS: Record<number, Status> = {
  87: Status.POISON, 88: Status.HASTE_SLOW, 89: Status.INVULNERABLE,
  90: Status.MAGIC_RESISTANCE, 91: Status.WEBS, 92: Status.DISEASE, 93: Status.INVISIBLE,
  94: Status.BLESS_CURSE, 95: Status.DUMB, 96: Status.ASLEEP, 97: Status.PARALYZED,
};

/**
 * Things the conversion wants a person to know — `showWarning`/`showError` in
 * the C++, which would put up a dialog in the middle of loading.
 */
export type ImportWarn = (message: string) => void;

/** `cSpecial::import_legacy`. */
export function convertSpecial(old: LegacySpecial, warn: ImportWarn): SpecialNode {
  const n = emptySpecialNode();
  n.sd1 = old.sd1;
  n.sd2 = old.sd2;
  n.pic = old.pic;
  n.m1 = old.m1;
  n.m2 = old.m2;
  n.ex1a = old.ex1a;
  n.ex1b = old.ex1b;
  n.ex2a = old.ex2a;
  n.ex2b = old.ex2b;
  n.jumpto = old.jumpto;
  const simple = SIMPLE_NODES[old.type];
  if (simple !== undefined) {
    n.type = simple;
    return n;
  }
  const field = PLACE_FIELD[old.type];
  if (field !== undefined) {
    n.type = SpecType.RECT_PLACE_FIELD;
    n.sd2 = field;
    return n;
  }
  const status = AFFECT_STATUS[old.type];
  if (status !== undefined) {
    n.type = SpecType.AFFECT_STATUS;
    n.ex1c = status;
    return n;
  }
  // "Duplicate Leave button" — shared by the three big-dialog families.
  const leaveFix = (): void => {
    if (n.type !== SpecType.ONCE_DIALOG) return;
    if (old.ex1a === 20) n.ex1a = 9;
    if (old.ex2a === 20) n.ex2a = 9;
  };
  switch (old.type) {
    case 83: n.type = SpecType.AFFECT_SP; n.ex1c = 0; break;
    case 170:
      n.type = SpecType.MAKE_TOWN_HOSTILE;
      n.ex1a = 0;
      n.ex1b = -1;
      n.ex2a = 1;
      break;
    case 212: n.type = SpecType.RECT_MOVE_ITEMS; n.pictype = 1; break;
    case 55: case 58: case 189: case 190: // big dialogs with 36×36 dialog pictures
      if (n.pic >= 700 && n.pic < 1000) n.pic -= 700;
      n.pictype = PIC_DLOG;
      n.m3 = n.m2;
      n.m2 = -1;
      if (old.type === 55) n.type = SpecType.ONCE_DIALOG;
      else if (old.type === 58) n.type = SpecType.ONCE_GIVE_ITEM_DIALOG;
      else if (old.type === 190) n.type = SpecType.TOWN_STAIR;
      else n.type = SpecType.TOWN_PORTAL;
      leaveFix();
      break;
    case 57: case 60: // big dialogs with monster pictures
      if (n.pic >= 400 && n.pic < 1000) n.pic -= 400;
      if (n.pic === 122) n.pic = 119;
      n.pictype = PIC_MONST;
      n.m3 = n.m2;
      n.m2 = -1;
      n.type = old.type === 57 ? SpecType.ONCE_DIALOG : SpecType.ONCE_GIVE_ITEM_DIALOG;
      leaveFix();
      break;
    case 56: case 59: case 188: // big dialogs with terrain pictures
      n.pictype = PIC_TER;
      n.m3 = n.m2;
      n.m2 = -1;
      n.pic = remapTerrainPic(n.pic);
      if (old.type === 56) n.type = SpecType.ONCE_DIALOG;
      else if (old.type === 59) n.type = SpecType.ONCE_GIVE_ITEM_DIALOG;
      else n.type = SpecType.TOWN_LEVER;
      leaveFix();
      break;
    // TODO(M8) in the C++ too: the old block nodes printed a message, which
    // IF_CONTEXT can't. "Will probably need to make special nodes a dynamic
    // vector before fixing this."
    case 7: case 8: case 9: case 10: // out, town, combat, look block
      n.type = SpecType.IF_CONTEXT;
      n.ex1b = n.ex1a;
      if (old.type === 7) n.ex1a = SpecCtx.OUT_MOVE;
      if (old.type === 8) n.ex1a = SpecCtx.TOWN_MOVE;
      if (old.type === 9) n.ex1a = SpecCtx.COMBAT_MOVE;
      if (old.type === 10) n.type = SpecType.IF_LOOKING;
      break;
    case 24: // ritual of sanctification
      n.type = SpecType.IF_CONTEXT;
      n.ex1c = n.jumpto;
      n.jumpto = n.ex1b;
      n.ex1a = SpecCtx.TARGET;
      n.ex1b = Spell.RITUAL_SANCTIFY;
      break;
    case 99: case 100: // add mage/priest spell
      n.type = old.type === 99 ? SpecType.AFFECT_MAGE_SPELL : SpecType.AFFECT_PRIEST_SPELL;
      n.ex1a += 30;
      n.ex1b = 0; // give, not take
      break;
    case 148: case 149: // if barrels / crates
      n.type = SpecType.IF_FIELDS;
      n.m1 = old.type === 148 ? FieldType.OBJECT_BARREL : FieldType.OBJECT_CRATE;
      n.m2 = n.ex1b;
      n.ex1a = n.ex1b = 0;
      n.ex2a = n.ex2b = 64;
      n.sd1 = 1;
      n.sd2 = 32767; // std::numeric_limits<short>::max()
      break;
    case 151: case 152: // if cave lore / woodsman
      n.type = SpecType.IF_TRAIT;
      n.ex1a = old.type - 147;
      n.ex2a = 1; // at least one PC
      n.ex2b = 2;
      break;
    case 63: // trap, forced to one picture
      n.type = SpecType.ONCE_TRAP;
      n.pic = 27;
      n.pictype = PIC_DLOG;
      break;
    case 153: // if enough mage lore
      n.type = SpecType.IF_STATISTIC;
      if (n.ex2a >= 0) {
        // The Windows version grew "if statistic" much earlier.
        switch (n.ex2a) {
          case 20: n.ex2a = 19; break; // max HP
          case 22: n.ex2a = 20; break; // max SP
          case 19: n.ex2a = 100; break; // current HP
          case 21: n.ex2a = 101; break; // current SP
          case 23: n.ex2a = 102; break; // experience
          case 24: n.ex2a = 103; break; // skill points
          case 25: n.ex2a = 104; break; // level
          default: break;
        }
      } else n.ex2a = Skill.MAGE_LORE;
      n.ex2b = 0;
      break;
    case 154: // text response
      n.type = SpecType.IF_TEXT_RESPONSE;
      n.ex1a -= 160;
      n.ex2a -= 160;
      break;
    case 229: // outdoor store — fix the spell ids
      n.type = SpecType.ENTER_SHOP;
      if (n.ex1b === 1 || n.ex1b === 2) n.ex1a += 30;
      break;
    case 4: // secret passage
      n.type = SpecType.CANT_ENTER;
      n.ex1a = 0;
      n.ex2a = 1;
      break;
    case 11: // can't enter
      n.type = SpecType.CANT_ENTER;
      n.ex1a = n.ex1a === 0 ? 0 : 1;
      n.ex2a = 0;
      break;
    case 26: // wandering will fight
      n.type = SpecType.CANT_ENTER;
      n.ex1a = 1 - n.ex1a;
      n.ex2a = 0;
      break;
    case 171: case 226: n.type = SpecType.CHANGE_TER; break;
    case 172: n.type = SpecType.SWAP_TER; break;
    case 173: n.type = SpecType.TRANS_TER; break;
    case 135: case 136: n.type = SpecType.IF_TER_TYPE; break;
    case 137: case 142: n.type = SpecType.IF_HAS_GOLD; n.ex2a = Math.trunc((old.type - 137) / 5); break;
    case 138: case 143: n.type = SpecType.IF_HAS_FOOD; n.ex2a = Math.trunc((old.type - 138) / 5); break;
    case 139: case 144:
      n.type = SpecType.IF_ITEM_CLASS_ON_SPACE;
      n.ex2c = Math.trunc((old.type - 139) / 5);
      break;
    case 140: case 145:
      n.type = SpecType.IF_HAVE_ITEM_CLASS;
      n.ex2a = Math.trunc((old.type - 140) / 5);
      break;
    case 141: case 146:
      n.type = SpecType.IF_EQUIP_ITEM_CLASS;
      n.ex2a = Math.trunc((old.type - 141) / 5);
      break;
    case 182: // destroy all monsters of one type
      n.type = SpecType.TOWN_NUKE_MONSTS;
      // 0, -1 and -2 mean all / friendly / hostile, so a type can't use them.
      if (n.ex1a >= -2 && n.ex1a <= 0) n.ex1a = -3;
      break;
    case 183: // destroy all, or all friendly / hostile
      n.type = SpecType.TOWN_NUKE_MONSTS;
      n.ex1a = 0 - n.ex1a; // not `-n.ex1a`, which makes 0 into -0
      break;
    case 193:
      n.type = SpecType.TOWN_SPLIT_PARTY;
      if (n.ex2a > 0) n.ex2a = 10;
      break;
    case 194:
      n.type = SpecType.TOWN_REUNITE_PARTY;
      if (n.ex1a > 0) n.ex1a = 10;
      n.ex2a = 0;
      break;
    case 104: n.type = SpecType.AFFECT_PARTY_STATUS; n.ex1b = 0; n.ex2a = PartyStatus.STEALTH; break;
    case 105: n.type = SpecType.AFFECT_PARTY_STATUS; n.ex1b = 0; n.ex2a = PartyStatus.FIREWALK; break;
    case 106: n.type = SpecType.AFFECT_PARTY_STATUS; n.ex1b = 0; n.ex2a = PartyStatus.FLIGHT; break;
    case 210: n.type = SpecType.RECT_PLACE_FIELD; n.sd2 += FieldType.SFX_SMALL_BLOOD; break;
    case 211:
      n.type = SpecType.RECT_PLACE_FIELD;
      switch (old.sd2) {
        case 0: n.sd2 = FieldType.FIELD_WEB; break;
        case 1: n.sd2 = FieldType.OBJECT_BARREL; break;
        case 2: n.sd2 = FieldType.OBJECT_CRATE; break;
        default: break;
      }
      break;
    case 28:
      n.type = SpecType.DISPLAY_PICTURE;
      warn("This scenario contains a Display Picture special node from the 'Classic Windows' "
        + 'version of the game. Its format is incompatible and it cannot be converted.');
      n.ex1a = 0;
      break;
    case -1:
      break;
    default:
      // The C++ leaves the default-constructed NONE.
      if (old.type >= 0 && old.type < 255) warn(`Unrecognized node type found: ${old.type}`);
      break;
  }
  return n;
}

// ---------------------------------------------------------------- monsters

/** eMonstAbilTemplate — only the ones a legacy monster can be given. */
type LegacyAbilTemplate =
  | 'THROWS_DARTS' | 'SHOOTS_ARROWS' | 'THROWS_SPEARS' | 'THROWS_ROCKS1' | 'THROWS_ROCKS2'
  | 'THROWS_ROCKS3' | 'THROWS_RAZORDISKS' | 'GOOD_ARCHER' | 'SHOOTS_SPINES'
  | 'RAY_PETRIFY' | 'RAY_SP_DRAIN' | 'RAY_HEAT' | 'RAY_PARALYSIS'
  | 'BREATH_FIRE' | 'BREATH_FROST' | 'BREATH_ELECTRICITY' | 'BREATH_DARKNESS' | 'BREATH_FOUL'
  | 'BREATH_SLEEP' | 'SPIT_ACID' | 'SHOOTS_WEB'
  | 'TOUCH_POISON' | 'TOUCH_ACID' | 'TOUCH_DISEASE' | 'TOUCH_WEB' | 'TOUCH_SLEEP' | 'TOUCH_DUMB'
  | 'TOUCH_PARALYSIS' | 'TOUCH_PETRIFY' | 'TOUCH_DEATH' | 'TOUCH_XP_DRAIN' | 'TOUCH_ICY'
  | 'TOUCH_ICY_DRAINING' | 'TOUCH_STUN' | 'TOUCH_STEAL_FOOD'
  | 'SPLITS' | 'MARTYRS_SHIELD' | 'ABSORB_SPELLS' | 'SUMMON_5' | 'SUMMON_20' | 'SUMMON_50'
  | 'DEATH_TRIGGERS'
  | 'RADIATE_FIRE' | 'RADIATE_ICE' | 'RADIATE_SHOCK' | 'RADIATE_ANTIMAGIC' | 'RADIATE_SLEEP'
  | 'RADIATE_STINK';

/**
 * `cMonster::addAbil` for the legacy templates. The C++ fills a union with an
 * aggregate initializer, so a short one leaves the trailing members zero —
 * `TOUCH_PARALYSIS`'s `{true, TOUCH, -1, 500}` is strength 500, range 0,
 * **odds 0**. Kept: it is what the bundled scenarios were converted with.
 */
function addAbil(mon: Monster, what: LegacyAbilTemplate, param = 0): void {
  const missile = (type: MonstMissile, pic: number, dice: number, sides: number, skill: number,
    range: number, odds: number): void => {
    const a = mon.abil[MonstAbil.MISSILE]!;
    a.active = true;
    a.missile = { type, pic, dice, sides, skill, range, odds };
  };
  const gen = (key: MonstAbil, type: MonstGen, pic: number, strength: number, range = 0,
    odds = 0, extra?: number): void => {
    const a = mon.abil[key]!;
    a.active = true;
    a.gen = { type, pic, strength, range, odds, extra: extra ?? a.gen.extra };
  };
  const special = (key: MonstAbil, extra1: number, extra2 = 0, extra3 = 0): void => {
    const a = mon.abil[key]!;
    a.active = true;
    a.special = { extra1, extra2, extra3 };
  };
  const summon = (chance: number): void => {
    const a = mon.abil[MonstAbil.SUMMON]!;
    a.active = true;
    a.summon = { type: MonstSummon.TYPE, what: param, min: 1, max: 1, len: 130, chance };
  };
  const radiate = (type: FieldType): void => {
    const a = mon.abil[MonstAbil.RADIATE]!;
    a.active = true;
    a.radiate = { type, chance: param, pat: SpellPat.SQUARE };
  };
  switch (what) {
    case 'THROWS_DARTS': missile(MonstMissile.DART, 1, 1, 7, 2, 6, 500); break;
    case 'SHOOTS_ARROWS': missile(MonstMissile.ARROW, 3, 2, 7, 4, 8, 750); break;
    case 'THROWS_SPEARS': missile(MonstMissile.SPEAR, 5, 3, 7, 6, 8, 625); break;
    case 'THROWS_ROCKS1': missile(MonstMissile.BOULDER, 12, 4, 7, 8, 10, 625); break;
    case 'THROWS_ROCKS2': missile(MonstMissile.BOULDER, 12, 6, 7, 12, 10, 500); break;
    case 'THROWS_ROCKS3': missile(MonstMissile.BOULDER, 12, 8, 7, 16, 10, 500); break;
    case 'THROWS_RAZORDISKS': missile(MonstMissile.RAZORDISK, 7, 7, 7, 14, 8, 625); break;
    case 'GOOD_ARCHER': missile(MonstMissile.RAPID_ARROW, 3, 8, 7, 16, 10, 875); break;
    case 'SHOOTS_SPINES': missile(MonstMissile.SPINE, 5, 6, 7, 12, 9, 625); break;
    case 'RAY_PETRIFY': gen(MonstAbil.PETRIFY, MonstGen.GAZE, -1, 25, 6, 625); break;
    case 'RAY_SP_DRAIN': gen(MonstAbil.DRAIN_SP, MonstGen.GAZE, 8, 50, 8, 625); break;
    case 'RAY_HEAT': special(MonstAbil.RAY_HEAT, 6, 625, 7); break;
    case 'RAY_PARALYSIS': gen(MonstAbil.STATUS, MonstGen.RAY, -1, 100, 6, 750, Status.PARALYZED); break;
    case 'BREATH_FIRE': gen(MonstAbil.DAMAGE2, MonstGen.BREATH, 13, param, 8, 375, DamageType.FIRE); break;
    case 'BREATH_FROST': gen(MonstAbil.DAMAGE2, MonstGen.BREATH, 6, param, 8, 375, DamageType.COLD); break;
    case 'BREATH_ELECTRICITY':
      gen(MonstAbil.DAMAGE2, MonstGen.BREATH, 8, param, 8, 375, DamageType.MAGIC);
      break;
    case 'BREATH_DARKNESS':
      gen(MonstAbil.DAMAGE2, MonstGen.BREATH, 8, param, 8, 375, DamageType.UNBLOCKABLE);
      break;
    case 'BREATH_FOUL':
      gen(MonstAbil.FIELD, MonstGen.BREATH, 12, SpellPat.SINGLE, 6, 375, FieldType.CLOUD_STINK);
      break;
    case 'BREATH_SLEEP':
      gen(MonstAbil.FIELD, MonstGen.BREATH, 0, SpellPat.RADIUS_2, 8, 750, FieldType.CLOUD_SLEEP);
      break;
    case 'SPIT_ACID': gen(MonstAbil.STATUS, MonstGen.SPIT, 0, 6, 6, 500, Status.ACID); break;
    case 'SHOOTS_WEB': special(MonstAbil.MISSILE_WEB, 4, 375); break;
    case 'TOUCH_POISON': gen(MonstAbil.STATUS2, MonstGen.TOUCH, -1, param, 0, 1000, Status.POISON); break;
    case 'TOUCH_ACID':
      gen(MonstAbil.STATUS, MonstGen.TOUCH, -1, mon.level > 20 ? 4 : 2, 0, 1000, Status.ACID);
      break;
    case 'TOUCH_DISEASE': gen(MonstAbil.STATUS, MonstGen.TOUCH, -1, 6, 0, 667, Status.DISEASE); break;
    case 'TOUCH_WEB': gen(MonstAbil.STATUS, MonstGen.TOUCH, -1, 5, 0, 1000, Status.WEBS); break;
    case 'TOUCH_SLEEP': gen(MonstAbil.STATUS, MonstGen.TOUCH, -1, 6, 0, 1000, Status.ASLEEP); break;
    case 'TOUCH_DUMB': gen(MonstAbil.STATUS, MonstGen.TOUCH, -1, 2, 0, 1000, Status.DUMB); break;
    case 'TOUCH_PARALYSIS': gen(MonstAbil.STATUS, MonstGen.TOUCH, -1, 500, 0, 0, Status.PARALYZED); break;
    case 'TOUCH_PETRIFY': gen(MonstAbil.PETRIFY, MonstGen.TOUCH, -1, 25); break;
    case 'TOUCH_DEATH': gen(MonstAbil.KILL, MonstGen.TOUCH, -1, 2, 0, 667); break;
    case 'TOUCH_ICY':
      gen(MonstAbil.DAMAGE, MonstGen.TOUCH, -1, 3, 0, 667, DamageType.COLD);
      break;
    case 'TOUCH_ICY_DRAINING': // falls through to XP_DRAIN in the C++
      gen(MonstAbil.DAMAGE, MonstGen.TOUCH, -1, 3, 0, 667, DamageType.COLD);
      gen(MonstAbil.DRAIN_XP, MonstGen.TOUCH, -1, 150);
      break;
    case 'TOUCH_XP_DRAIN': gen(MonstAbil.DRAIN_XP, MonstGen.TOUCH, -1, 150); break;
    case 'TOUCH_STUN': gen(MonstAbil.STUN, MonstGen.TOUCH, -1, 2, 0, 667, Status.HASTE_SLOW); break;
    case 'TOUCH_STEAL_FOOD': gen(MonstAbil.STEAL_FOOD, MonstGen.TOUCH, -1, 10, 0, 667); break;
    case 'SPLITS': special(MonstAbil.SPLITS, 1000, 0, 0); mon.amorphous = true; break;
    case 'MARTYRS_SHIELD': special(MonstAbil.MARTYRS_SHIELD, 1000, 100, 0); break;
    case 'ABSORB_SPELLS': special(MonstAbil.ABSORB_SPELLS, 1000, 3, 0); break;
    case 'SUMMON_5': summon(50); break;
    case 'SUMMON_20': summon(200); break;
    case 'SUMMON_50': summon(500); break;
    case 'DEATH_TRIGGERS': special(MonstAbil.DEATH_TRIGGER, param, 0); break;
    case 'RADIATE_FIRE': radiate(FieldType.WALL_FIRE); break;
    case 'RADIATE_ICE': radiate(FieldType.WALL_ICE); break;
    case 'RADIATE_SHOCK': radiate(FieldType.WALL_FORCE); break;
    case 'RADIATE_ANTIMAGIC': radiate(FieldType.FIELD_ANTIMAGIC); break;
    case 'RADIATE_SLEEP': radiate(FieldType.CLOUD_SLEEP); break;
    case 'RADIATE_STINK': radiate(FieldType.CLOUD_STINK); break;
  }
}

const SPEC_SKILL: Record<number, LegacyAbilTemplate> = {
  1: 'THROWS_DARTS', 2: 'SHOOTS_ARROWS', 3: 'THROWS_SPEARS', 4: 'THROWS_ROCKS1',
  5: 'THROWS_ROCKS2', 6: 'THROWS_ROCKS3', 7: 'THROWS_RAZORDISKS', 8: 'RAY_PETRIFY',
  9: 'RAY_SP_DRAIN', 10: 'RAY_HEAT', 12: 'SPLITS', 14: 'BREATH_FOUL', 15: 'TOUCH_ICY',
  16: 'TOUCH_XP_DRAIN', 17: 'TOUCH_ICY_DRAINING', 18: 'TOUCH_STUN', 19: 'SHOOTS_WEB',
  20: 'GOOD_ARCHER', 21: 'TOUCH_STEAL_FOOD', 22: 'MARTYRS_SHIELD', 23: 'RAY_PARALYSIS',
  24: 'TOUCH_DUMB', 25: 'TOUCH_DISEASE', 26: 'ABSORB_SPELLS', 27: 'TOUCH_WEB', 28: 'TOUCH_SLEEP',
  29: 'TOUCH_PARALYSIS', 30: 'TOUCH_PETRIFY', 31: 'TOUCH_ACID', 32: 'BREATH_SLEEP',
  33: 'SPIT_ACID', 34: 'SHOOTS_SPINES', 35: 'TOUCH_DEATH',
};

const RADIATE: Record<number, LegacyAbilTemplate> = {
  1: 'RADIATE_FIRE', 2: 'RADIATE_ICE', 3: 'RADIATE_SHOCK', 4: 'RADIATE_ANTIMAGIC',
  5: 'RADIATE_SLEEP', 6: 'RADIATE_STINK', 10: 'SUMMON_5', 11: 'SUMMON_20', 12: 'SUMMON_50',
  15: 'DEATH_TRIGGERS',
};

const BREATH: LegacyAbilTemplate[] = ['BREATH_FIRE', 'BREATH_FROST', 'BREATH_ELECTRICITY', 'BREATH_DARKNESS'];

/** Two immunity bits per damage type: full, then half (monster.cpp). */
function resistFrom(immunities: number, halfBit: number): number {
  if (immunities & (halfBit << 1)) return 0;
  if (immunities & halfBit) return 50;
  return 100;
}

/**
 * `cMonster::import_legacy`. The name comes later, from `monst_names`
 * (`cScenario::import_legacy(scen_item_data_type)`), which is also where
 * skeletons and goblins get their own races.
 */
export function convertMonster(old: LegacyMonster): Monster {
  const mon = defaultMonster();
  mon.level = old.level;
  mon.name = old.mName;
  mon.health = old.mHealth;
  mon.armor = old.armor;
  mon.skill = old.skill;
  // Always three, as `std::array<cAttack, 3>` is; an unused one has no dice,
  // which every reader of the list skips.
  // `dice` and `sides` are `unsigned short`, so a negative legacy value (only
  // ever garbage) wraps as it does in the C++.
  mon.attacks = old.a.map((a, i) => ({
    dice: Math.trunc(a / 100) & 0xffff,
    sides: (a % 100) & 0xffff,
    type: i === 0 ? old.a1Type : old.a23Type,
  }));
  // Nephil, slith and vahnatai were inserted after human.
  mon.race = old.mType ? old.mType + 3 : Race.HUMAN;
  mon.speed = old.speed;
  mon.mu = old.mu;
  mon.cl = old.cl;
  mon.treasure = old.treasure;
  const skill = SPEC_SKILL[old.specSkill];
  if (skill !== undefined) addAbil(mon, skill);
  else if (old.specSkill === 11) mon.invisible = true;
  else if (old.specSkill === 13) mon.mindless = true;
  else if (old.specSkill === 36) mon.invuln = true;
  else if (old.specSkill === 37) mon.guard = true;
  const rad = RADIATE[old.radiate1];
  if (rad !== undefined) addAbil(mon, rad, old.radiate2);
  if (old.poison > 0) addAbil(mon, 'TOUCH_POISON', old.poison);
  if (old.breath > 0) {
    const breath = BREATH[old.breathType];
    if (breath !== undefined) addAbil(mon, breath, old.breath);
  }
  mon.corpseItem = old.corpseItem;
  mon.corpseItemChance = old.corpseItemChance;
  mon.resist[DamageType.MAGIC] = resistFrom(old.immunities, 1);
  mon.resist[DamageType.FIRE] = resistFrom(old.immunities, 4);
  mon.resist[DamageType.COLD] = resistFrom(old.immunities, 16);
  mon.resist[DamageType.POISON] = resistFrom(old.immunities, 64);
  mon.xWidth = old.xWidth;
  mon.yWidth = old.yWidth;
  mon.defaultAttitude = old.defaultAttitude as Attitude;
  mon.summonType = old.summonType;
  mon.defaultFacialPic = old.defaultFacialPic === 0 ? NO_PIC : old.defaultFacialPic - 1;
  mon.pictureNum = old.pictureNum === 122 ? 119 : old.pictureNum;
  mon.seeSpec = -1;
  return mon;
}

// ---------------------------------------------------------------- items

/** A legacy ability number → ability, its `abil_data`, and any use-type change. */
interface AbilConv {
  ability: ItemAbil;
  data?: number;
}

const ITEM_ABILS: Record<number, AbilConv> = {
  0: { ability: ItemAbil.NONE },
  1: { ability: ItemAbil.DAMAGING_WEAPON, data: DamageType.UNBLOCKABLE },
  2: { ability: ItemAbil.SLAYER_WEAPON, data: Race.DEMON },
  3: { ability: ItemAbil.SLAYER_WEAPON, data: Race.UNDEAD },
  4: { ability: ItemAbil.SLAYER_WEAPON, data: Race.REPTILE },
  5: { ability: ItemAbil.SLAYER_WEAPON, data: Race.GIANT },
  6: { ability: ItemAbil.SLAYER_WEAPON, data: Race.MAGE },
  7: { ability: ItemAbil.SLAYER_WEAPON, data: Race.PRIEST },
  8: { ability: ItemAbil.SLAYER_WEAPON, data: Race.BUG },
  9: { ability: ItemAbil.STATUS_WEAPON, data: Status.ACID },
  10: { ability: ItemAbil.SOULSUCKER },
  11: { ability: ItemAbil.DRAIN_MISSILES },
  12: { ability: ItemAbil.WEAK_WEAPON },
  13: { ability: ItemAbil.CAUSES_FEAR },
  14: { ability: ItemAbil.STATUS_WEAPON, data: Status.POISON },
  30: { ability: ItemAbil.DAMAGE_PROTECTION, data: DamageType.WEAPON },
  31: { ability: ItemAbil.FULL_PROTECTION },
  34: { ability: ItemAbil.STATUS_PROTECTION, data: Status.POISON },
  36: { ability: ItemAbil.STATUS_PROTECTION, data: Status.ACID },
  41: { ability: ItemAbil.ACCURACY },
  42: { ability: ItemAbil.THIEVING },
  44: { ability: ItemAbil.LIGHTER_OBJECT },
  45: { ability: ItemAbil.HEAVIER_OBJECT },
  48: { ability: ItemAbil.LIFE_SAVING },
  49: { ability: ItemAbil.PROTECT_FROM_PETRIFY },
  50: { ability: ItemAbil.REGENERATE },
  51: { ability: ItemAbil.POISON_AUGMENT },
  53: { ability: ItemAbil.WILL },
  54: { ability: ItemAbil.FREE_ACTION },
  62: { ability: ItemAbil.STATUS_PROTECTION, data: Status.DISEASE },
  70: { ability: ItemAbil.POISON_WEAPON },
  71: { ability: ItemAbil.AFFECT_STATUS, data: Status.BLESS_CURSE },
  72: { ability: ItemAbil.AFFECT_STATUS, data: Status.POISON },
  73: { ability: ItemAbil.AFFECT_STATUS, data: Status.HASTE_SLOW },
  74: { ability: ItemAbil.AFFECT_STATUS, data: Status.INVULNERABLE },
  75: { ability: ItemAbil.AFFECT_STATUS, data: Status.MAGIC_RESISTANCE },
  76: { ability: ItemAbil.AFFECT_STATUS, data: Status.WEBS },
  77: { ability: ItemAbil.AFFECT_STATUS, data: Status.DISEASE },
  78: { ability: ItemAbil.AFFECT_STATUS, data: Status.INVISIBLE },
  79: { ability: ItemAbil.AFFECT_STATUS, data: Status.DUMB },
  80: { ability: ItemAbil.AFFECT_STATUS, data: Status.MARTYRS_SHIELD },
  81: { ability: ItemAbil.AFFECT_STATUS, data: Status.ASLEEP },
  82: { ability: ItemAbil.AFFECT_STATUS, data: Status.PARALYZED },
  83: { ability: ItemAbil.AFFECT_STATUS, data: Status.ACID },
  85: { ability: ItemAbil.AFFECT_EXPERIENCE },
  86: { ability: ItemAbil.AFFECT_SKILL_POINTS },
  87: { ability: ItemAbil.AFFECT_HEALTH },
  88: { ability: ItemAbil.AFFECT_SPELL_POINTS },
  95: { ability: ItemAbil.CALL_SPECIAL },
  129: { ability: ItemAbil.QUICKFIRE },
  150: { ability: ItemAbil.HOLLY },
  151: { ability: ItemAbil.COMFREY },
  152: { ability: ItemAbil.NETTLE },
  153: { ability: ItemAbil.WORMGRASS },
  154: { ability: ItemAbil.ASPTONGUE },
  155: { ability: ItemAbil.EMBERF },
  156: { ability: ItemAbil.GRAYMOLD },
  157: { ability: ItemAbil.MANDRAKE },
  158: { ability: ItemAbil.SAPPHIRE },
  159: { ability: ItemAbil.SMOKY_CRYSTAL },
  160: { ability: ItemAbil.RESURRECTION_BALM },
  161: { ability: ItemAbil.LOCKPICKS },
  170: { ability: ItemAbil.RETURNING_MISSILE },
  171: { ability: ItemAbil.DAMAGING_WEAPON, data: DamageType.FIRE },
  172: { ability: ItemAbil.EXPLODING_WEAPON, data: DamageType.FIRE },
  176: { ability: ItemAbil.HEALING_WEAPON },
};

/** Legacy abilities 110-135 that cast a spell at `strength * 2 + 1`. */
const CAST_SPELL: Record<number, Spell> = {
  110: Spell.FLAME, 111: Spell.FIREBALL, 112: Spell.FIRESTORM, 113: Spell.KILL,
  114: Spell.ICE_BOLT, 115: Spell.SLOW, 116: Spell.SHOCKWAVE, 117: Spell.DISPEL_UNDEAD,
  118: Spell.RAVAGE_SPIRIT, 121: Spell.ACID_SPRAY, 122: Spell.FOUL_VAPOR, 123: Spell.CLOUD_SLEEP,
  124: Spell.POISON, 125: Spell.SHOCKSTORM, 126: Spell.PARALYZE_BEAM, 127: Spell.GOO_BOMB,
  128: Spell.STRENGTHEN_TARGET, 130: Spell.CHARM_MASS, 131: Spell.MAGIC_MAP,
  132: Spell.DISPEL_BARRIER, 133: Spell.WALL_ICE_BALL, 135: Spell.ANTIMAGIC,
};

/** `cItem::import_legacy`. */
export function convertItem(old: LegacyItem): Item {
  const item = defaultItem();
  item.variety = old.variety as ItemType;
  item.itemLevel = old.itemLevel;
  item.awkward = old.awkward;
  item.bonus = old.bonus;
  item.protection = old.protection;
  item.charges = item.maxCharges = old.charges;
  item.weapType = old.type >= 1 && old.type <= 3 ? old.type + 2 : Skill.INVALID;
  if (item.variety === ItemType.BOW || item.variety === ItemType.CROSSBOW
    || item.variety === ItemType.MISSILE_NO_AMMO) item.weapType = Skill.ARCHERY;
  else if (item.variety === ItemType.THROWN_MISSILE) item.weapType = Skill.THROWN_MISSILES;
  item.magicUseType = old.magicUseType as ItemUse;
  let g = old.graphicNum;
  if (g >= 150) g += 850; // custom item graphic
  else if (g === 59) g = 74; // duplicate mushroom
  else if (g === 17) g = 133; // gauntlets moved to tinyobj
  else if (g >= 45) g += 10; // small graphics moved up
  item.graphicNum = g;
  item.abilStrength = old.abilityStrength;
  const conv = ITEM_ABILS[old.ability];
  const spell = CAST_SPELL[old.ability];
  const halve = (): void => { if (item.abilStrength >= 7) item.abilStrength = Math.trunc(item.abilStrength / 2); };
  if (conv !== undefined) {
    item.ability = conv.ability;
    if (conv.data !== undefined) item.abilData = conv.data;
  } else if (spell !== undefined) {
    item.ability = ItemAbil.CAST_SPELL;
    item.abilStrength = item.abilStrength * 2 + 1;
    item.abilData = spell;
  } else {
    switch (old.ability) {
      case 32: item.ability = ItemAbil.DAMAGE_PROTECTION; item.abilData = DamageType.FIRE; halve(); break;
      case 33: item.ability = ItemAbil.DAMAGE_PROTECTION; item.abilData = DamageType.COLD; halve(); break;
      case 35: item.ability = ItemAbil.DAMAGE_PROTECTION; item.abilData = DamageType.MAGIC; halve(); break;
      case 37:
        item.ability = ItemAbil.SKILL;
        item.abilData = item.abilStrength; // archived; SKILL doesn't read it
        item.abilStrength = item.itemLevel; // "to preserve legacy behaviour"
        break;
      case 38: case 39: case 40:
        item.ability = ItemAbil.BOOST_STAT;
        item.desc = `Original ability strength was ${item.abilStrength}`;
        item.abilStrength = 1;
        item.abilData = old.ability === 38 ? Skill.STRENGTH
          : old.ability === 39 ? Skill.DEXTERITY : Skill.INTELLIGENCE;
        break;
      case 43:
        item.ability = ItemAbil.GIANT_STRENGTH;
        item.abilData = item.abilStrength;
        item.abilStrength = item.itemLevel;
        break;
      case 46:
        item.ability = ItemAbil.OCCASIONAL_STATUS;
        item.abilData = Status.BLESS_CURSE;
        item.magicUseType = ItemUse.HELP_ONE;
        break;
      case 47:
        item.ability = ItemAbil.OCCASIONAL_STATUS;
        item.abilData = Status.HASTE_SLOW;
        item.magicUseType = ItemUse.HELP_ONE;
        break;
      case 52:
        item.ability = ItemAbil.OCCASIONAL_STATUS;
        item.abilData = Status.DISEASE;
        item.magicUseType = ItemUse.HARM_ALL;
        break;
      case 55:
        item.ability = ItemAbil.SPEED;
        item.abilData = item.abilStrength;
        item.abilStrength = Math.trunc(item.abilStrength / 7) + 1;
        break;
      case 56:
        item.ability = ItemAbil.SLOW_WEARER;
        item.abilData = item.abilStrength;
        item.abilStrength = Math.trunc(item.abilStrength / 5);
        break;
      case 57: item.ability = ItemAbil.DAMAGE_PROTECTION; item.abilData = DamageType.UNDEAD; halve(); break;
      case 58: item.ability = ItemAbil.DAMAGE_PROTECTION; item.abilData = DamageType.DEMON; halve(); break;
      case 59: item.ability = ItemAbil.PROTECT_FROM_SPECIES; item.abilData = Race.HUMANOID; halve(); break;
      case 60: item.ability = ItemAbil.PROTECT_FROM_SPECIES; item.abilData = Race.REPTILE; halve(); break;
      case 61: item.ability = ItemAbil.PROTECT_FROM_SPECIES; item.abilData = Race.GIANT; halve(); break;
      case 84:
        item.ability = ItemAbil.BLISS_DOOM;
        if (item.magicUseType === ItemUse.HARM_ONE) item.magicUseType = ItemUse.HELP_ONE;
        else if (item.magicUseType === ItemUse.HARM_ALL) item.magicUseType = ItemUse.HELP_ALL;
        break;
      case 89:
        item.ability = ItemAbil.BLISS_DOOM;
        if (item.magicUseType === ItemUse.HELP_ONE) item.magicUseType = ItemUse.HARM_ONE;
        else if (item.magicUseType === ItemUse.HELP_ALL) item.magicUseType = ItemUse.HARM_ALL;
        break;
      case 90:
        item.ability = ItemAbil.LIGHT;
        item.magicUseType = ItemUse.HELP_ALL;
        break;
      case 91: case 92: case 93:
        item.ability = ItemAbil.AFFECT_PARTY_STATUS;
        item.abilData = old.ability === 91 ? PartyStatus.STEALTH
          : old.ability === 92 ? PartyStatus.FIREWALK : PartyStatus.FLIGHT;
        item.magicUseType = ItemUse.HELP_ALL;
        break;
      case 94:
        item.ability = ItemAbil.HEALTH_POISON;
        if (item.magicUseType === ItemUse.HARM_ONE) item.magicUseType = ItemUse.HELP_ONE;
        else if (item.magicUseType === ItemUse.HARM_ALL) item.magicUseType = ItemUse.HELP_ALL;
        break;
      case 119:
        item.ability = ItemAbil.SUMMONING;
        item.abilData = item.abilStrength;
        item.abilStrength = 50;
        break;
      case 120:
        item.ability = ItemAbil.MASS_SUMMONING;
        item.abilData = item.abilStrength;
        item.abilStrength = 6;
        break;
      case 134: // the only spell that keeps its strength as it was
        item.ability = ItemAbil.CAST_SPELL;
        item.abilData = Spell.CHARM_FOE;
        break;
      case 173:
        item.ability = ItemAbil.STATUS_WEAPON;
        item.abilStrength *= 2;
        item.abilData = Status.ACID;
        break;
      case 174:
        item.ability = ItemAbil.SLAYER_WEAPON;
        item.abilStrength += 3;
        item.abilData = Race.UNDEAD;
        break;
      case 175:
        item.ability = ItemAbil.SLAYER_WEAPON;
        item.abilStrength += 3;
        item.abilData = Race.DEMON;
        break;
      default:
        break; // anything else keeps the default NONE
    }
  }
  item.typeFlag = old.typeFlag;
  item.isSpecial = old.isSpecial;
  item.value = old.value;
  item.weight = old.weight;
  item.specialClass = old.specialClass;
  item.itemLoc = { x: old.itemLoc.x, y: old.itemLoc.y };
  item.fullName = old.fullName;
  item.name = old.name;
  item.treasClass = old.treasClass;
  const p = old.itemProperties;
  item.ident = (p & 1) !== 0;
  item.property = (p & 2) !== 0;
  item.magic = (p & 4) !== 0;
  item.contained = (p & 8) !== 0;
  item.cursed = (p & 16) !== 0;
  item.concealed = (p & 32) !== 0;
  item.enchanted = item.rechargeable = item.held = false;
  item.unsellable = (p & 16) !== 0;
  if (item.variety === ItemType.ARROW || item.variety === ItemType.BOLTS) {
    item.missile = item.magic ? 4 : 3;
  } else if (item.variety === ItemType.MISSILE_NO_AMMO) {
    item.missile = 12; // assume a sling
  } else if (item.variety === ItemType.THROWN_MISSILE) {
    // A guess from the unidentified name, which is the more generic one.
    const n = item.name;
    if (n.includes('Knife') || n.includes('Knive')) item.missile = 10;
    else if (n.includes('Spear') || n.includes('Javelin')) item.missile = 5;
    else if (n.includes('Razordisk') || n.includes('Star')) item.missile = 7;
    else if (n.includes('Dart')) item.missile = 1;
    else if (n.includes('Rock')) item.missile = 12;
    else item.missile = 1;
  }
  return item;
}

// ---------------------------------------------------------------- towns

/**
 * Legacy `time_flag` → eMonstTime's *number*. Legacy 6 lands on 3 because the
 * C++ enum lists its three "sometimes" values C, A, B (see `MonstTime`); an
 * unknown value leaves the default, ALWAYS.
 */
const MONST_TIME: Record<number, MonstTime> = {
  0: 0, 1: 1, 2: 2, 4: 4, 5: 5, 6: 3, 7: 6, 8: 7,
};

/** `cTownperson::import_legacy`. */
export function convertTownperson(old: LegacyCreatureStart): Townperson {
  const p = defaultTownperson();
  p.number = old.number;
  p.startAttitude = old.startAttitude as Attitude;
  p.startLoc = { x: old.startLoc.x, y: old.startLoc.y };
  p.mobility = old.mobile;
  p.timeFlag = MONST_TIME[old.timeFlag] ?? MonstTime.ALWAYS;
  p.spec1 = old.spec1;
  p.spec2 = old.spec2;
  p.specEncCode = old.specEncCode;
  p.timeCode = old.timeCode;
  p.monsterTime = old.monsterTime;
  p.personality = old.personality;
  p.specialOnKill = old.specialOnKill;
  p.facialPic = old.facialPic === 0 ? NO_PIC : old.facialPic - 1;
  return p;
}

const PRESET_FIELDS: Record<number, FieldType> = {
  3: FieldType.FIELD_WEB, 4: FieldType.OBJECT_CRATE, 5: FieldType.OBJECT_BARREL,
  6: FieldType.BARRIER_FIRE, 7: FieldType.BARRIER_FORCE, 8: FieldType.FIELD_QUICKFIRE,
  14: FieldType.SFX_SMALL_BLOOD, 15: FieldType.SFX_MEDIUM_BLOOD, 16: FieldType.SFX_LARGE_BLOOD,
  17: FieldType.SFX_SMALL_SLIME, 18: FieldType.SFX_LARGE_SLIME, 19: FieldType.SFX_ASH,
  20: FieldType.SFX_BONES, 21: FieldType.SFX_RUBBLE,
};

/**
 * `cTown::cField::import_legacy`. The C++ leaves an unknown type at the
 * default-constructed field's type; null here, so the caller can drop it the
 * way the XML writer drops an empty slot.
 */
export function convertPresetField(old: { fieldLoc: { x: number; y: number }; fieldType: number }): PresetField | null {
  const type = PRESET_FIELDS[old.fieldType];
  if (type === undefined) return null;
  return { loc: { x: old.fieldLoc.x, y: old.fieldLoc.y }, type };
}

/** `cOutdoors::cWandering::import_legacy`. */
export function convertOutWandering(old: LegacyOutWandering): OutWandering {
  return {
    monst: [...old.monst],
    friendly: [...old.friendly],
    specOnMeet: old.specOnMeet,
    specOnWin: old.specOnWin,
    specOnFlee: old.specOnFlee,
    cantFlee: old.cantFlee % 10 === 1,
    forced: old.cantFlee >= 10,
    endSpec1: old.endSpec1,
    endSpec2: old.endSpec2,
  };
}

// ---------------------------------------------------------------- dialogue

/** `shop_info_t` — a shop a legacy talk or special node described inline. */
export interface ShopInfo {
  type: ShopItemType;
  first: number;
  count: number;
  name: string;
}

const TALK_TYPES: Record<number, TalkNodeType> = {
  0: TalkNodeType.REGULAR, 1: TalkNodeType.DEP_ON_SDF, 2: TalkNodeType.SET_SDF,
  3: TalkNodeType.INN, 4: TalkNodeType.DEP_ON_TIME, 5: TalkNodeType.DEP_ON_TIME_AND_EVENT,
  6: TalkNodeType.DEP_ON_TOWN, 7: TalkNodeType.SHOP, 8: TalkNodeType.TRAINING,
  9: TalkNodeType.SHOP, 10: TalkNodeType.SHOP, 11: TalkNodeType.SHOP, 12: TalkNodeType.SHOP,
  13: TalkNodeType.SELL_WEAPONS, 14: TalkNodeType.SELL_ARMOR, 15: TalkNodeType.SELL_ITEMS,
  16: TalkNodeType.IDENTIFY, 17: TalkNodeType.ENCHANT, 18: TalkNodeType.BUY_INFO,
  19: TalkNodeType.BUY_SDF, 20: TalkNodeType.BUY_SHIP, 21: TalkNodeType.BUY_HORSE,
  22: TalkNodeType.BUY_SPEC_ITEM, 23: TalkNodeType.SHOP, 24: TalkNodeType.BUY_TOWN_LOC,
  25: TalkNodeType.END_FORCE, 26: TalkNodeType.END_FIGHT, 27: TalkNodeType.END_ALARM,
  28: TalkNodeType.END_DIE, 29: TalkNodeType.CALL_TOWN_SPEC, 30: TalkNodeType.CALL_SCEN_SPEC,
};

/**
 * `cSpeech::import_legacy`. `str1`/`str2` must already be filled in — a shop
 * is named after its node's first string — and each inline shop is appended
 * to `shops`, its node then pointing at scenario shop `shops.length + 5`
 * (the five junk shops and the healer come first).
 */
export function convertTalkNodes(
  old: LegacyTalkNode[], strs: { str1: string; str2: string }[], shops: ShopInfo[],
  decode: (bytes: number[]) => string,
): TalkNode[] {
  // `char link1[4]` — no terminator, so four characters however it's read.
  const link = (bytes: number[]): string => bytes.map((b) => decode([b]) || '\0').join('');
  return old.map((o, i) => {
    const node = emptyTalkNode();
    node.personality = o.personality;
    node.link1 = link(o.link1);
    node.link2 = link(o.link2);
    node.extras = [...o.extras];
    node.str1 = strs[i]!.str1;
    node.str2 = strs[i]!.str2;
    // An unknown type leaves the default-constructed REGULAR.
    node.type = TALK_TYPES[o.type] ?? TalkNodeType.REGULAR;
    const addShop = (type: ShopItemType, first: number): void => {
      shops.push({ type, first, count: node.extras[2]!, name: node.str1 });
      node.extras[1] = shops.length + 5;
      node.extras[2] = 0;
    };
    switch (o.type) {
      case 2: node.extras[2] = 1; break;
      case 7: addShop(ShopItemType.ITEM, node.extras[1]!); break;
      case 9: addShop(ShopItemType.MAGE_SPELL, node.extras[1]! + 30); break;
      case 10: addShop(ShopItemType.PRIEST_SPELL, node.extras[1]! + 30); break;
      case 11: addShop(ShopItemType.ALCHEMY, node.extras[1]!); break;
      case 12: node.extras[1] = 5; node.extras[2] = 0; break; // healer
      case 23: node.extras[2] = 0; break; // junk shop
      default: break;
    }
    return node;
  });
}
