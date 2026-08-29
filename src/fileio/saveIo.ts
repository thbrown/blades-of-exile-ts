/**
 * The `.exg` save format — a port of `save_party` / `load_party_v2`
 * (fileio_party.cpp:351/536) and the `writeTo`/`readFrom` pair each state
 * class carries.
 *
 * A save is a gzipped ustar tarball of tag files:
 *
 *   save/party.txt      cParty            save/town.txt      cCurTown
 *   save/pc1..6.txt     cPlayer           save/townmaps.dat  every town's fog
 *   save/scenario.txt   the scenario's mutable bits         save/out.txt   cCurOut
 *   save/setup.dat      cParty::setup     save/outmaps.dat   every sector's fog
 *
 * Two standing divergences, both because this port models less than the C++
 * does rather than because the format was changed:
 *
 *   - Fields cParty has and this port doesn't are simply absent from the file:
 *     the journal, conversation notes, stored PCs and their items, campaign
 *     flags, the split party, `hostiles_present`, `less_wm`, the save-slot
 *     number and the per-town creature save slots. A save written here loads in
 *     the C++ build with those at their defaults, and one written there loses
 *     them coming here. Each is marked TODO where it would go.
 *   - `cParty::setup` is not modelled at all, so `save/setup.dat` is written as
 *     the empty page the C++ writes when the array is empty, and ignored on
 *     read.
 */

import { gunzipSync, gzipSync } from 'fflate';
import { Location } from '../core/location';
import { GameRng } from '../core/rng';
import {
  attitudeStrs, creatureStatusNames, dirTags, dmgNames, encNoteTypes, itemAbils, itemTypes,
  itemUses, mainStatusNames, monstAbilTypes, monstAbils, monstMelee, monstMissiles, monstSummons,
  monstTimes, pcStatus, questStatusNames, raceNames, readEnumTagOrNumber, skillNames, spellPats,
  traitNames, writeEnumTag,
} from '../data/enumTags';
import { FieldType } from '../data/fields';
import { Item, ItemType, ItemUse, defaultItem } from '../data/item';
import { Monster, defaultMonster } from '../data/monster';
import {
  Ability, MonstAbil, MonstAbilCat, NUM_MONST_ABIL, abilityCategory, defaultAbilities,
} from '../data/monsterAbility';
import { OutWandering } from '../data/outdoors';
import { QuestStatus, makeJobBank } from '../data/quest';
import { Scenario } from '../data/scenario';
import { Vehicle } from '../data/vehicle';
import { CurOut, OUT_MAX_DIM } from '../universe/curOut';
import { CurTown } from '../universe/curTown';
import { Creature, CreatureStatus } from '../universe/creature';
import { Party, TOWN_NUM_OUTDOORS, timerIsValid } from '../universe/party';
import { NUM_INVEN_SLOTS, Player } from '../universe/player';
import { MainStatus, PartyStatus, Status } from '../universe/skills';
import { Universe } from '../universe/universe';
import { TagFile, TagPage, asHex } from './tagfile';
import { Tarball } from './tarball';

/**
 * `OBOE_CURRENT_VERSION` as this port writes it. The loader only warns when a
 * file claims something newer, so the exact number matters little; it is the
 * 2.0.0 stamp the current CBoE writes.
 */
export const SAVE_VERSION = 0x02000000;

// eStatus::MAIN is -1, so its table needs an offset of one. `pc_status` gets
// "main" inserted at -1 by a static initialiser (estreams.cpp:370).
const statusNames = ['main', ...pcStatus];
const STATUS_OFFSET = 1;

// --- little helpers ---------------------------------------------------------

function putLoc(page: TagPage, key: string, where: { x: number; y: number }): void {
  page.add(key, where.x, where.y);
}

function takeLoc(page: TagPage, key: string, into: Location): void {
  const tag = page.first(key);
  if (tag === undefined) return;
  into.x = tag.int(0, into.x);
  into.y = tag.int(1, into.y);
}

/** Every index carried by a repeated single-value key, e.g. `EQUIP 3`. */
function flagsFrom(page: TagPage, key: string, into: boolean[]): void {
  into.fill(false);
  for (const tag of page.list(key)) {
    const i = tag.int(0, -1);
    if (i >= 0 && i < into.length) into[i] = true;
  }
}

function flagsTo(page: TagPage, key: string, from: readonly boolean[]): void {
  for (let i = 0; i < from.length; i++) if (from[i]) page.add(key, i);
}

// --- cItem (item.cpp:1284) --------------------------------------------------

export function writeItem(page: TagPage, item: Item): void {
  page.add('VARIETY', writeEnumTag(itemTypes, item.variety, 'none'));
  page.add('LEVEL', item.itemLevel);
  page.add('AWKWARD', item.awkward);
  page.add('BONUS', item.bonus);
  page.add('PROT', item.protection);
  page.add('CHARGES', item.charges, item.maxCharges);
  page.add('WEAPON', writeEnumTag(skillNames, item.weapType, 'edged'));
  page.add('USE', writeEnumTag(itemUses, item.magicUseType, 'help-one'));
  page.add('ICON', item.graphicNum);
  page.add('ABILITY', writeEnumTag(itemAbils, item.ability, 'none'));
  page.add('ABILSTR', item.abilStrength, item.abilData);
  page.add('TYPE', item.typeFlag);
  page.add('ISSPEC', item.isSpecial);
  page.add('VALUE', item.value);
  page.add('WEIGHT', item.weight);
  page.add('SPEC', item.specialClass);
  page.add('MISSILE', item.missile);
  putLoc(page, 'AT', item.itemLoc);
  page.add('FULLNAME', item.fullName);
  page.add('NAME', item.name);
  page.add('DESCR', item.desc);
  page.add('TREASURE', item.treasClass);
  if (item.ident) page.add('IDENTIFIED');
  if (item.property) page.add('PROPERTY');
  if (item.magic) page.add('MAGIC');
  if (item.contained) page.add('CONTAINED');
  if (item.held) page.add('HELD');
  if (item.cursed) page.add('CURSED');
  if (item.concealed) page.add('CONCEALED');
  if (item.enchanted) page.add('ENCHANTED');
  if (item.rechargeable) page.add('RECHARGEABLE');
  if (item.unsellable) page.add('UNSELLABLE');
}

export function readItem(page: TagPage): Item {
  const item = defaultItem();
  const enumOf = (key: string, tags: readonly string[], def: number): number => {
    const tag = page.first(key);
    return tag === undefined ? def : readEnumTagOrNumber(tags, tag.str(0), def);
  };
  item.variety = enumOf('VARIETY', itemTypes, ItemType.NO_ITEM);
  item.itemLevel = page.first('LEVEL')?.int(0) ?? 0;
  item.awkward = page.first('AWKWARD')?.int(0) ?? 0;
  item.bonus = page.first('BONUS')?.int(0) ?? 0;
  item.protection = page.first('PROT')?.int(0) ?? 0;
  const charges = page.first('CHARGES');
  item.charges = charges?.int(0) ?? 0;
  item.maxCharges = charges?.int(1) ?? 0;
  item.weapType = enumOf('WEAPON', skillNames, item.weapType);
  item.magicUseType = enumOf('USE', itemUses, ItemUse.HELP_ONE);
  item.graphicNum = page.first('ICON')?.int(0) ?? 0;
  item.ability = enumOf('ABILITY', itemAbils, 0);
  const abil = page.first('ABILSTR');
  item.abilStrength = abil?.int(0) ?? 0;
  item.abilData = abil?.int(1) ?? 0;
  item.typeFlag = page.first('TYPE')?.int(0) ?? 0;
  item.isSpecial = page.first('ISSPEC')?.int(0) ?? 0;
  item.value = page.first('VALUE')?.int(0) ?? 0;
  item.weight = page.first('WEIGHT')?.int(0) ?? 0;
  item.specialClass = page.first('SPEC')?.int(0) ?? 0;
  item.missile = page.first('MISSILE')?.int(0) ?? -1;
  takeLoc(page, 'AT', item.itemLoc);
  item.fullName = page.first('FULLNAME')?.str(0) ?? '';
  item.name = page.first('NAME')?.str(0) ?? '';
  item.desc = page.first('DESCR')?.str(0) ?? '';
  item.treasClass = page.first('TREASURE')?.int(0) ?? 0;
  item.ident = page.has('IDENTIFIED');
  item.property = page.has('PROPERTY');
  item.magic = page.has('MAGIC');
  item.contained = page.has('CONTAINED');
  item.held = page.has('HELD');
  item.cursed = page.has('CURSED');
  item.concealed = page.has('CONCEALED');
  item.enchanted = page.has('ENCHANTED');
  item.rechargeable = page.has('RECHARGEABLE');
  item.unsellable = page.has('UNSELLABLE');
  return item;
}

