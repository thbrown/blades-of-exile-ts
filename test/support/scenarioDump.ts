/**
 * This port's `Scenario`, reshaped to what `tools/cppharness/scendump.cpp`
 * prints for the C++ one — the same keys, and the few places the two models
 * are built differently brought together:
 *
 * - a monster's abilities are 24 slots here and a map of the active ones there,
 *   and each is a union there, so only the active ones and only the arm their
 *   category uses are compared;
 * - a town's dialogue is its own list here (`townTalk`) and inside the town there;
 * - a terrain's shortcut is a one-character string here and a `char` there.
 */

import { Monster } from '../../src/data/monster';
import { MonstAbilCat, abilityCategory } from '../../src/data/monsterAbility';
import { Scenario } from '../../src/data/scenario';
import { Shop } from '../../src/data/shop';
import { SpecialNode } from '../../src/data/special';
import { Terrain } from '../../src/data/terrain';

type Json = unknown;

function specials(map: Map<number, SpecialNode>): SpecialNode[] {
  return Array.from({ length: map.size }, (_, i) => map.get(i)!);
}

function monster(m: Monster): Json {
  const abil: Record<string, Json> = {};
  m.abil.forEach((a, key) => {
    if (!a.active) return;
    switch (abilityCategory(key)) {
      case MonstAbilCat.MISSILE: abil[key] = { ...a.missile }; break;
      case MonstAbilCat.GENERAL: abil[key] = { ...a.gen }; break;
      case MonstAbilCat.SUMMON: abil[key] = { ...a.summon }; break;
      case MonstAbilCat.RADIATE: abil[key] = { ...a.radiate }; break;
      case MonstAbilCat.SPECIAL: abil[key] = { ...a.special }; break;
      default: break;
    }
  });
  return {
    name: m.name, level: m.level, health: m.health, armor: m.armor, skill: m.skill,
    attacks: m.attacks, race: m.race, speed: m.speed, mu: m.mu, cl: m.cl, treasure: m.treasure,
    abil, corpseItem: m.corpseItem, corpseItemChance: m.corpseItemChance, resist: m.resist,
    mindless: m.mindless, invuln: m.invuln, invisible: m.invisible, guard: m.guard,
    amorphous: m.amorphous, xWidth: m.xWidth, yWidth: m.yWidth, defaultAttitude: m.defaultAttitude,
    summonType: m.summonType, defaultFacialPic: m.defaultFacialPic, pictureNum: m.pictureNum,
    ambientSound: m.ambientSound, seeSpec: m.seeSpec,
  };
}

function terrain(t: Terrain): Json {
  const { shortcutKey, ...rest } = t;
  return { ...rest, shortcutKey: shortcutKey === '' ? 0 : shortcutKey.charCodeAt(0) };
}

function shop(s: Shop): Json {
  return {
    name: s.name, type: s.type, prompt: s.prompt, face: s.face, costAdj: s.costAdj,
    items: s.items.map((e) => ({ type: e.type, quantity: e.quantity, index: e.index, item: e.item })),
  };
}

/**
 * `Item.ineptOk` is this port's own, for E3's notes; OBoE's cItem has no such
 * field, so it leaves the dump wherever an item appears (the item table, and
 * each shop's stock).
 */
function dropPortOnly(j: Json): Json {
  if (Array.isArray(j)) return j.map(dropPortOnly);
  if (j === null || typeof j !== 'object' || j instanceof Map) return j;
  const out: Record<string, Json> = {};
  for (const [k, v] of Object.entries(j)) if (k !== 'ineptOk') out[k] = dropPortOnly(v);
  return out;
}

export function scenarioDump(s: Scenario): Json {
  return dropPortOnly(scenarioDumpRaw(s));
}

function scenarioDumpRaw(s: Scenario): Json {
  return {
    title: s.title,
    teasers: s.teasers,
    introMsgs: s.introMsgs,
    introPic: s.introPic,
    numTowns: s.towns.length,
    outWidth: s.outWidth,
    outHeight: s.outHeight,
    startTown: s.startTown,
    difficulty: s.difficulty,
    adjustDiff: s.adjustDiff,
    isLegacy: s.isLegacy,
    townStart: s.townStart,
    outdoorStart: s.outdoorStart,
    sectorStart: s.sectorStart,
    terTypes: s.terTypes.map(terrain),
    scenItems: s.scenItems,
    scenMonsters: s.scenMonsters.map(monster),
    towns: s.towns.map((t, i) => ({
      name: t.name,
      terrain: t.terrain,
      specialLocs: t.specialLocs,
      signLocs: t.signLocs,
      areaDesc: t.areaDesc,
      specials: specials(t.specials),
      maxDim: t.maxDim,
      lighting: t.lighting.map((row) => Array.from(row)),
      comment: t.comment,
      townChopTime: t.townChopTime,
      townChopKey: t.townChopKey,
      maxNumMonst: t.maxNumMonst,
      wandering: t.wandering,
      wanderingLocs: t.wanderingLocs,
      lightingType: t.lightingType,
      startLocs: t.startLocs,
      exits: t.exits,
      inTownRect: t.inTownRect,
      presetItems: t.presetItems,
      presetFields: t.presetFields,
      creatures: t.creatures,
      specOnEntry: t.specOnEntry,
      specOnEntryIfDead: t.specOnEntryIfDead,
      specOnHostile: t.specOnHostile,
      timers: t.timers,
      strongBarriers: t.strongBarriers,
      defyMapping: t.defyMapping,
      defyScrying: t.defyScrying,
      isHidden: t.isHidden,
      hasTavern: t.hasTavern,
      difficulty: t.difficulty,
      specStrs: t.specStrs,
      talk: s.townTalk[i],
    })),
    outdoors: s.outdoors.map((col) => col.map((o) => ({
      name: o.name,
      terrain: o.terrain,
      specialLocs: o.specialLocs,
      signLocs: o.signLocs,
      areaDesc: o.areaDesc,
      specials: specials(o.specials),
      comment: o.comment,
      ambientSound: o.ambientSound,
      specialSpot: o.specialSpot,
      roads: o.roads,
      cityLocs: o.cityLocs,
      specStrs: o.specStrs,
      wandering: o.wandering,
      specialEnc: o.specialEnc,
      wanderingLocs: o.wanderingLocs,
    }))),
    scenSpecials: specials(s.scenSpecials),
    shops: s.shops.map(shop),
    specialItems: s.specialItems,
    scenarioTimers: s.scenarioTimers,
    initSpec: s.initSpec,
    specStrs: s.specStrs,
    townMods: s.townMods,
    storeItemRects: Object.fromEntries(s.storeItemRects),
    boats: s.boats.map(({ loc, sector, whichTown, exists, property }) => ({ loc, sector, whichTown, exists, property })),
    horses: s.horses.map(({ loc, sector, whichTown, exists, property }) => ({ loc, sector, whichTown, exists, property })),
  };
}