// --- uAbility (monster.cpp:818) ---------------------------------------------

/** Returns false when there was nothing to write, as the C++ overload does. */
export function writeAbility(page: TagPage, key: MonstAbil, abil: Ability): boolean {
  if (key === MonstAbil.NO_ABIL || !abil.active) return false;
  page.add('ABIL', writeEnumTag(monstAbils, key, 'none'));
  switch (abilityCategory(key)) {
    case MonstAbilCat.INVALID:
      return false;
    case MonstAbilCat.MISSILE:
      page.add('TYPE', writeEnumTag(monstMissiles, abil.missile.type, 'dart'), abil.missile.pic);
      page.add('DAMAGE', abil.missile.dice, abil.missile.sides);
      page.add('SKILL', abil.missile.skill);
      page.add('RANGE', abil.missile.range);
      page.add('CHANCE', abil.missile.odds);
      break;
    case MonstAbilCat.GENERAL:
      page.add('TYPE', writeEnumTag(monstAbilTypes, abil.gen.type, 'ray'), abil.gen.pic);
      page.add('DAMAGE', abil.gen.strength);
      page.add('RANGE', abil.gen.range);
      page.add('CHANCE', abil.gen.odds);
      // The union's third arm is read as whichever type the key implies.
      if (key === MonstAbil.DAMAGE || key === MonstAbil.DAMAGE2) {
        page.add('EXTRA', writeEnumTag(dmgNames, abil.gen.extra, 'weap'));
      } else if (key === MonstAbil.FIELD) {
        page.add('EXTRA', abil.gen.extra);
      } else if (
        key === MonstAbil.STATUS || key === MonstAbil.STATUS2 || key === MonstAbil.STUN
      ) {
        page.add('EXTRA', writeEnumTag(statusNames, abil.gen.extra, 'main', STATUS_OFFSET));
      }
      break;
    case MonstAbilCat.RADIATE:
      page.add('TYPE', abil.radiate.type, writeEnumTag(spellPats, abil.radiate.pat, 'single'));
      page.add('CHANCE', abil.radiate.chance);
      break;
    case MonstAbilCat.SUMMON:
      page.add('TYPE', writeEnumTag(monstSummons, abil.summon.type, 'type'), abil.summon.what);
      page.add('HOWMANY', abil.summon.min, abil.summon.max);
      page.add('DURATION', abil.summon.len);
      page.add('CHANCE', abil.summon.chance);
      break;
    case MonstAbilCat.SPECIAL:
      page.add('EXTRA', abil.special.extra1, abil.special.extra2, abil.special.extra3);
      break;
  }
  return true;
}

/** Reads one ability page onto `into`, returning which slot it belongs in. */
export function readAbility(page: TagPage, into: Ability): MonstAbil {
  const keyTag = page.first('ABIL');
  if (keyTag === undefined) return MonstAbil.NO_ABIL;
  const key = readEnumTagOrNumber(monstAbils, keyTag.str(0), MonstAbil.NO_ABIL);
  if (key === MonstAbil.NO_ABIL || key >= NUM_MONST_ABIL) return MonstAbil.NO_ABIL;
  into.active = true;
  const type = page.first('TYPE');
  const damage = page.first('DAMAGE');
  const chance = page.first('CHANCE')?.int(0) ?? 0;
  const extra = page.first('EXTRA');
  switch (abilityCategory(key)) {
    case MonstAbilCat.MISSILE:
      into.missile.type = readEnumTagOrNumber(monstMissiles, type?.str(0) ?? '', 0);
      into.missile.pic = type?.int(1) ?? 0;
      into.missile.dice = damage?.int(0) ?? 0;
      into.missile.sides = damage?.int(1) ?? 0;
      into.missile.skill = page.first('SKILL')?.int(0) ?? 0;
      into.missile.range = page.first('RANGE')?.int(0) ?? 0;
      into.missile.odds = chance;
      break;
    case MonstAbilCat.GENERAL:
      into.gen.type = readEnumTagOrNumber(monstAbilTypes, type?.str(0) ?? '', 0);
      into.gen.pic = type?.int(1) ?? 0;
      into.gen.strength = damage?.int(0) ?? 0;
      into.gen.range = page.first('RANGE')?.int(0) ?? 0;
      into.gen.odds = chance;
      if (key === MonstAbil.DAMAGE || key === MonstAbil.DAMAGE2) {
        into.gen.extra = readEnumTagOrNumber(dmgNames, extra?.str(0) ?? '', 0);
      } else if (key === MonstAbil.FIELD) {
        into.gen.extra = extra?.int(0) ?? 0;
      } else if (
        key === MonstAbil.STATUS || key === MonstAbil.STATUS2 || key === MonstAbil.STUN
      ) {
        into.gen.extra = readEnumTagOrNumber(statusNames, extra?.str(0) ?? '', 0, STATUS_OFFSET);
      }
      break;
    case MonstAbilCat.RADIATE:
      into.radiate.type = type?.int(0) ?? 0;
      into.radiate.pat = readEnumTagOrNumber(spellPats, type?.str(1) ?? '', into.radiate.pat);
      into.radiate.chance = chance;
      break;
    case MonstAbilCat.SUMMON:
      into.summon.type = readEnumTagOrNumber(monstSummons, type?.str(0) ?? '', 0);
      into.summon.what = type?.int(1) ?? 0;
      into.summon.min = page.first('HOWMANY')?.int(0) ?? 0;
      into.summon.max = page.first('HOWMANY')?.int(1) ?? 0;
      into.summon.len = page.first('DURATION')?.int(0) ?? 0;
      into.summon.chance = chance;
      break;
    default:
      into.special.extra1 = extra?.int(0) ?? 0;
      into.special.extra2 = extra?.int(1) ?? 0;
      into.special.extra3 = extra?.int(2) ?? 0;
      break;
  }
  return key;
}

// --- cMonster (monster.cpp:789) ---------------------------------------------

export function writeMonster(page: TagPage, mon: Monster): void {
  page.add('MONSTER', mon.name);
  page.add('LEVEL', mon.level);
  page.add('ARMOR', mon.armor);
  page.add('SKILL', mon.skill);
  for (let i = 0; i < mon.attacks.length; i++) {
    const a = mon.attacks[i]!;
    page.add('ATTACK', i + 1, a.dice, a.sides, writeEnumTag(monstMelee, a.type, 'swing'));
  }
  page.add('HEALTH', mon.health);
  page.add('SPEED', mon.speed);
  page.add('MAGE', mon.mu);
  page.add('PRIEST', mon.cl);
  page.add('RACE', writeEnumTag(raceNames, mon.race, 'humanoid'));
  page.add('TREASURE', mon.treasure);
  page.add('CORPSEITEM', mon.corpseItem, mon.corpseItemChance);
  page.encodeSparse('IMMUNE', mon.resist, 0);
  page.add('SIZE', mon.xWidth, mon.yWidth);
  page.add('ATTITUDE', writeEnumTag(attitudeStrs, mon.defaultAttitude, 'docile'));
  page.add('SUMMON', mon.summonType);
  page.add('PORTRAIT', mon.defaultFacialPic);
  page.add('PICTURE', mon.pictureNum);
  page.add('SOUND', mon.ambientSound);
  if (mon.mindless) page.add('MINDLESS');
  if (mon.invuln) page.add('INVULNERABLE');
  if (mon.invisible) page.add('INVISIBLE');
  if (mon.guard) page.add('GUARD');
  if (mon.amorphous) page.add('AMORPHOUS');
}

export function readMonster(page: TagPage): Monster {
  const mon = defaultMonster();
  // The on-see event isn't exported, so it must not be left as garbage.
  mon.seeSpec = -1;
  mon.name = page.first('MONSTER')?.str(0) ?? '';
  mon.level = page.first('LEVEL')?.int(0) ?? 0;
  mon.armor = page.first('ARMOR')?.int(0) ?? 0;
  mon.skill = page.first('SKILL')?.int(0) ?? 0;
  mon.attacks = [];
  for (const tag of page.list('ATTACK')) {
    const which = tag.int(0, 1) - 1;
    while (mon.attacks.length <= which) mon.attacks.push({ dice: 0, sides: 0, type: 0 });
    mon.attacks[which] = {
      dice: tag.int(1),
      sides: tag.int(2),
      type: readEnumTagOrNumber(monstMelee, tag.str(3), 0),
    };
  }
  mon.health = page.first('HEALTH')?.int(0) ?? 0;
  mon.speed = page.first('SPEED')?.int(0) ?? 4;
  mon.mu = page.first('MAGE')?.int(0) ?? 0;
  mon.cl = page.first('PRIEST')?.int(0) ?? 0;
  mon.race = readEnumTagOrNumber(raceNames, page.first('RACE')?.str(0) ?? '', 0);
  mon.treasure = page.first('TREASURE')?.int(0) ?? 0;
  mon.corpseItem = page.first('CORPSEITEM')?.int(0) ?? 0;
  mon.corpseItemChance = page.first('CORPSEITEM')?.int(1) ?? 0;
  // `resist` defaults to 100 per type, but the sparse form only names the
  // non-zero ones, so the array is cleared first exactly as extractSparse does.
  mon.resist.fill(0);
  page.extractSparse('IMMUNE', mon.resist, 0);
  mon.xWidth = page.first('SIZE')?.int(0) ?? 1;
  mon.yWidth = page.first('SIZE')?.int(1) ?? 1;
  mon.defaultAttitude = readEnumTagOrNumber(attitudeStrs, page.first('ATTITUDE')?.str(0) ?? '', 0);
  mon.summonType = page.first('SUMMON')?.int(0) ?? 0;
  mon.defaultFacialPic = page.first('PORTRAIT')?.int(0) ?? 0;
  mon.pictureNum = page.first('PICTURE')?.int(0) ?? 0;
  mon.ambientSound = page.first('SOUND')?.int(0) ?? 0;
  mon.mindless = page.has('MINDLESS');
  mon.invuln = page.has('INVULNERABLE');
  mon.invisible = page.has('INVISIBLE');
  mon.guard = page.has('GUARD');
  mon.amorphous = page.has('AMORPHOUS');
  mon.abil = defaultAbilities();
  return mon;
}

// --- cCreature (creature.cpp:338) -------------------------------------------

export function writeCreature(page: TagPage, c: Creature): void {
  page.add('MONSTER', c.number);
  page.add('ALERT', c.active === CreatureStatus.ALERTED);
  page.add('ATTITUDE', writeEnumTag(attitudeStrs, c.attitude, 'docile'));
  // TODO(M7): cCreature::start_attitude isn't modelled here, so the creature's
  // current attitude stands in for it; nothing reads it back.
  page.add('STARTATT', writeEnumTag(attitudeStrs, c.attitude, 'docile'));
  putLoc(page, 'STARTLOC', c.startLoc);
  putLoc(page, 'LOCATION', c.curLoc);
  page.add('MOBILITY', c.mobile ? 1 : 0);
  page.add('TIMEFLAG', writeEnumTag(monstTimes, c.timeFlag, 'always'));
  page.add('SUMMONED', c.summonTime, c.partySummoned);
  page.add('SPEC', c.spec1, c.spec2);
  page.add('SPECCODE', c.specEncCode);
  page.add('TIMECODE', c.timeCode);
  page.add('TIME', c.monsterTime);
  // Two TALK tags, read back in this order — the C++ writes them the same way.
  page.add('TALK', c.personality);
  page.add('DEATH', c.specialOnKill);
  page.add('TALK', c.specialOnTalk);
  page.add('FACE', c.facialPic);
  page.add('TARGET', c.target);
  page.encodeSparse('STATUS', c.status, 0);
  page.add('HEALTH', c.health, c.maxHealth);
  page.add('MANA', c.mp, c.maxMp);
  page.add('MORALE', c.morale, c.mMorale);
  page.add('DIRECTION', writeEnumTag(dirTags, c.direction, '?'));
}

export function readCreature(page: TagPage, c: Creature): void {
  c.targLoc = { x: 0, y: 0 };
  c.number = page.first('MONSTER')?.int(0) ?? 0;
  const alert = page.first('ALERT')?.bool(0) ?? false;
  c.attitude = readEnumTagOrNumber(attitudeStrs, page.first('ATTITUDE')?.str(0) ?? '', 0);
  takeLoc(page, 'STARTLOC', c.startLoc);
  takeLoc(page, 'LOCATION', c.curLoc);
  c.mobile = (page.first('MOBILITY')?.int(0) ?? 1) !== 0;
  c.timeFlag = readEnumTagOrNumber(monstTimes, page.first('TIMEFLAG')?.str(0) ?? '', 0);
  c.summonTime = page.first('SUMMONED')?.int(0) ?? 0;
  c.partySummoned = page.first('SUMMONED')?.bool(1) ?? false;
  c.spec1 = page.first('SPEC')?.int(0) ?? -1;
  c.spec2 = page.first('SPEC')?.int(1) ?? -1;
  c.specEncCode = page.first('SPECCODE')?.int(0) ?? 0;
  c.timeCode = page.first('TIMECODE')?.int(0) ?? 0;
  c.monsterTime = page.first('TIME')?.int(0) ?? 0;
  c.personality = page.next('TALK')?.int(0) ?? -1;
  c.specialOnKill = page.first('DEATH')?.int(0) ?? -1;
  c.specialOnTalk = page.next('TALK')?.int(0) ?? -1;
  c.facialPic = page.first('FACE')?.int(0) ?? -1;
  c.target = page.first('TARGET')?.int(0) ?? 6;
  c.status.fill(0);
  page.extractSparse('STATUS', c.status, 0);
  c.health = page.first('HEALTH')?.int(0) ?? 0;
  c.maxHealth = page.first('HEALTH')?.int(1) ?? 0;
  c.mp = page.first('MANA')?.int(0) ?? 0;
  c.maxMp = page.first('MANA')?.int(1) ?? 0;
  // The C++ reads only the first of MORALE's two values; m_morale is left as
  // the monster template set it. Kept.
  c.morale = page.first('MORALE')?.int(0) ?? 0;
  c.direction = readEnumTagOrNumber(dirTags, page.first('DIRECTION')?.str(0) ?? '', 0);
  c.active = alert ? CreatureStatus.ALERTED : CreatureStatus.IDLE;
}

// --- cVehicle (vehicle.cpp:56) ----------------------------------------------

function writeVehicle(page: TagPage, v: Vehicle): void {
  putLoc(page, 'LOCATION', v.loc);
  putLoc(page, 'SECTOR', v.sector);
  page.add('IN', v.whichTown);
  if (v.property) page.add('OWNED');
}

function readVehicle(page: TagPage, v: Vehicle): void {
  takeLoc(page, 'LOCATION', v.loc);
  takeLoc(page, 'SECTOR', v.sector);
  v.whichTown = page.first('IN')?.int(0) ?? v.whichTown;
  v.property = page.has('OWNED');
}

// --- cOutdoors::cCreature / cWandering (outdoors.cpp:171/188) ---------------

function writeWandering(page: TagPage, w: OutWandering): void {
  page.add('MEET', w.specOnMeet);
  page.add('WIN', w.specOnWin);
  page.add('FLEE', w.specOnFlee);
  page.add('FLAGS', w.cantFlee, w.forced);
  page.add('SDF', w.endSpec1, w.endSpec2);
  for (let i = 0; i < 7; i++) page.add('HOSTILE', i, w.monst[i] ?? 0);
  for (let i = 0; i < 3; i++) page.add('FRIEND', i, w.friendly[i] ?? 0);
}

function readWandering(page: TagPage, w: OutWandering): void {
  w.specOnMeet = page.first('MEET')?.int(0) ?? -1;
  w.specOnWin = page.first('WIN')?.int(0) ?? -1;
  w.specOnFlee = page.first('FLEE')?.int(0) ?? -1;
  w.cantFlee = page.first('FLAGS')?.bool(0) ?? false;
  w.forced = page.first('FLAGS')?.bool(1) ?? false;
  w.endSpec1 = page.first('SDF')?.int(0) ?? -1;
  w.endSpec2 = page.first('SDF')?.int(1) ?? -1;
  w.monst.fill(0);
  page.extractSparse('HOSTILE', w.monst, 0);
  w.monst.length = 7;
  w.friendly.fill(0);
  page.extractSparse('FRIEND', w.friendly, 0);
  w.friendly.length = 3;
}

// --- cPlayer (pc.cpp:1255) --------------------------------------------------

export function writePlayer(file: TagFile, pc: Player): void {
  const page = file.add();
  page.add('UID', pc.uniqueId);
  page.add('STATUS', 'main', writeEnumTag(mainStatusNames, pc.mainStatus, 'empty'));
  page.add('NAME', pc.name);
  page.add('SKILL', 'hp', pc.maxHealth);
  if (pc.maxSp > 0) page.add('SKILL', 'sp', pc.maxSp);
  page.encodeSparse('SKILL', pc.skills, 0);
  page.add('HEALTH', pc.curHealth);
  page.add('MANA', pc.curSp);
  page.add('EXPERIENCE', pc.experience);
  page.add('SKILLPTS', pc.skillPts);
  page.add('LEVEL', pc.level);
  for (let i = 0; i < pc.status.length; i++) {
    if (pc.status[i] !== 0) {
      page.add('STATUS', writeEnumTag(statusNames, i, 'main', STATUS_OFFSET), pc.status[i]!);
    }
  }
  if (pc.expAdj !== 100) page.add('EXPADJ', pc.expAdj);
  flagsTo(page, 'EQUIP', pc.equip);
  flagsTo(page, 'MAGE', pc.mageSpells);
  flagsTo(page, 'PRIEST', pc.priestSpells);
  for (let i = 0; i < pc.traits.length; i++) {
    if (pc.traits[i]) page.add('TRAIT', writeEnumTag(traitNames, i, 'tough'));
  }
  page.add('ICON', pc.whichGraphic);
  page.add('RACE', writeEnumTag(raceNames, pc.race, 'humanoid'));
  page.add('DIRECTION', writeEnumTag(dirTags, pc.direction, '?'));
  if (pc.weapPoisoned !== null) {
    const slot = pc.items.indexOf(pc.weapPoisoned);
    if (slot >= 0) page.add('POISON', slot);
  }
  for (let i = 0; i < NUM_INVEN_SLOTS; i++) {
    const item = pc.items[i]!;
    if (item.variety === ItemType.NO_ITEM) continue;
    const itemPage = file.add();
    itemPage.add('ITEM', i);
    writeItem(itemPage, item);
  }
}

export function readPlayer(file: TagFile, pc: Player): void {
  for (let p = 0; p < file.pages.length; p++) {
    const page = file.pages[p]!;
    if (p === 0) {
      // The first STATUS tag is `main`; the rest are the timed effects.
      pc.mainStatus = readEnumTagOrNumber(
        mainStatusNames, page.next('STATUS')?.str(1) ?? '', MainStatus.ABSENT);
      pc.level = page.first('LEVEL')?.int(0) ?? 1;
      pc.whichGraphic = page.first('ICON')?.int(0) ?? 0;
      pc.status.fill(0);
      for (const tag of page.list('STATUS')) {
        const which = readEnumTagOrNumber(statusNames, tag.str(0), Status.MAIN, STATUS_OFFSET);
        if (which >= 0 && which < pc.status.length) pc.status[which] = tag.int(1);
      }
      pc.name = page.first('NAME')?.str(0) ?? '';
      pc.uniqueId = page.first('UID')?.int(0) ?? 0;
      pc.curHealth = page.first('HEALTH')?.int(0) ?? 0;
      pc.curSp = page.first('MANA')?.int(0) ?? 0;
      pc.experience = page.first('EXPERIENCE')?.int(0) ?? 0;
      pc.skillPts = page.first('SKILLPTS')?.int(0) ?? 0;
      pc.direction = readEnumTagOrNumber(dirTags, page.first('DIRECTION')?.str(0) ?? '', 0);
      pc.race = readEnumTagOrNumber(raceNames, page.first('RACE')?.str(0) ?? '', 0);
      // SKILL is sparse over eSkill, with MAX_HP (19) and MAX_SP (20) riding in
      // the same list and then lifted out of it.
      pc.skills.fill(0);
      pc.maxHealth = 0;
      pc.maxSp = 0;
      for (const tag of page.list('SKILL')) {
        const which = readEnumTagOrNumber(skillNames, tag.str(0), -1);
        if (which === 19) pc.maxHealth = tag.int(1);
        else if (which === 20) pc.maxSp = tag.int(1);
        else if (which >= 0 && which < pc.skills.length) pc.skills[which] = tag.int(1);
      }
      pc.expAdj = page.first('EXPADJ')?.int(0) ?? 100;
      flagsFrom(page, 'EQUIP', pc.equip);
      flagsFrom(page, 'MAGE', pc.mageSpells);
      flagsFrom(page, 'PRIEST', pc.priestSpells);
      pc.traits.fill(false);
      for (const tag of page.list('TRAIT')) {
        const which = readEnumTagOrNumber(traitNames, tag.str(0), -1);
        if (which >= 0 && which < pc.traits.length) pc.traits[which] = true;
      }
      pc.items = Array.from({ length: NUM_INVEN_SLOTS }, () => defaultItem());
      pc.weapPoisoned = null;
    } else if (page.firstKey() === 'ITEM') {
      const slot = page.first('ITEM')!.int(0, -1);
      if (slot >= 0 && slot < NUM_INVEN_SLOTS) pc.items[slot] = readItem(page);
    }
  }
  // The poisoned-weapon slot can only be resolved once the pack is filled in.
  const poisonSlot = file.pages[0]?.first('POISON')?.int(0, -1) ?? -1;
  if (poisonSlot >= 0 && poisonSlot < NUM_INVEN_SLOTS) {
    pc.weapPoisoned = pc.items[poisonSlot] ?? null;
  }
}

// --- cParty (party.cpp:724) -------------------------------------------------

export function writeParty(file: TagFile, party: Party, scenarioId: string): void {
  const page = file.add();
  page.add('CREATEVERSION', asHex(SAVE_VERSION));
  page.add('AGE', party.age);
  page.add('GOLD', party.gold);
  page.add('FOOD', party.food);
  // TODO(M7): next_pc_id, hostiles_present and less_wm aren't modelled here.
  page.add('EASY', party.easyMode);
  for (let i = 0; i < party.stuffDone.length; i++) {
    const row = party.stuffDone[i]!;
    for (let j = 0; j < row.length; j++) {
      if (row[j]! > 0) page.add('SDF', i, j, row[j]!);
    }
  }
  for (const [which, [x, y]] of party.pointers) page.add('POINTER', which, x, y);
  for (let i = 0; i < party.magicPtrs.length; i++) {
    page.add('POINTER', i + 10, party.magicPtrs[i]!);
  }
  page.add('LIGHT', party.lightLevel);
  putLoc(page, 'OUTCORNER', party.outdoorCorner);
  putLoc(page, 'INWHICHCORNER', party.iwc);
  putLoc(page, 'SECTOR', party.outLoc);
  putLoc(page, 'LOCINSECTOR', party.locInSec);
  page.add('IN', party.inBoat, party.inHorse);
  // **Only written while the party is actually split** (party.cpp:754), which
  // is why a save that has never split restores `left_in` as -1.
  if (party.isSplit()) {
    page.add('SPLIT_LEFT_IN', party.leftIn);
    putLoc(page, 'SPLIT_LEFT_AT', party.leftAt);
  }
  for (const which of [
    PartyStatus.STEALTH, PartyStatus.FLIGHT, PartyStatus.DETECT_LIFE, PartyStatus.FIREWALK,
  ]) {
    const value = party.partyStatus[which];
    if (value !== 0) page.add('STATUS', which, value);
  }
  for (const i of party.mNoted) page.add('ROSTER', i);
  for (const i of party.mSeen) page.add('SEEN', i);
  page.add('HOSTILES', party.hostilesPresent);
  for (let i = 0; i < party.imprisonedMonst.length; i++) {
    if (party.imprisonedMonst[i]! > 0) page.add('SOULCRYSTAL', i, party.imprisonedMonst[i]!);
  }
  page.add('DIRECTION', writeEnumTag(dirTags, party.direction, '?'));
  page.add('WHICHSLOT', party.atWhichSaveSlot);
  // One line per remembered town, written for empty slots too — the town
  // number *is* the slot's contents as far as this line goes, and 200 means
  // empty. The creatures themselves go on their own pages further down.
  for (let i = 0; i < party.creatureSave.length; i++) {
    const pop = party.creatureSave[i]!;
    if (pop.hostile) page.add('TOWNSAVE', i, pop.whichTown, 'HOSTILE');
    else page.add('TOWNSAVE', i, pop.whichTown);
  }
  for (let i = 0; i < party.alchemy.length; i++) if (party.alchemy[i]) page.add('ALCHEMY', i);
  for (const [when, what] of party.keyTimes) page.add('EVENT', when, what);
  for (const i of party.specItems) page.add('ITEM', i);
  page.add('KILLS', party.totalMKilled);
  page.add('DAMAGE', party.totalDamDone);
  page.add('WOUNDS', party.totalDamTaken);
  page.add('EXPERIENCE', party.totalXpGained);
  page.add('SCENARIO', scenarioId);
  // TODO(M7): scen_won / scen_played are part of the cross-scenario campaign
  // bookkeeping this port doesn't keep.
  for (const [which, job] of party.activeQuests) {
    page.add(
      'QUEST', which,
      writeEnumTag(questStatusNames, job.status, 'avail'), job.start, job.source,
    );
  }
  for (const [shop, slots] of party.storeLimitedStock) {
    for (const [slot, left] of slots) page.add('SHOPSTOCK', shop, slot, left);
  }

  for (let i = 0; i < party.boats.length; i++) {
    if (!party.boats[i]!.exists) continue;
    const boatPage = file.add();
    boatPage.add('BOAT', i);
    writeVehicle(boatPage, party.boats[i]!);
  }
  for (let i = 0; i < party.horses.length; i++) {
    if (!party.horses[i]!.exists) continue;
    const horsePage = file.add();
    horsePage.add('HORSE', i);
    writeVehicle(horsePage, party.horses[i]!);
  }
  for (const [shop, slots] of party.magicStoreItems) {
    for (const [slot, item] of slots) {
      if (item.variety === ItemType.NO_ITEM) continue;
      const storePage = file.add();
      storePage.add('MAGICSTORE', shop, slot);
      writeItem(storePage, item);
    }
  }
  for (let i = 0; i < party.jobBanks.length; i++) {
    const bank = party.jobBanks[i]!;
    const jobPage = file.add();
    jobPage.add('JOBBANK', i, bank.anger);
    if (!bank.inited) continue;
    for (let j = 0; j < 6; j++) jobPage.add('JOB', j, bank.jobs[j]!);
  }
  for (let i = 0; i < party.outC.length; i++) {
    const group = party.outC[i]!;
    if (!group.exists) continue;
    const encPage = file.add();
    encPage.add('ENCOUNTER', i);
    encPage.add('DIRECTION', writeEnumTag(dirTags, group.direction, '?'));
    putLoc(encPage, 'SECTOR', group.whichSector);
    putLoc(encPage, 'LOCINSECTOR', group.mLoc);
    // `home_sector` isn't modelled; the group's own sector stands in for it.
    putLoc(encPage, 'HOME', group.whichSector);
    encPage.add('-');
    writeWandering(encPage, group.whatMonst);
  }
  // Each timer gets its own page, as the C++ does — its own comment wonders why.
  for (let i = 0; i < party.partyEventTimers.length; i++) {
    const timer = party.partyEventTimers[i]!;
    if (!timerIsValid(timer)) continue;
    const timerPage = file.add();
    timerPage.add('TIMER', i, timer.time, timer.nodeType, timer.node);
  }
  // The four remembered towns' creatures, one page each, and only the living
  // ones — which is the whole point of the mechanism: a slot's gaps are its
  // dead. **`cParty::setup` is deliberately not written**: the C++ saves the
  // creatures of its four remembered towns and not their fields, so a web the
  // party left in a town it isn't standing in does not survive a save.
  for (let i = 0; i < party.creatureSave.length; i++) {
    const pop = party.creatureSave[i]!;
    for (let j = 0; j < pop.monsters.length; j++) {
      if (!pop.monsters[j]!.isAlive) continue;
      const creaturePage = file.add();
      creaturePage.add('CREATURE', i, j);
      writeCreature(creaturePage, pop.monsters[j]!);
    }
  }
  for (let i = 0; i < party.summons.length; i++) {
    const monstPage = file.add();
    monstPage.add('SUMMON', i);
    writeMonster(monstPage, party.summons[i]!);
    // One page per ability, opened lazily: writeAbility returns false when the
    // slot is empty, and only a page it actually wrote to is closed off.
    let abilPage: TagPage | null = null;
    for (let key = 0; key < NUM_MONST_ABIL; key++) {
      if (abilPage === null) abilPage = file.add();
      if (writeAbility(abilPage, key, party.summons[i]!.abil[key]!)) abilPage = null;
    }
  }
  for (const note of party.specialNotes) {
    const notePage = file.add();
    notePage.add('ENCNOTE', writeEnumTag(encNoteTypes, note.type, 'SCEN'), note.where, '');
    notePage.add('STRING', note.theStr);
  }
}

/** The party's scenario name, which the loader needs before anything else. */
export function partyScenarioName(file: TagFile): string {
  return file.at(0)?.first('SCENARIO')?.str(0) ?? '';
}

export function readParty(file: TagFile, party: Party): void {
  let monstI = 0;
  for (let p = 0; p < file.pages.length; p++) {
    const page = file.pages[p]!;
    if (p === 0) {
      takeLoc(page, 'OUTCORNER', party.outdoorCorner);
      takeLoc(page, 'INWHICHCORNER', party.iwc);
      takeLoc(page, 'SECTOR', party.outLoc);
      takeLoc(page, 'LOCINSECTOR', party.locInSec);
      party.age = page.first('AGE')?.int(0) ?? 0;
      party.gold = page.first('GOLD')?.int(0) ?? 0;
      party.food = page.first('FOOD')?.int(0) ?? 0;
      party.easyMode = page.first('EASY')?.bool(0) ?? false;
      party.lightLevel = page.first('LIGHT')?.int(0) ?? 0;
      party.inBoat = page.first('IN')?.int(0) ?? -1;
      party.inHorse = page.first('IN')?.int(1) ?? -1;
      // Absent means "never split", which the C++ restores as -1 — and
      // TOWN_REUNITE_PARTY reads that as "same town", so the party walks back
      // to `left_at` rather than changing level.
      party.leftIn = page.first('SPLIT_LEFT_IN')?.int(0) ?? -1;
      party.leftAt = {
        x: page.first('SPLIT_LEFT_AT')?.int(0) ?? 0,
        y: page.first('SPLIT_LEFT_AT')?.int(1) ?? 0,
      };
      party.direction = readEnumTagOrNumber(dirTags, page.first('DIRECTION')?.str(0) ?? '', 0);
      party.totalMKilled = page.first('KILLS')?.int(0) ?? 0;
      party.totalDamDone = page.first('DAMAGE')?.int(0) ?? 0;
      party.totalDamTaken = page.first('WOUNDS')?.int(0) ?? 0;
      party.totalXpGained = page.first('EXPERIENCE')?.int(0) ?? 0;

      for (const which of [
        PartyStatus.STEALTH, PartyStatus.FLIGHT, PartyStatus.DETECT_LIFE, PartyStatus.FIREWALK,
      ]) {
        party.partyStatus[which] = 0;
      }
      for (const tag of page.list('STATUS')) {
        const which = tag.int(0, -1);
        if (which >= 0 && which <= PartyStatus.FIREWALK) {
          party.partyStatus[which as PartyStatus] = tag.int(1);
        }
      }
      party.keyTimes.clear();
      for (const tag of page.list('EVENT')) party.keyTimes.set(tag.int(0), tag.int(1));

      for (const row of party.stuffDone) row.fill(0);
      for (const tag of page.list('SDF')) {
        const x = tag.int(0, -1);
        const y = tag.int(1, -1);
        if (x >= 0 && x < party.stuffDone.length && y >= 0 && y < party.stuffDone[x]!.length) {
          party.stuffDone[x]![y] = tag.int(2);
        }
      }

      party.pointers.clear();
      party.magicPtrs.fill(0);
      for (const tag of page.list('POINTER')) {
        const i = tag.int(0, -1);
        if (i >= 10 && i < 100) party.magicPtrs[i - 10] = tag.int(1);
        else if (i >= 100 && i < 200) party.pointers.set(i, [tag.int(1), tag.int(2)]);
      }

      party.mNoted.clear();
      for (const tag of page.list('ROSTER')) party.mNoted.add(tag.int(0));
      party.mSeen.clear();
      for (const tag of page.list('SEEN')) party.mSeen.add(tag.int(0));
      party.hostilesPresent = page.first('HOSTILES')?.int(0) ?? 0;

      party.imprisonedMonst.fill(0);
      // Note the C++ writes the slot but then stores into `n`, the loop counter.
      // Kept: with the slots written in order the two agree anyway.
      let n = 0;
      for (const tag of page.list('SOULCRYSTAL')) {
        if (n < party.imprisonedMonst.length) party.imprisonedMonst[n] = tag.int(1);
        n++;
      }

      party.atWhichSaveSlot = page.first('WHICHSLOT')?.int(0) ?? 0;
      for (const tag of page.list('TOWNSAVE')) {
        const i = tag.int(0, -1);
        if (i < 0 || i >= party.creatureSave.length) continue;
        party.creatureSave[i]!.whichTown = tag.int(1, TOWN_NUM_OUTDOORS);
        party.creatureSave[i]!.hostile = tag.str(2) === 'HOSTILE';
      }

      party.alchemy.fill(false);
      for (const tag of page.list('ALCHEMY')) {
        const i = tag.int(0, -1);
        if (i >= 0 && i < party.alchemy.length) party.alchemy[i] = true;
      }

      party.specItems.clear();
      for (const tag of page.list('ITEM')) party.specItems.add(tag.int(0));

      party.activeQuests.clear();
      for (const tag of page.list('QUEST')) {
        party.activeQuests.set(tag.int(0), {
          status: readEnumTagOrNumber(questStatusNames, tag.str(1), QuestStatus.AVAILABLE),
          start: tag.int(2),
          source: tag.int(3, -1),
        });
      }

      party.storeLimitedStock.clear();
      for (const tag of page.list('SHOPSTOCK')) {
        const shop = tag.int(0);
        let slots = party.storeLimitedStock.get(shop);
        if (slots === undefined) {
          slots = new Map();
          party.storeLimitedStock.set(shop, slots);
        }
        slots.set(tag.int(1), tag.int(2));
      }
    } else if (page.firstKey() === 'BOAT' || page.firstKey() === 'HORSE') {
      const isBoat = page.firstKey() === 'BOAT';
      const list = isBoat ? party.boats : party.horses;
      const i = page.first(isBoat ? 'BOAT' : 'HORSE')!.int(0, -1);
      if (i < 0) continue;
      while (list.length <= i) list.push(emptyVehicle());
      list[i]!.exists = true;
      readVehicle(page, list[i]!);
    } else if (page.firstKey() === 'MAGICSTORE') {
      const tag = page.first('MAGICSTORE')!;
      const shop = tag.int(0);
      let slots = party.magicStoreItems.get(shop);
      if (slots === undefined) {
        slots = new Map();
        party.magicStoreItems.set(shop, slots);
      }
      slots.set(tag.int(1), readItem(page));
    } else if (page.firstKey() === 'JOBBANK') {
      const tag = page.first('JOBBANK')!;
      const i = tag.int(0, -1);
      if (i < 0) continue;
      while (party.jobBanks.length <= i) party.jobBanks.push(makeJobBank());
      const bank = party.jobBanks[i]!;
      bank.anger = tag.int(1);
      bank.inited = page.has('JOB');
      for (const job of page.list('JOB')) {
        const slot = job.int(0, -1);
        if (slot >= 0 && slot < bank.jobs.length) bank.jobs[slot] = job.int(1, -1);
      }
    } else if (page.firstKey() === 'ENCOUNTER') {
      const i = page.first('ENCOUNTER')!.int(0, -1);
      if (i < 0 || i >= party.outC.length) continue;
      const group = party.outC[i]!;
      group.exists = true;
      group.direction = readEnumTagOrNumber(dirTags, page.first('DIRECTION')?.str(0) ?? '', 0);
      takeLoc(page, 'SECTOR', group.whichSector);
      takeLoc(page, 'LOCINSECTOR', group.mLoc);
      readWandering(page, group.whatMonst);
    } else if (page.firstKey() === 'TIMER') {
      const tag = page.first('TIMER')!;
      const i = tag.int(0, -1);
      if (i < 0) continue;
      while (party.partyEventTimers.length <= i) {
        party.partyEventTimers.push({ time: 0, nodeType: 0, node: -1 });
      }
      party.partyEventTimers[i] = { time: tag.int(1), nodeType: tag.int(2), node: tag.int(3, -1) };
    } else if (page.firstKey() === 'CREATURE') {
      // A remembered town's creature: slot, then index within that town's
      // list. Only the living were written, so the gaps have to be filled with
      // dead ones — a default `cCreature` is DEAD in the C++ where this port's
      // is IDLE, and a blank live creature would stand invisibly in the town.
      const tag = page.first('CREATURE')!;
      const slot = tag.int(0, -1);
      const which = tag.int(1, -1);
      if (slot < 0 || slot >= party.creatureSave.length || which < 0) continue;
      const list = party.creatureSave[slot]!.monsters;
      while (list.length <= which) {
        const gap = new Creature();
        gap.active = CreatureStatus.DEAD;
        list.push(gap);
      }
      const c = list[which]!;
      readCreature(page, c);
      c.slot = which;
      c.active = CreatureStatus.IDLE;
    } else if (page.firstKey() === 'SUMMON') {
      monstI = page.first('SUMMON')!.int(0, 0);
      while (party.summons.length <= monstI) party.summons.push(defaultMonster());
      party.summons[monstI] = readMonster(page);
    } else if (page.firstKey() === 'ABIL') {
      if (monstI >= party.summons.length) continue;
      const abil = defaultAbilities()[0]!;
      const key = readAbility(page, abil);
      if (key !== MonstAbil.NO_ABIL) party.summons[monstI]!.abil[key] = abil;
    } else if (page.firstKey() === 'ENCNOTE') {
      const tag = page.first('ENCNOTE')!;
      party.specialNotes.push({
        type: readEnumTagOrNumber(encNoteTypes, tag.str(0), 0),
        where: tag.str(1),
        theStr: page.first('STRING')?.str(0) ?? '',
      });
    }
  }
}

function emptyVehicle(): Vehicle {
  return {
    loc: { x: 0, y: 0 },
    sector: { x: 0, y: 0 },
    whichTown: 0,
    exists: false,
    property: false,
    pic: 0,
    name: '',
  };
}

// --- cCurTown (universe.cpp) ------------------------------------------------

/** The bitfield the C++ packs a square's fields into; the bit index is the type. */
function packFields(town: CurTown, x: number, y: number): number {
  let bits = 0;
  if (town.explored[x]![y]!) bits |= 1 << FieldType.SPECIAL_EXPLORED;
  if (town.specialSpots[x]![y]!) bits |= 1 << FieldType.SPECIAL_SPOT;
  if (town.roads[x]![y]!) bits |= 1 << FieldType.SPECIAL_ROAD;
  for (const f of town.fields[x]![y]!) bits |= 1 << f;
  return bits;
}

function unpackFields(town: CurTown, x: number, y: number, bits: number): void {
  town.explored[x]![y] = bits & (1 << FieldType.SPECIAL_EXPLORED) ? 1 : 0;
  town.specialSpots[x]![y] = bits & (1 << FieldType.SPECIAL_SPOT) ? 1 : 0;
  town.roads[x]![y] = bits & (1 << FieldType.SPECIAL_ROAD) ? 1 : 0;
  const set = town.fields[x]![y]!;
  set.clear();
  for (let f = 1; f < 32; f++) {
    if (f === FieldType.SPECIAL_SPOT || f === FieldType.SPECIAL_ROAD) continue;
    if (bits & (1 << f)) set.add(f);
  }
  if (set.has(FieldType.FIELD_QUICKFIRE)) town.quickfirePresent = true;
}

export function writeCurTown(file: TagFile, univ: Universe, town: CurTown): void {
  const page = file.add();
  page.add('TOWN', univ.party.townNum);
  page.add('DIFFICULTY', town.record.difficulty);
  if (town.monstHostile) page.add('HOSTILE');
  putLoc(page, 'AT', univ.party.townLoc);
  for (let i = 0; i < town.items.length; i++) {
    if (town.items[i]!.variety === ItemType.NO_ITEM) continue;
    const itemPage = file.add();
    itemPage.add('ITEM', i);
    writeItem(itemPage, town.items[i]!);
  }
  for (let i = 0; i < town.monsters.length; i++) {
    if (!town.monsters[i]!.isAlive) continue;
    const monstPage = file.add();
    monstPage.add('CREATURE', i);
    writeCreature(monstPage, town.monsters[i]!);
  }
  // One tag per row for each of the two grids, which is how `encode(vector2d)`
  // lays a 2D array out (tagfile.hpp:383).
  //
  // **A row is a `y`, and the values along it are `x`.** `vector2d::operator[]`
  // hands back a *column* — so `terrain[x][y]`, which this port matches — but
  // `encode` walks `values.row(row)[col]` with `row` over the height. Writing
  // this the other way round transposes the town, which a round trip inside
  // this port cannot see (it reads back what it wrote) and which a **foreign**
  // save exposes at once: the party stands in the right square and every wall
  // around it is in the wrong place. Found by the C++'s replays, 2026-08-02.
  const dim = town.record.maxDim;
  const fieldsPage = file.add();
  for (let y = 0; y < dim; y++) {
    const row = fieldsPage.add('FIELDS');
    for (let x = 0; x < dim; x++) row.push(packFields(town, x, y));
  }
  for (let y = 0; y < dim; y++) {
    const row = fieldsPage.add('TERRAIN');
    for (let x = 0; x < dim; x++) row.push(town.record.terrain[x]![y]!);
  }
}

export function readCurTown(file: TagFile, univ: Universe, town: CurTown): void {
  const dim = town.record.maxDim;
  for (let p = 0; p < file.pages.length; p++) {
    const page = file.pages[p]!;
    if (p === 0) {
      univ.party.townNum = page.first('TOWN')?.int(0) ?? TOWN_NUM_OUTDOORS;
      town.record.difficulty = page.first('DIFFICULTY')?.int(0) ?? town.record.difficulty;
      town.monstHostile = page.has('HOSTILE');
      takeLoc(page, 'AT', univ.party.townLoc);
    } else if (page.firstKey() === 'FIELDS' || page.firstKey() === 'TERRAIN') {
      // Line `y`, position `x` — see the note in `writeCurTown`.
      const fields = page.list('FIELDS');
      for (let y = 0; y < dim && y < fields.length; y++) {
        for (let x = 0; x < dim; x++) unpackFields(town, x, y, fields[y]!.int(x, 0));
      }
      const terrain = page.list('TERRAIN');
      for (let y = 0; y < dim && y < terrain.length; y++) {
        for (let x = 0; x < dim; x++) town.record.terrain[x]![y] = terrain[y]!.int(x, 0);
      }
    } else if (page.firstKey() === 'ITEM') {
      const i = page.first('ITEM')!.int(0, -1);
      if (i < 0) continue;
      while (town.items.length <= i) town.items.push(defaultItem());
      town.items[i] = readItem(page);
    } else if (page.firstKey() === 'CREATURE') {
      const i = page.first('CREATURE')!.int(0, -1);
      if (i < 0) continue;
      // Only living creatures are written, so the slots between them have to be
      // dead — a default `cCreature` is `eCreatureStatus::DEAD` (creature.hpp:24)
      // where this port's default is IDLE, and a blank live creature would
      // stand invisibly in the middle of the town.
      while (town.monsters.length <= i) {
        const gap = new Creature();
        gap.active = CreatureStatus.DEAD;
        town.monsters.push(gap);
      }
      const c = town.monsters[i]!;
      readCreature(page, c);
      // `monst.init(i)` gives the slot back; the C++ then forces IDLE.
      c.slot = i;
      c.active = CreatureStatus.IDLE;
    }
  }
}

// --- cCurOut, and the two `.dat` map files ----------------------------------

/** writeArray (fileio.hpp:75) — rows of tab-separated values, then a form feed. */
function writeArray(rows: (x: number, y: number) => number, w: number, h: number): string {
  let out = '';
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) out += (x === 0 ? '' : '\t') + rows(x, y);
    out += '\n';
  }
  return out + '\f';
}

/** readArray's counterpart: `text` split into pages by the form feeds. */
function readArray(
  text: string, w: number, h: number, put: (x: number, y: number, v: number) => void,
): void {
  const lines = text.split('\n');
  for (let y = 0; y < h; y++) {
    const parts = (lines[y] ?? '').trim().split(/\s+/);
    for (let x = 0; x < w; x++) {
      const v = parseInt(parts[x] ?? '', 10);
      if (!Number.isNaN(v)) put(x, y, v);
    }
  }
}

export function writeCurOut(out: CurOut): string {
  return (
    writeArray((x, y) => out.terrain[x]![y]!, OUT_MAX_DIM, OUT_MAX_DIM) +
    writeArray((x, y) => out.explored[x]![y]!, OUT_MAX_DIM, OUT_MAX_DIM)
  );
}

export function readCurOut(text: string, out: CurOut): void {
  const [terrain = '', explored = ''] = text.split('\f');
  readArray(terrain, OUT_MAX_DIM, OUT_MAX_DIM, (x, y, v) => { out.terrain[x]![y] = v; });
  readArray(explored, OUT_MAX_DIM, OUT_MAX_DIM, (x, y, v) => { out.explored[x]![y] = v; });
}

/**
 * The explored bitmaps, one line per row. The C++ streams a
 * `boost::dynamic_bitset`, which prints from the **highest** index down, so
 * each line reads right to left. Its `maps[y]` is indexed by x; this port's
 * `maps[x][y]` is the transpose, hence the swap here.
 */
function writeBitset(bit: (i: number) => boolean, dim: number): string {
  let out = '';
  for (let i = dim - 1; i >= 0; i--) out += bit(i) ? '1' : '0';
  return out;
}

function readBitset(line: string, dim: number, set: (i: number, on: boolean) => void): void {
  const trimmed = line.trim();
  for (let i = 0; i < dim && i < trimmed.length; i++) {
    set(dim - 1 - i, trimmed[i] === '1');
  }
}

export function writeTownMaps(scen: Scenario): string {
  let out = '';
  for (const town of scen.towns) {
    for (let y = 0; y < town.maxDim; y++) {
      out += writeBitset((x) => town.maps[x]![y]! !== 0, town.maxDim) + '\n';
    }
  }
  return out;
}

export function readTownMaps(text: string, scen: Scenario): void {
  const lines = text.split('\n');
  let at = 0;
  for (const town of scen.towns) {
    for (let y = 0; y < town.maxDim; y++) {
      readBitset(lines[at++] ?? '', town.maxDim, (x, on) => { town.maps[x]![y] = on ? 1 : 0; });
    }
  }
}

export function writeOutMaps(scen: Scenario): string {
  let out = '';
  for (let i = 0; i < scen.outHeight; i++) {
    for (let j = 0; j < 48; j++) {
      for (let k = 0; k < scen.outWidth; k++) {
        const sector = scen.outdoors[k]![i]!;
        out += writeBitset((x) => sector.maps[x]![j]! !== 0, 48) + ' ';
      }
      out += '\n';
    }
    out += '\n';
  }
  return out;
}

export function readOutMaps(text: string, scen: Scenario): void {
  // The writer puts every sector of a row on one line, space separated, and a
  // blank line between bands; reading whitespace-separated words ignores both.
  const words = text.split(/\s+/).filter((w) => w !== '');
  let at = 0;
  for (let i = 0; i < scen.outHeight; i++) {
    for (let j = 0; j < 48; j++) {
      for (let k = 0; k < scen.outWidth; k++) {
        const sector = scen.outdoors[k]![i]!;
        readBitset(words[at++] ?? '', 48, (x, on) => { sector.maps[x]![j] = on ? 1 : 0; });
      }
    }
  }
}

// --- cScenario's mutable bits (scenario.cpp:569) ----------------------------

export function writeScenarioState(file: TagFile, scen: Scenario): void {
  const page = file.add();
  for (let i = 0; i < scen.towns.length; i++) {
    const town = scen.towns[i]!;
    if (town.itemTaken.some((t) => t)) {
      page.add('ITEMTAKEN', i, writeBitset((n) => town.itemTaken[n] === true, town.itemTaken.length));
    }
    for (const door of town.doorUnlocked) page.add('DOORUNLOCKED', i, door.x, door.y);
    page.add(town.canFind ? 'TOWNVISIBLE' : 'TOWNHIDDEN', i);
    // `cTown::m_killed` — how many of this town's creatures the party has
    // killed, which is the only input `is_cleaned_out` has. Without it a
    // reloaded game forgets that a town was emptied, and walks back into one
    // the C++ would have thrashed on entry.
    if (town.monstersKilled > 0) page.add('TOWNSLAUGHTER', i, town.monstersKilled);
  }
}

export function readScenarioState(file: TagFile, scen: Scenario): void {
  const page = file.at(0);
  if (page === undefined) return;
  for (const tag of page.list('ITEMTAKEN')) {
    const town = scen.towns[tag.int(0, -1)];
    if (town === undefined) continue;
    const bits = tag.str(1);
    town.itemTaken = new Array<boolean>(bits.length).fill(false);
    readBitset(bits, bits.length, (n, on) => { town.itemTaken[n] = on; });
  }
  for (const town of scen.towns) town.doorUnlocked = [];
  for (const tag of page.list('DOORUNLOCKED')) {
    const town = scen.towns[tag.int(0, -1)];
    if (town === undefined) continue;
    town.doorUnlocked.push({ x: tag.int(1), y: tag.int(2) });
  }
  for (const tag of page.list('TOWNVISIBLE')) {
    const town = scen.towns[tag.int(0, -1)];
    if (town !== undefined) town.canFind = true;
  }
  for (const tag of page.list('TOWNHIDDEN')) {
    const town = scen.towns[tag.int(0, -1)];
    if (town !== undefined) town.canFind = false;
  }
  // Only non-zero counts are written, so every town has to be cleared first —
  // the C++ does the same (`else towns[i]->m_killed = 0`, scenario.cpp:609).
  for (const town of scen.towns) town.monstersKilled = 0;
  for (const tag of page.list('TOWNSLAUGHTER')) {
    const town = scen.towns[tag.int(0, -1)];
    if (town !== undefined) town.monstersKilled = tag.int(1, 0);
  }
}

// --- the whole file ---------------------------------------------------------

/** `save_party_const` (fileio_party.cpp:536), minus the custom party graphics. */
export function serialiseSave(univ: Universe): Tarball {
  const ball = new Tarball();
  const file = new TagFile();

  writeParty(file, univ.party, univ.scenario.id);
  ball.addText('save/party.txt', file.serialise());

  for (let i = 0; i < 6; i++) {
    file.clear();
    writePlayer(file, univ.party.pcs[i]!);
    ball.addText(`save/pc${i + 1}.txt`, file.serialise());
  }

  if (univ.scenario.id !== '') {
    file.clear();
    writeScenarioState(file, univ.scenario);
    ball.addText('save/scenario.txt', file.serialise());

    // cParty::setup isn't modelled; the C++ still writes the "OBOE" marker page.
    file.clear();
    file.add().add('OBOE');
    ball.addText('save/setup.dat', file.serialise());

    if (univ.party.townNum < TOWN_NUM_OUTDOORS && univ.town !== null) {
      file.clear();
      writeCurTown(file, univ, univ.town);
      ball.addText('save/town.txt', file.serialise());
    }
    ball.addText('save/townmaps.dat', writeTownMaps(univ.scenario));
    ball.addText('save/out.txt', writeCurOut(univ.out));
    ball.addText('save/outmaps.dat', writeOutMaps(univ.scenario));
  }
  return ball;
}

/** The gzipped `.exg` bytes. */
export function saveGame(univ: Universe): Uint8Array {
  return gzipSync(serialiseSave(univ).serialise());
}

/** Accepts either the gzipped desktop form or the WASM build's plain tarball. */
export function openSave(data: Uint8Array): Tarball {
  const gzipped = data[0] === 0x1f && data[1] === 0x8b;
  return Tarball.read(gzipped ? gunzipSync(data) : data);
}

/** What the file picker needs without loading a scenario: `preview` mode. */
export interface SavePreview {
  scenarioId: string;
  age: number;
  gold: number;
  /** 200 when the party is outdoors. */
  townNum: number;
  pcs: { name: string; level: number; mainStatus: MainStatus }[];
}

export function readSavePreview(data: Uint8Array): SavePreview {
  const ball = openSave(data);
  const partyText = ball.text('save/party.txt');
  if (partyText === undefined) throw new Error('not a Blades of Exile save: no save/party.txt');
  const partyFile = TagFile.parse(partyText);
  const main = partyFile.at(0);
  const pcs: SavePreview['pcs'] = [];
  for (let i = 0; i < 6; i++) {
    const text = ball.text(`save/pc${i + 1}.txt`);
    if (text === undefined) continue;
    const page = TagFile.parse(text).at(0);
    if (page === undefined) continue;
    pcs.push({
      name: page.first('NAME')?.str(0) ?? '',
      level: page.first('LEVEL')?.int(0) ?? 1,
      mainStatus: readEnumTagOrNumber(
        mainStatusNames, page.next('STATUS')?.str(1) ?? '', MainStatus.ABSENT),
    });
  }
  const townText = ball.text('save/town.txt');
  const townNum = townText === undefined
    ? TOWN_NUM_OUTDOORS
    : TagFile.parse(townText).at(0)?.first('TOWN')?.int(0) ?? TOWN_NUM_OUTDOORS;
  return {
    scenarioId: partyScenarioName(partyFile),
    age: main?.first('AGE')?.int(0) ?? 0,
    gold: main?.first('GOLD')?.int(0) ?? 0,
    townNum,
    pcs,
  };
}

/**
 * **Everything the save does not mention goes back to its default**, because
 * that is what `load_party_v2` gets for free: it reads into a scratch
 * `cUniverse` (fileio_party.cpp:381) and moves it over the real one at the end,
 * so a field no page writes is the fresh object's, not the running game's. It
 * never calls `set_scenario` on that scratch universe either — the save is
 * expected to carry everything `enter_scenario` would have set up.
 *
 * This port reads into the *existing* Universe on purpose (the session, the
 * screen and the host callbacks all hold the reference), so the reset has to be
 * done by hand. It found a real bug: `out_c`, the ten outdoor encounter slots,
 * is only written for groups that exist, so loading a second save left the
 * first one's wandering band on the map — and `do_monsters` then rolled
 * `get_ran(1,1,6)` for a group the C++ did not have, on every tenth turn, for
 * the rest of the game.
 *
 * `Object.assign` from a freshly constructed object copies every field by name,
 * so a field added later is covered without this needing to know about it. The
 * two references that must survive are the PC array (the Universe built it and
 * `CurOut` closes over the Party) and each PC's back-pointer to the Party.
 */
function freshenForLoad(univ: Universe): void {
  const { pcs } = univ.party;
  Object.assign(univ.party, new Party());
  univ.party.pcs = pcs;
  for (const pc of pcs) {
    const owner = pc.party;
    Object.assign(pc, new Player());
    pc.party = owner;
  }
  univ.curPc = 0;
  univ.town = null;
}

/**
 * `load_party_v2`'s second half, written into an *existing* Universe. The C++
 * builds a scratch `cUniverse` and moves it over the real one at the end; here
 * the caller usually wants the object identity kept, because the session, the
 * screen and the host callbacks all hold a reference to it.
 *
 * The scenario must already be the one `readSavePreview` names — the C++ does
 * that lookup inline through `locate_scenario`, which has no browser
 * equivalent.
 */
export function applySave(data: Uint8Array, univ: Universe): void {
  const scenario = univ.scenario;
  const ball = openSave(data);
  const partyText = ball.text('save/party.txt');
  if (partyText === undefined) throw new Error('not a Blades of Exile save: no save/party.txt');

  freshenForLoad(univ);
  readParty(TagFile.parse(partyText), univ.party);
  for (let i = 0; i < 6; i++) {
    const text = ball.text(`save/pc${i + 1}.txt`);
    if (text === undefined) throw new Error(`corrupt save: no save/pc${i + 1}.txt`);
    readPlayer(TagFile.parse(text), univ.party.pcs[i]!);
  }

  const scenText = ball.text('save/scenario.txt');
  if (scenText !== undefined) readScenarioState(TagFile.parse(scenText), scenario);

  const townMaps = ball.text('save/townmaps.dat');
  if (townMaps !== undefined) readTownMaps(townMaps, scenario);
  const outMaps = ball.text('save/outmaps.dat');
  if (outMaps !== undefined) readOutMaps(outMaps, scenario);

  const townText = ball.text('save/town.txt');
  if (townText === undefined) {
    univ.party.townNum = TOWN_NUM_OUTDOORS;
    univ.town = null;
  } else {
    const townFile = TagFile.parse(townText);
    const which = townFile.at(0)?.first('TOWN')?.int(0) ?? TOWN_NUM_OUTDOORS;
    const record = scenario.towns[which];
    if (record === undefined) throw new Error(`save names town ${which}, which isn't in the scenario`);
    univ.town = new CurTown(record, univ);
    univ.town.monsters = [];
    univ.town.items = [];
    readCurTown(townFile, univ, univ.town);
  }

  // The outdoor window is rebuilt from the corner the party page restored,
  // then overwritten by the saved terrain and fog.
  univ.out.build();
  const outText = ball.text('save/out.txt');
  if (outText !== undefined) readCurOut(outText, univ.out);
}

/** `applySave` onto a Universe built for the occasion — what tests want. */
export function loadSave(data: Uint8Array, scenario: Scenario, rng: GameRng): Universe {
  const univ = new Universe(scenario, rng);
  applySave(data, univ);
  return univ;
}
