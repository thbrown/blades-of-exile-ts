/**
 * GameSession — the mode state machine and the party's movement/transition
 * logic. Ports outd_move_party and town_move_party (boe.actions.cpp:3942 and
 * :4139) plus start_town_mode / end_town_mode (boe.town.cpp:77 and :536),
 * minus the parts that need systems not yet built (specials execution,
 * combat, boats/horses, fields, lighting).
 *
 * Where a port stops short of the original, the omission is marked TODO with
 * the milestone that will fill it in, so drift stays visible.
 */

import { QuestStatus } from '../data/quest';
import { locationText } from '../replay/format';
import { ReplayRecorder } from '../replay/recorder';
import { tryAutoSave } from './autosave';
import { Direction, Location, dist, loc, locsEqual, minmax, shiftLoc } from '../core/location';
import { SIGHT_BLOCKED, canSee } from '../core/sight';
import { Item, ItemAbil, ItemType, defaultItem } from '../data/item';
import { MonstTime } from '../data/monster';
import { MonstAbil } from '../data/monsterAbility';
import { SpellNote } from '../universe/living';
import { FieldType } from '../data/fields';
import { AmbientSound, SECTOR_SIZE, SpecLoc } from '../data/outdoors';
import { StepSound, Terrain, TerObstruct, TerSpec, TrimType, blocksMove } from '../data/terrain';
import { TalkNodeType } from '../data/talking';
import { Lighting, Town } from '../data/town';
import { OutWandering } from '../data/outdoors';
import { Vehicle } from '../data/vehicle';
import { Snd, SoundPlayer } from '../platform/sound';
import {
  Creature, CreatureStatus, assignCreature, cloneCreature, copyMonster,
} from '../universe/creature';
import { Attitude, DamageType } from '../data/monster';
import { animSettle } from './anim';
import { damagePc, hitParty } from './damage';
import {
  NO_ONE, endTownCombat, pcAttack, pickNextPc, setPcMoves, startTownCombat, takeAp,
} from './combat';
import {
  TRACE_MMOVE, combatRunMonst, doMonsterTurn, doMonsters, monstAdjacent, monsterAttack,
} from './monsterTurn';
import {
  adjacentEncounter, countWalls, createWandMonst, doOutdoorMonsters, outEncLevTot,
} from './wandering';
import { setUpCombat, startOutdoorCombat } from './outCombat';
import { increaseAgeEffects } from './increaseAge';
import { processFields, syncForceCages } from './processFields';
import type { TownTarget } from './spellTarget';
import type { SpellTarget } from './spellCombatTarget';
import { LoadedMissile, fireMissile, isLoaded, loadMissile } from './missiles';
import { setCentreSink } from './missileAnim';
import { CurTown } from '../universe/curTown';
import type { Player } from '../universe/player';
import {
  GiveStatus,
  equipItem,
  giveItem,
  hasAbilEquip,
  takeItemFrom,
  unequipItem,
} from '../universe/inventory';
import { MainStatus, PartyStatus, Race, Skill, Status, Trait } from '../universe/skills';
import { Enchant, enchantWeapon } from '../data/enchant';
import { boomSpace, setBoomScreen } from './booms';
import { ShopItemType } from '../data/shop';
import { ShopState, handleSale, shopAllowsDead } from './shop';
import { SpellStore, emptySpellStore } from './spellRepeat';
import { ItemShopMode, ItemShopState, handleItemShopAction } from './itemShop';
import { isContainerAt } from './loot';
import { NO_TARGET } from './spellPick';
import { doRest, handleRest } from './rest';
import { makeTownHostile } from './townAttitude';
import { OUT_HALF_DIM, OUT_MAX_DIM } from '../universe/curOut';
import { Population, TOWN_NUM_OUTDOORS } from '../universe/party';
import { Universe } from '../universe/universe';
import { GameMode, PreModes, isCombat, isOut, isTown } from './modes';
import { bashDoor as bashDoorAt, pickLock as pickLockAt } from './doors';
import { TalkAction, TalkState } from './talk';
import { SpecType, SpecialNode } from '../data/special';
import { SpecCtx, SpecCtxType, SpecialHost } from './specials/context';
import { SpecialsEngine } from './specials/vm';
import { specialIncreaseAge } from './specialIncreaseAge';
import { alterSpace } from './specials/general';
import { pushThings } from './pushThings';
import { ONCE_DONE } from './specials/oneshot';
import { Spell } from '../data/spell';
import { castSpell } from './spellTown';
import { handleTargetMode } from './targetMode';
import { EffectPattern, SpellPat, getBuiltinPattern } from '../data/pattern';
import { drawTerrain } from './textBar';
import { showError } from './showError';

/** d_string (boe.combat.cpp:70) — the direction names the transcript prints. */
const DIRECTION_NAMES = [
  'North', 'NorthEast', 'East', 'SouthEast', 'South', 'SouthWest', 'West', 'NorthWest',
];

/** set_direction (boe.locutils.cpp) — direction from one point toward another. */
function setDirection(from: Location, to: Location): Direction {
  const dx = Math.sign(to.x - from.x);
  const dy = Math.sign(to.y - from.y);
  if (dx === 0 && dy === -1) return Direction.N;
  if (dx === 1 && dy === -1) return Direction.NE;
  if (dx === 1 && dy === 0) return Direction.E;
  if (dx === 1 && dy === 1) return Direction.SE;
  if (dx === 0 && dy === 1) return Direction.S;
  if (dx === -1 && dy === 1) return Direction.SW;
  if (dx === -1 && dy === 0) return Direction.W;
  if (dx === -1 && dy === -1) return Direction.NW;
  // **The same square is `DIR_S`, not "nowhere"** — `set_direction`
  // (boe.locutils.cpp:95) falls through `old.x == new.x` and `old.y > new.y`
  // into its `else return DIR_S`, so a move onto the square the party is
  // already standing on leaves it facing south. It never returns an eighth
  // value, and code here that tested for one was testing for nothing.
  return Direction.S;
}

const DIR_NAMES = ['north', 'northeast', 'east', 'southeast', 'south', 'southwest', 'west', 'northwest', ''];

/**
 * The four conveyor-belt refusal sets (boe.specials.cpp:145): a belt running
 * north can't be walked into from the north, and the two diagonals that
 * include north count as north too.
 */
const NO_MOVE_FROM_NORTH = new Set([Direction.N, Direction.NW, Direction.NE]);
const NO_MOVE_FROM_WEST = new Set([Direction.W, Direction.NW, Direction.SW]);
const NO_MOVE_FROM_SOUTH = new Set([Direction.S, Direction.SW, Direction.SE]);
const NO_MOVE_FROM_EAST = new Set([Direction.E, Direction.NE, Direction.SE]);

/**
 * entry_dir 9 in start_town_mode means "ignore start_locs, use town_force_loc".
 * Until the specials VM can set a forced location, this resolves to the town's
 * first usable start location.
 */
export const FORCED_ENTRY = 9;

/**
 * point_onscreen (boe.locutils.cpp:88) — the terrain view is 9x9, so anything
 * within four squares of its centre is on screen. This is game logic in the
 * original too, which is why the constant lives here and not in `render/`.
 */
export function pointOnScreen(center: Location, check: Location): boolean {
  return Math.abs(center.x - check.x) <= 4 && Math.abs(center.y - check.y) <= 4;
}

/**
 * One entry of `posted_labels` (boe.text.cpp:1179) — a caption a
 * `TOWN_PLACE_LABEL` node has hung on a square for a single frame. `centred`
 * is the node's `ex2a`, which drops the text half a tile so it sits over the
 * square rather than above it.
 */
export interface PostedLabel {
  text: string;
  at: Location;
  centred: boolean;
  /** `center` as it stood when the node posted this, for the same arithmetic. */
  center: Location;
}

/** What `do_look` calls each field and decal (boe.text.cpp:760), in its order. */
const LOOK_FIELD_NAMES: [FieldType, string][] = [
  [FieldType.FIELD_WEB, 'Web'], [FieldType.OBJECT_CRATE, 'Crate'],
  [FieldType.OBJECT_BARREL, 'Barrel'], [FieldType.OBJECT_BLOCK, 'Stone Block'],
  [FieldType.BARRIER_FIRE, 'Magic Barrier'], [FieldType.BARRIER_FORCE, 'Magic Barrier'],
  [FieldType.FIELD_QUICKFIRE, 'Quickfire'], [FieldType.WALL_FIRE, 'Wall of Fire'],
  [FieldType.WALL_FORCE, 'Wall of Force'], [FieldType.FIELD_ANTIMAGIC, 'Antimagic Field'],
  [FieldType.CLOUD_STINK, 'Stinking Cloud'], [FieldType.CLOUD_SLEEP, 'Sleep Cloud'],
  [FieldType.WALL_ICE, 'Ice Wall'], [FieldType.WALL_BLADES, 'Blade Wall'],
  [FieldType.BARRIER_CAGE, 'Force Cage'],
  [FieldType.SFX_SMALL_BLOOD, 'Blood stain'], [FieldType.SFX_MEDIUM_BLOOD, 'Blood stain'],
  [FieldType.SFX_LARGE_BLOOD, 'Blood stain'], [FieldType.SFX_SMALL_SLIME, 'Smears of slime'],
  [FieldType.SFX_LARGE_SLIME, 'Smears of slime'], [FieldType.SFX_ASH, 'Ashes'],
  [FieldType.SFX_BONES, 'Bones'], [FieldType.SFX_RUBBLE, 'Rubble'],
];

export class GameSession {
  mode: GameMode = GameMode.OUTDOORS;
  /** The tile the view is centered on; equals the party position in town. */
  center: Location = loc(0, 0);
  /**
   * Whose turn it was before combat started, so leaving combat hands control
   * back to the same PC (store_current_pc in boe.combat.cpp).
   */
  storeCurrentPc = 0;
  /**
   * `spell_caster` / `missile_firer` (boe.combat.cpp globals) — the last PC to
   * cast and the last to shoot. Monsters prefer them as targets, which is what
   * makes casting from the back rank draw fire.
   *
   * **Only `start_outdoor_combat` clears them** (boe.combat.cpp:183);
   * `start_town_combat` resets every monster's target and leaves these two
   * alone, so a town fight inherits whoever cast in the *previous* fight. That
   * asymmetry is the C++'s, kept deliberately.
   *
   * **They start at 0, not at 6.** `short spell_caster, ...` (boe.combat.cpp:57)
   * is a file-scope global, so it is zero-initialised — PC 0, not "nobody" —
   * and `monst_pick_target` therefore rolls its two `get_ran(1,1,5)` from the
   * very first fight of a new game, before anyone has cast or fired anything.
   * Starting them at 6 here, which reads far more sensibly, skipped those two
   * draws in every fight until someone cast a spell: five recordings in the
   * corpus parted on exactly that.
   */
  spellCaster = 0;
  missileFirer = 0;
  /** which_combat_type: 1 for a fight in a town, 0 for an outdoor arena. */
  whichCombatType = 0;

  /**
   * `fog_lifted` (boe.specials.cpp:58) — a **one-action** flag a
   * `TOWN_LIFT_FOG` node raises, which makes the whole town visible for the
   * rest of that action and is cleared at the tail of `advance_time`
   * (boe.actions.cpp:1930). It is what a scenario uses to show you something
   * happening across the map in a cutscene.
   *
   * It is *not* the same as marking the town explored, which is what this port
   * used to do: that is permanent, it is written into the save, and it left
   * every square the party had never walked on lit for the rest of the game.
   * The real thing short-circuits `party_can_see` instead, so it also changes
   * `party_can_see_monst` — and therefore which creatures may use their
   * SPECIAL ability, and which ones `check_if_monst_seen` announces.
   */
  fogLifted = false;

  /**
   * `cartoon_happening` (boe.specials.cpp:59) — set by `start_cartoon`
   * (:110) whenever a scripted node moves a PC around by `combat_pos` outside
   * combat, so the party briefly renders as six figures the way it does in a
   * fight. Reset at the same point `fogLifted` is (`afterPartyTurn`'s
   * finally) — the C++ clears both at the tail of `advance_time`, which runs
   * on every action, so the port's one town-turn hook keeps them together for
   * the same reason.
   */
  cartoonHappening = false;

  /**
   * `start_cartoon` (boe.specials.cpp:110) — the first node in a scripted
   * sequence scatters the party onto its own square (so a scene starting from
   * one figure has somewhere for the other five to spread out from);
   * anything after that leaves `combat_pos` alone. A no-op in combat, since
   * the party already has real `combat_pos`es there.
   */
  startCartoon(): void {
    if (!this.cartoonHappening && !isCombat(this.mode)) {
      for (const pc of this.univ.party.pcs) pc.combatPos = loc(this.univ.party.townLoc.x, this.univ.party.townLoc.y);
    }
    this.cartoonHappening = true;
  }

  /**
   * combat_active_pc — the PC in the middle of a multi-step action (firing,
   * casting). 6 means nobody, and then everyone acts in turn as normal.
   */
  combatActivePc = NO_ONE;
  /**
   * `store_spell_target` — the party member the casting dialog aimed the spell
   * at, for the spells whose `select` says they need one. 6 is "nobody
   * chosen", which is what the C++ leaves it at and what makes those arms do
   * nothing at all.
   */
  spellTarget = 6;

  /**
   * `store_drop_item` (boe.actions.cpp:93) — the pack slot armed for dropping
   * while the game waits for the square to drop it on. -1 is nothing armed.
   */
  dropSlot = -1;

  /**
   * `store_mage`/`store_priest` and their caster and target — what the **M**
   * and **P** shortcuts recast **out of combat**, written by
   * `doMageSpell`/`doPriestSpell` (boe.party.cpp:631, :894). The C++ keeps
   * these as globals; on the session they have the same lifetime and cannot
   * leak between two games in one process.
   */
  mageStore: SpellStore = emptySpellStore();
  priestStore: SpellStore = emptySpellStore();

  /**
   * `store_last_cast_mage` / `store_last_cast_priest` (boe.party.cpp:100),
   * indexed 0 mage / 1 priest — **who the spell picker opens on**, which is not
   * the same thing as `store_mage.caster`: `finish_pick_spell` writes this one
   * on every way out of the dialog, Cancel included. 6 is "nobody has yet".
   */
  lastCaster: [number, number] = [NO_TARGET, NO_TARGET];

  /**
   * `pc_casting` (boe.main.cpp:203) — **whoever the last spell picker settled
   * on**, and a third thing again from the two above: `lastCaster` is where the
   * dialog *opens*, `mageStore.caster` is who cast what is stored, and this is
   * the live cursor the dialog leaves behind. `repeat_cast_ok` reads it to
   * decide whether the shortcut may fire, so it has to survive the dialog.
   * The C++ leaves the global uninitialised; 0 is what it holds in practice.
   */
  pcCasting = 0;

  /**
   * The spell waiting for a square while the game is in SPELL_TARGET mode
   * (`start_spell_targeting`); null the rest of the time.
   */
  spellTargeting: SpellTarget | null = null;

  /**
   * `force_wall_position` (boe.combat.cpp:58) — which of the eight rotations of
   * PAT_WALL a wall spell is currently aimed along, or **10 for "no wall being
   * aimed"**, which is both its initial value and what `do_combat_cast` puts
   * back. `start_spell_targeting` sets it to 0 for the one rotatable builtin
   * and prints "(Hit space to rotate.)"; Space in SPELL_TARGET mode steps it on
   * (`spell_cast_hit_return`, :5038). Kept on the session rather than on
   * `spellTargeting` because the C++ keeps it as a global that outlives the
   * targeting state — the rotation chosen is still readable while the spell
   * resolves, which is when the pattern is actually placed.
   */
  forceWallPosition = 10;

  /**
   * The spell waiting for a square while the game is in TOWN_TARGET mode
   * (`start_town_targeting`); null the rest of the time.
   */
  townTarget: TownTarget | null = null;

  /** The armed missile while the game is in FIRING or THROWING mode. */
  missile: LoadedMissile | null = null;
  /**
   * `store_sum_monst` / `store_sum_monst_cost` — the soul-crystal slot
   * Simulacrum is about to summon and what it costs (the monster's own level,
   * not the spell's, which is -1 in the table). Chosen before targeting starts
   * and read when the spell resolves, exactly as the C++'s globals are.
   */
  sumMonst = 0;
  sumMonstCost = 0;
  /**
   * Set by the host: `soul-crystal.xml`, the picker Simulacrum opens. Returns
   * the monster number chosen, or 0 for cancel (which is also what no handler
   * means, so the spell simply doesn't go off).
   */
  onPickTrappedMonst: (() => Promise<number>) | null = null;
  /**
   * The throwaway 48×48 town an outdoor fight happens in (`cCurTown::arena`).
   * The party's `townNum` stays 200 the whole time — it is not *in* a town —
   * but `univ.town` points at this so terrain, sight and blocking all work.
   */
  arena: Town | null = null;
  /** The encounter being fought, for its on-win and on-flee specials. */
  storeWanderingSpecial: OutWandering | null = null;
  private numOutMoves = 0;
  private numTownMoves = 0;
  /** Optional; when absent the game runs silently (as tests do). */
  sound: SoundPlayer | null = null;
  /**
   * Set while a replay is being recorded. The C++ records from inside each
   * input handler through a global; this port hands the recorder to the
   * session and the same handful of entry points report to it. Null costs
   * nothing, which is the normal case.
   */
  recorder: ReplayRecorder | null = null;
  /** Non-null while a conversation is open. */
  talk: TalkState | null = null;
  /** Non-null while a shop is open. */
  shop: ShopState | null = null;
  /**
   * Non-null while the inventory panel is in a shop service mode (selling,
   * identifying, enchanting, recharging) — stat_screen_mode's shop half.
   */
  itemShop: ItemShopState | null = null;
  private preTalkMode: GameMode = GameMode.TOWN;
  private preShopMode: GameMode = GameMode.TOWN;

  constructor(readonly univ: Universe) {
    this.center = { ...univ.party.outLoc };
    this.updateExplored(univ.party.outLoc);
    // `do_missile_anim` writes the C++'s global `center` and never restores it,
    // and `party_can_see` reads it — see the note on `setCentreSink`. Installed
    // here for the same reason `Universe` installs `setPrintResult`: the C++
    // keeps the thing static, so the last session to be built owns it.
    setCentreSink((where) => { this.center = { ...where }; });
    // `boom_space`'s own redraws — installed here, and static there, for the
    // same reason. See `BoomScreen` in `booms.ts`.
    setBoomScreen({
      hidden: (where) => this.partyCanSee(where) === 6,
      redraw: (where) => {
        drawTerrain(this);
        // `if(!point_onscreen(center,where) && is_combat()) { play_sound; return; }`
        // (boe.graphics.cpp:1517) — a blast the camera is not looking at is
        // heard and not drawn, so it pays one redraw rather than two.
        if (isCombat(this.mode) && !pointOnScreen(this.center, where)) return;
        drawTerrain(this);
      },
    });
  }

  /**
   * put_party_in_scen (boe.party.cpp:213): a new game starts *inside* the
   * scenario's start town, with the outdoor start position standing by for
   * when the party walks out.
   */
  startNewGame(force = false): void {
    // "Everyone gets a weapon" (boe.actions.cpp:3789). In the C++ this is the
    // tail of `start_new_game`, which runs once party building is over and
    // before a scenario is even chosen — the `cPlayer(PARTY_DEFAULT, slot)`
    // constructor deliberately leaves the pack empty, so without this the
    // pregens walk in barehanded, three of them short their bonus spell
    // points and the slith and nephil short their racial stat bonuses. This
    // port has no party editor, so `startNewGame` is where the two steps meet.
    for (const pc of this.univ.party.pcs) {
      if (pc.mainStatus === MainStatus.ALIVE) pc.finishCreate();
    }
    this.univ.addStringToBuf(`Welcome to ${this.univ.scenario.title}.`);
    // `put_party_in_scen`: `build_outdoors(); erase_out_specials();`
    // (boe.party.cpp:207) before the party is put in its start town.
    this.eraseOutSpecials();
    // The forced square is the point of entry_dir 9: without it the party
    // lands on whichever town entrance `startLocs` happens to list first,
    // which for valleydy is the north gate rather than the guest quarters
    // the scenario opens in (boe.party.cpp:211).
    this.forceTownEntry(this.univ.scenario.startTown, this.univ.scenario.townStart);
    // The town's entry node does **not** fire at scenario start: the C++ queues
    // it in `handle_town_specials` and then empties the queue (boe.party.cpp:216,
    // "preserve legacy behaviour of not calling the enter town node at scenario
    // start"). See `startTownMode`'s `skipEntrySpecial`.
    this.startTownMode(this.univ.scenario.startTown, FORCED_ENTRY, true);
    // put_party_in_scen runs the scenario's on-init node last (boe.party.cpp:238)
    // — **and only when it was not forced** (:230). A `debug_launch_scen` or a
    // load straight from the startup screen passes `force`, and skips the intro
    // dialogs and the init node with it.
    if (!force) {
      void this.runSpecial(
        SpecCtx.STARTUP, SpecCtxType.SCEN, this.univ.scenario.initSpec, loc(0, 0));
    }
  }

  /**
   * The tail of `load_party` (boe.fileio.cpp:143): a restored Universe needs
   * the session put back in step with it. Everything transient is dropped — a
   * save can't be taken mid-shop or mid-spell, and combat isn't saved at all
   * (`save_party` refuses in `MODE_COMBAT`), so the game always resumes
   * standing in a town or on the world map.
   *
   * Deliberately *not* `startTownMode`: the town's creatures, items, fields and
   * terrain all came out of the save, and repopulating would put the dead back
   * on their feet. The lighting is **not** recomputed either — the C++ builds
   * that map when the scenario is read and only `alter_space` rebuilds it, so
   * see `setUpLights`.
   */
  resumeLoadedGame(): void {
    // **"Saved creatures may not have had their monster attributes saved. Make
    // sure that they know what they are!"** (finish_load_party,
    // boe.fileio.cpp:73). A creature's save page carries only its `cCreature`
    // half — its number, position, health, attitude — so straight out of a save
    // it has no level, no name, no abilities and no resistances at all. The C++
    // assigns the whole `cMonster` base back from the scenario's monster list,
    // deliberately as a base-class assignment so the `cCreature` fields survive.
    //
    // This port was missing it entirely, which is subtler than it sounds: the
    // creatures still walked around, but at level 0. `monst_check_special_terrain`
    // rolls `get_ran(1, 1, level / 2)`, and at level 0 that is a zero-width
    // range, so it drew **nothing** — a monster step that costs the C++ a
    // number cost this port none, and the town's stream slid one further out
    // with every step any creature took.
    // The C++ does this for the party's four *remembered* towns as well as for
    // the one it is standing in, and in that order — those creatures come out
    // of the same kind of page and are just as bare.
    const templates = this.univ.scenario.scenMonsters;
    const restock = (monst: Creature): void => {
      const template = templates[monst.number];
      if (template === undefined) return;
      monst.mon = copyMonster(template);
      // The four fields this port mirrors outside `mon`. They are `cMonster`
      // members there, so the assignment resets them too — including undoing
      // `assign`'s "an invisible monster draws as nothing", which is why a
      // reloaded invisible monster is visible again. Kept.
      monst.maxHealth = template.health;
      monst.pictureNum = template.pictureNum;
      monst.xWidth = template.xWidth;
      monst.yWidth = template.yWidth;
    };
    for (const pop of this.univ.party.creatureSave) for (const monst of pop.monsters) restock(monst);
    for (const monst of this.univ.town?.monsters ?? []) restock(monst);

    this.talk = null;
    this.shop = null;
    this.itemShop = null;
    this.missile = null;
    this.spellTargeting = null;
    this.townTarget = null;
    this.arena = null;
    this.storeWanderingSpecial = null;
    this.combatActivePc = NO_ONE;
    this.spellTarget = 6;
    this.univ.curPc = 0;
    // Both latches belong to the game that just ended, not to the one being
    // loaded over it: restoring from the death dialog puts a live party back in
    // place, and without this a second wipe would never announce itself.
    this.partyDead = false;
    this.scenarioWon = false;
    if (this.specials) this.specials.endScenario = false;
    const town = this.univ.town;
    if (town !== null) {
      this.mode = GameMode.TOWN;
      this.center = { ...this.univ.party.townLoc };
      this.updateExplored(this.univ.party.townLoc);
    } else {
      this.mode = GameMode.OUTDOORS;
      this.univ.party.townNum = TOWN_NUM_OUTDOORS;
      this.center = { ...this.univ.party.outLoc };
      this.updateExplored(this.univ.party.outLoc);
    }

    // **finish_load_party rebuilds the outdoor window** (boe.fileio.cpp:96),
    // and it matters: `save/out.txt` holds a 96×96 snapshot of `cCurOut` that
    // the save writes but the load throws away, stitching the four sectors
    // back together from the scenario instead. A save whose window had drifted
    // out of step with its sectors — which is what one recording's did, by a
    // handful of squares — otherwise walks its monsters over the wrong
    // terrain forever. `build` ends with `add_outdoor_maps`, so the explored
    // flags the save just restored are merged rather than lost.
    this.univ.out.build();
    // build_outdoors' own tail (boe.fileio.cpp:274): a group whose square is
    // off the rebuilt window is forgotten.
    for (const group of this.univ.party.outC) {
      if (!group.exists) continue;
      if (group.mLoc.x < 0 || group.mLoc.y < 0 || group.mLoc.x > 95 || group.mLoc.y > 95)
        group.exists = false;
    }
    // `finish_load_party` then calls `erase_out_specials` (boe.fileio.cpp:97)
    // — and `build_outdoors` has already called it once, which changes
    // nothing a second time.
    this.eraseOutSpecials();
  }

  private get preModes(): PreModes {
    return { shop: this.preShopMode, talk: this.preTalkMode };
  }

  get isOutdoors(): boolean {
    return isOut(this.mode, this.preModes);
  }

  get inTown(): boolean {
    return isTown(this.mode, this.preModes);
  }

  /**
   * Whether the world *around* the party is a town, rather than whether the
   * game mode is a town mode: `inTown` is false during combat, because
   * `MODE_COMBAT` sits outside `is_town`'s range, but the walls and the
   * darkness are still there. Anything to do with seeing and lighting has to
   * ask this, which is what the C++'s `univ.party.town_num != 200` does.
   */
  private get worldIsTown(): boolean {
    return this.univ.isInTown();
  }

  /** get_location (boe.text.cpp:1248) — the left half of the status bar. */
  locationName(): string {
    if (isCombat(this.mode)) {
      // The original puts the acting PC and their remaining moves in the text
      // bar during combat (draw_text_bar's combat half).
      const pc = this.univ.currentPc;
      return `${pc.name}: ${pc.ap} move${pc.ap === 1 ? '' : 's'} left`;
    }
    if (this.inTown && this.univ.town) {
      const town = this.univ.town.record;
      let name = town.name;
      const p = this.univ.party.townLoc;
      for (const area of town.areaDesc)
        if (p.x >= area.left && p.x <= area.right && p.y >= area.top && p.y <= area.bottom)
          name = area.descr;
      return name;
    }
    const sector = this.univ.out.sector;
    let name = sector.name;
    const p = this.univ.party.locInSec;
    for (const area of sector.areaDesc)
      if (p.x >= area.left && p.x <= area.right && p.y >= area.top && p.y <= area.bottom)
        name = area.descr;
    return name;
  }

  // ---------------------------------------------------------------- movement

  /**
   * The entry point the input layer calls for a directional keypress.
   *
   * Movement is async because a square can carry a special that puts a dialog
   * on screen before deciding whether the step goes through — the C++ blocks
   * inside check_special_terrain, and we await instead.
   */
  async move(dir: Direction): Promise<boolean> {
    const from = this.inTown ? this.univ.party.townLoc : this.univ.party.outLoc;
    const destination = shiftLoc(from, dir);
    return this.moveTo(destination);
  }

  /**
   * Where an outdoor move should head after leaving a town — end_town_mode's
   * return value, which handle_action assigns straight over `destination`
   * (boe.actions.cpp:770).
   */
  private pendingOutDest: Location | null = null;

  /** handle_action's movement branch (boe.actions.cpp:740-815). */
  async moveTo(destination: Location): Promise<boolean> {
    // `record_action("move", …)` at the top of handle_move: what is recorded is
    // the square asked for, not whether the step turned out to be legal.
    this.recorder?.recordLoc('move', destination);
    let moved = false;
    this.pendingOutDest = null;
    if (this.inTown) {
      // `someone_awake()` (boe.actions.cpp:2000), the guard `handle_move`'s
      // MODE_TOWN arm opens with (:759). A party where every living PC is
      // asleep or paralysed **cannot move at all**, and the refusal is
      // upstream of `town_move_party` — so it sets no `did_something` either,
      // and no turn passes. That last part is the whole of its observable
      // shape: the party is stuck *and* the clock is stuck, so nothing wears
      // the sleep off, and the only way out is the one the player took in
      // `ZKR_15-05-2025_16-09-51` — seven refused clicks and then Combat.
      if (!this.univ.party.pcs.some((pc) => pc.isAlive
        && (pc.status[Status.ASLEEP] ?? 0) <= 0
        && (pc.status[Status.PARALYZED] ?? 0) <= 0)) {
        this.univ.addStringToBuf("Everyone's asleep/paralyzed.");
        return false;
      }
      moved = await this.townMoveParty(destination);
      if (this.inTown && moved) {
        this.center = { ...this.univ.party.townLoc };
        this.updateExplored(destination);
        // handle_move's exit test (boe.actions.cpp:769): the party leaves the
        // town when the square it **actually reached** is off the active area,
        // not when the square it aimed at was. `end_town_mode` hands back the
        // outdoor square to walk out onto, which handle_move assigns straight
        // over `destination`.
        if (this.locOffActiveArea(this.univ.party.townLoc)) {
          this.pendingOutDest = this.endTownMode(destination);
        }
      }
    }
    // A town move that leaves the map switches us to outdoors mid-action, and
    // the outdoor move then runs in the same keypress — same as the original.
    if (this.mode === GameMode.OUTDOORS) {
      const outDest = this.pendingOutDest ?? destination;
      this.pendingOutDest = null;
      if (await this.outdMoveParty(outDest)) {
        moved = true;
        this.center = { ...this.univ.party.outLoc };
        this.updateExplored(this.univ.party.outLoc);
      }
      this.checkTownEntrance();
    }
    if (moved) await this.afterPartyTurn();
    return moved;
  }

  /**
   * The tail of handle_action (boe.actions.cpp:1959): after the party acts, the
   * clock moves on and the monsters get their go. In town that's `do_monsters`
   * (they notice you and walk over) followed by `do_monster_turn` (they hit
   * you), which is why you can be attacked without ever entering combat mode.
   *
   * **The clock ticks inside this**, in `increaseAgeEffects` — the note that
   * used to be here saying otherwise described an arrangement that was
   * corrected in July. So calling this *is* charging a turn, and any action
   * the C++ marks `did_something` has to call it or fall a tick behind
   * forever.
   */
  /**
   * `advance_time`'s `did_something` path. Public because the C++ sets that
   * flag from a dozen `handle_*` functions and only spends it once, at the end
   * of `handle_action` — there is no single place here that corresponds, so the
   * callers say so themselves.
   */
  async afterPartyTurn(): Promise<void> {
    try {
      await this.afterPartyTurnInner();
    } finally {
      // handle_monster_actions ends with this check (boe.actions.cpp:1932) —
      // upkeep (poison, disease, a field) or a monster's turn can be what
      // finishes the party off outside of combat.
      this.checkGameOver();
      // `fog_lifted = false` (boe.actions.cpp:1930) — *after* the monsters have
      // gone, which is the point: the creatures act while the fog is still up,
      // so `party_can_see_monst` says yes to everything on screen for that one
      // turn.
      //
      // TODO(M8): the C++ clears it at the tail of `advance_time`, which runs
      // on **every** action; this port has no single per-action hook, so a
      // `TOWN_LIFT_FOG` raised by an action that sets no `did_something` would
      // linger one action longer. Every node that can raise it fires from a
      // move, a look or a use, all of which come through here.
      this.fogLifted = false;
      // `cartoon_happening` (boe.actions.cpp:1941) — cleared the same way, and
      // blanking `combat_pos` back to (-1,-1) outside combat is what makes the
      // party draw as one figure again next turn.
      if (this.cartoonHappening && !isCombat(this.mode)) {
        for (const pc of this.univ.party.pcs) pc.combatPos = loc(-1, -1);
      }
      this.cartoonHappening = false;
    }
  }

  private async afterPartyTurnInner(): Promise<void> {
    // **`handle_monster_actions` branches on combat first** (boe.actions.cpp:1945),
    // and `increase_age` lives in the *else*: a fight has no clock, no fields
    // and no `do_monsters` — it has `combat_next_step`, which is what hands the
    // turn to the next PC. This branch was missing, so every did_something
    // action that reaches here from inside a fight — using an item, giving one
    // — ran a town turn's upkeep and never advanced the active PC. The visible
    // form: a PC used two potions, hit 0 AP, and then cast the *next* spell
    // herself, with her own intelligence bonus, where the C++ had already moved
    // on to the PC behind her.
    if (isCombat(this.mode) && this.mode !== GameMode.LOOK_COMBAT) {
      this.playAmbientSound();
      // The C++'s own guard (:1946): a wiped party ends the fight instead of
      // stepping it. `checkGameOver` in the caller's `finally` is this port's
      // end of that path.
      if (this.univ.party.isAlive()) this.monsterActionsCombat();
      return;
    }
    // handle_monster_actions opens with draw_map and play_ambient_sound
    // (boe.actions.cpp:1937), *before* increase_age. The sound is not the point
    // — the draws it makes are, and they come first in the turn.
    this.playAmbientSound();
    // increase_age's upkeep — poison biting, wounds closing, blessings running
    // out. Without this a status effect is only ever a line in the transcript.
    await increaseAgeEffects(this);
    // increase_age's tail (boe.actions.cpp:3578): quest deadlines and the town,
    // scenario and party timers, between the status upkeep and the fields.
    // The length is **1** even outdoors, where the clock has just jumped by 5
    // or 10 — that's what the C++ passes (the default argument), so an outdoor
    // turn ticks a party timer down by one, not by the time that passed.
    specialIncreaseAge(this, 1);
    // Conveyor belts, between the timers and the fields (boe.actions.cpp:3597).
    await pushThings(this);
    // The fields do their work here, before the monsters move — increase_age
    // runs ahead of do_monsters in town (boe.actions.cpp:1266). Outdoors there
    // are no fields, which is why the C++ gates this on is_town().
    if (this.mode === GameMode.TOWN) await processFields(this);
    // increase_age (boe.actions.cpp:3586) cancels a half-finished trade-places
    // every turn, so a stray first click doesn't swap someone a minute later.
    this.currentSwitch = NO_ONE;
    // The queue check at the tail of handle_action (boe.actions.cpp:1910),
    // which is what actually runs anything the timers queued. It goes on the
    // turn chain rather than being launched loose: a special can damage, and
    // damage waits for its blast now, so a fire-and-forget special would have
    // its explosions interleaving with the monsters' — two chains taking turns
    // on one timeline, in an order nothing decides. The chain is serial, so
    // this still runs before the monsters below it. Dialogs a special raises
    // are unaffected: their input is routed ahead of the `busy` gate.
    this.queueTurn(async () => { await this.specials?.drainQueue(); });
    if (this.mode === GameMode.TOWN) {
      await doMonsters(this);
      // The monsters' turn waits on the animation timeline now, so the rest of
      // the tail has to be queued behind it rather than run underneath it —
      // the wandering-group roll happens *after* they act, and `get_ran`'s
      // call order is part of the spec.
      this.queueTurn(async () => {
        await doMonsterTurn(this);
        // A town rolls for a new wandering group every turn, and a hard town
        // rolls more often — the difficulty is subtracted from the divisor,
        // and the party's "fewer wandering monsters" preference adds 200 to it
        // (boe.actions.cpp:1994).
        const difficulty = this.univ.townRecord?.difficulty ?? 0;
        const lessWm = this.univ.party.lessWm ? 200 : 0;
        if (this.univ.rng.getRan(1, 1, Math.max(2, 160 - difficulty + lessWm)) === 2) {
          createWandMonst(this);
        }
        this.checkGameOver();
      });
      return;
    }
    if (this.mode === GameMode.OUTDOORS) {
      // Outdoors the groups only move every tenth turn — the C++ comment says
      // "no monst move if party outdoors and on horse", which is what makes
      // outrunning an encounter possible at all.
      if (this.univ.party.age % 10 !== 0) return;
      if (!this.univ.party.pcs.some((pc) => pc.isAlive)) return;
      doOutdoorMonsters(this);
      // `get_ran(1,1,70 + less_wm * 200)` (boe.actions.cpp:1971).
      if (this.univ.rng.getRan(1, 1, 70 + (this.univ.party.lessWm ? 200 : 0)) === 10) {
        createWandMonst(this);
      }
      void this.checkOutdoorEncounter();
    }
  }

  /**
   * The trigger at the end of `handle_action`: a group standing next to the
   * party (or a `forced` one anywhere) starts a fight, unless its `spec_on_meet`
   * chain calls it off. A group in a boat or in the air is never met.
   *
   * `initiate_outdoor_combat` then gives the party one more out: an encounter
   * far below its level simply runs away.
   */
  async checkOutdoorEncounter(): Promise<boolean> {
    const univ = this.univ;
    if (univ.party.inBoat >= 0) return false;
    const which = adjacentEncounter(univ);
    if (which < 0) return false;
    const group = univ.party.outC[which]!;
    const encounter = group.whatMonst;
    group.exists = false;
    this.storeWanderingSpecial = encounter;

    if (encounter.specOnMeet >= 0) {
      const { blocked } = await this.runSpecial(
        SpecCtx.OUTDOOR_ENC, SpecCtxType.OUTDOOR, encounter.specOnMeet, univ.party.locInSec);
      if (blocked) return false;
    }

    if (univ.party.getLevel() > Math.trunc((outEncLevTot(univ, encounter) * 5) / 3)
      && outEncLevTot(univ, encounter) < 200 && !encounter.cantFlee) {
      univ.addStringToBuf('Combat: Monsters fled!');
      return false;
    }

    startOutdoorCombat(this, encounter, univ.party.outLoc, countWalls(univ, univ.party.outLoc));
    // `set_up_combat()` (boe.actions.cpp:2111) — `initiate_outdoor_combat`'s
    // last line, and the same call `debug_fight_encounter` makes.
    setUpCombat(this);
    this.onRedraw?.();
    return true;
  }

  /**
   * The outdoor half of ending a fight: the party can't leave while anything
   * hostile is still standing, and when it does it goes back outdoors with the
   * encounter's on-win chain fired.
   */
  private endOutdoorCombat(): boolean {
    const univ = this.univ;
    const stillAlive = (univ.town?.monsters ?? []).some((m) => m.isAlive && !m.isFriendly);
    if (stillAlive) {
      univ.addStringToBuf('Enemies are still alive!');
      return false;
    }
    this.exitArenaCombat();
    return true;
  }

  /**
   * The guts of leaving an outdoor arena, shared by `endOutdoorCombat`'s
   * voluntary exit (monster-alive check already passed) and the automatic
   * exit when everyone has fled — the C++'s `end_town_mode` call from
   * `handle_party_death` (boe.actions.cpp:1436) has no such check at all,
   * because there's nobody left standing to still be fighting.
   */
  /**
   * `handle_party_death`'s rout arm (boe.actions.cpp:1453) — **not**
   * `exitArenaCombat`, which is `end_combat` plus `end_town_mode`. The three
   * lines the C++ runs are:
   *
   *     end_town_mode(0, univ.party.town_loc);
   *     add_string_to_buf("End combat.");
   *     handle_wandering_specials(2);
   *
   * and `end_combat` is not among them. What that leaves behind is the whole
   * point:
   *
   *  - **`combat_pos` survives.** Every other exit clears it to (-1,-1);
   *    after a rout each PC still carries the square they stood on in the
   *    arena, and `handle_get_items` outdoors sweeps it — see
   *    `Universe.departedTown` and `reachableItems`.
   *  - **`parry` survives**, and so do POISONED_WEAPON, BLESS_CURSE and
   *    HASTE_SLOW: `end_town_mode` calls `clear_brief_status`, which is a
   *    different list.
   *  - **`univ.cur_pc` is not handed back to `store_current_pc`.** The fight
   *    left it at 6, and `party[6]` resolves to PC 0 (party.cpp:1143), so the
   *    square `handle_get_items` reads is PC **0**'s, whoever was acting.
   *  - **The special is `spec_on_flee`, not `spec_on_win`**
   *    (`handle_wandering_specials(2)`, boe.specials.cpp:138). The party ran;
   *    it did not win.
   *  - There is no `play_sound(93)`. That belongs to `end_outdoor_combat`.
   *
   * Bonus SP and HP are still trimmed, because that is at the top of
   * `end_town_mode` rather than in `end_combat`.
   */
  private routOutOfArena(): void {
    const univ = this.univ;
    for (const pc of univ.party.pcs) {
      // The bonus trim (boe.town.cpp:570), which is `end_town_mode`'s own.
      if (pc.curSp > pc.maxSp) pc.curSp = pc.maxSp;
      if (pc.curHealth > pc.maxHealth) pc.curHealth = pc.maxHealth;
      // `clear_brief_status` (:604), for every PC.
      pc.clearBriefStatus();
    }
    univ.party.partyStatus[PartyStatus.STEALTH] = 0;
    univ.party.partyStatus[PartyStatus.DETECT_LIFE] = 0;
    // The arena stays reachable, exactly as `univ.town` does there.
    univ.departedTown = univ.town;
    univ.town = null;
    this.arena = null;
    univ.party.townNum = TOWN_NUM_OUTDOORS;
    this.mode = GameMode.OUTDOORS;
    this.center = { ...univ.party.outLoc };
    this.updateExplored(univ.party.outLoc);
    univ.addStringToBuf('End combat.');
    const fled = this.storeWanderingSpecial;
    this.storeWanderingSpecial = null;
    if (fled && fled.specOnFlee >= 0) {
      void this.runSpecial(
        SpecCtx.FLEE_ENCOUNTER, SpecCtxType.OUTDOOR, fled.specOnFlee, univ.party.locInSec);
    }
  }

  private exitArenaCombat(): void {
    const univ = this.univ;
    for (const pc of univ.party.pcs) {
      if (pc.mainStatus === MainStatus.FLED) pc.mainStatus = MainStatus.ALIVE;
      pc.status[Status.POISONED_WEAPON] = 0;
      pc.status[Status.BLESS_CURSE] = 0;
      pc.status[Status.HASTE_SLOW] = 0;
      pc.parry = 0;
      pc.combatPos = loc(-1, -1);
      // Bonus health and spell points wear off with the fight.
      if (pc.curSp > pc.maxSp) pc.curSp = pc.maxSp;
      if (pc.curHealth > pc.maxHealth) pc.curHealth = pc.maxHealth;
    }
    this.combatActivePc = NO_ONE;
    univ.curPc = this.storeCurrentPc;
    if (!univ.currentPc.isAlive) univ.curPc = univ.firstActivePc();
    univ.town = null;
    this.arena = null;
    this.mode = GameMode.OUTDOORS;
    this.center = { ...univ.party.outLoc };
    univ.addStringToBuf('End combat.');
    this.sound?.play(93);
    const won = this.storeWanderingSpecial;
    this.storeWanderingSpecial = null;
    if (won && won.specOnWin >= 0) {
      void this.runSpecial(
        SpecCtx.WIN_ENCOUNTER, SpecCtxType.OUTDOOR, won.specOnWin, univ.party.locInSec);
    }
  }

  /**
   * `outd_is_blocked` (boe.locutils.cpp:392) — terrain **and** the ten
   * encounter groups.
   *
   * The groups were the missing half. They had been ported into `isBlocked`
   * instead, under a comment claiming the party's own step asked a narrower
   * question and could walk into a group, "which is how an encounter happens at
   * all". That was wrong twice over: the loop is inside `outd_is_blocked`
   * itself, which is exactly what `outd_move_party` (boe.actions.cpp:4087)
   * asks, and an encounter is met by `check_outdoor_encounter` finding a group
   * *adjacent* to the party, never by stepping onto one.
   *
   * It matters because a special can put a group down under the party's feet:
   * `OUT_PLACE_ENCOUNTER` runs from `check_special_terrain`, which
   * `outd_move_party` calls **before** this — so the square the party is
   * walking onto can acquire a group mid-step, and the step is then refused.
   */
  private outdIsBlocked(where: Location): boolean {
    // The C++ guards the whole body on the mode and answers "not blocked"
    // anywhere else.
    if (this.mode !== GameMode.OUTDOORS) return false;
    if (!this.univ.out.isOnMap(where.x, where.y)) return true;
    if (blocksMove(this.univ.terrainType(this.univ.out.at(where.x, where.y)))) return true;
    return this.univ.party.outC.some((g) => g.exists && locsEqual(g.mLoc, where));
  }

  /** town_boat_there / town_horse_there (boe.text.cpp:852/869). */
  private townVehicleAt(list: Vehicle[], where: Location): Vehicle | null {
    const townNum = this.univ.party.townNum;
    for (const v of list) {
      if (v.exists && v.whichTown === townNum && v.loc.x === where.x && v.loc.y === where.y) return v;
    }
    return null;
  }

  /**
   * out_boat_there / out_horse_there (boe.text.cpp:859/876). `where` is a
   * point in the 96x96 window, converted to sector-local coordinates the
   * same way the vehicle's own `loc` is stored.
   */
  private outVehicleAt(list: Vehicle[], where: Location): Vehicle | null {
    const { party } = this.univ;
    const local = party.globalToLocal(where);
    const sector = { x: party.outdoorCorner.x + party.iwc.x, y: party.outdoorCorner.y + party.iwc.y };
    for (const v of list) {
      if (!v.exists || v.whichTown !== TOWN_NUM_OUTDOORS) continue;
      if (v.loc.x !== local.x || v.loc.y !== local.y) continue;
      if (v.sector.x !== sector.x || v.sector.y !== sector.y) continue;
      return v;
    }
    return null;
  }

  private get flying(): boolean {
    return this.univ.party.partyStatus[PartyStatus.FLIGHT] > 0;
  }

  /** outd_move_party (boe.actions.cpp:3942). */
  private async outdMoveParty(destination: Location): Promise<boolean> {
    const { party, out, scenario } = this.univ;
    if (!out.isOnMap(destination.x, destination.y)) return false;

    // check_special_terrain for OUT_MOVE runs first (boe.actions.cpp:3950) —
    // this is what poisons you in a swamp and burns you in lava out here, and
    // it is also where the sector's own special node fires. Its `forced` is
    // the node's `b` return, which walks the party across water at a ford.
    const check = await this.checkSpecialTerrain(destination, this.univ.party.pcs[0]!);
    // **`keep_going && overall_mode == MODE_OUTDOORS`** (boe.actions.cpp:3975),
    // and the 1997 original pairs them the same way (`ACTIONS.CPP:2687`,
    // `overall_mode == 0`). The mode test is not redundant with `canEnter`: a
    // node at the destination can *change the mode* without blocking anything —
    // `ENTER_SHOP` calls `start_shop_mode`, and a node can drop the party into
    // a town — and when it does, the step must not also happen. The C++ says so
    // in a comment: "If not blocked and not put in town by a special".
    //
    // Without it the party ends up one square past where the recording left it,
    // and *stays* there: `ASR_05-05-2025_21-21-52` walks onto a shop node at
    // outdoor (21,22), shops in both engines, and comes out at (69,70) here
    // against (68,69) there. Nothing diverges until 20 actions later, when the
    // recording steps somewhere this port thinks is two squares away.
    //
    // `town_move_party` deliberately has **no** such guard (boe.actions.cpp:4196
    // is a bare `if(keep_going)`, matching `ACTIONS.CPP:2911`), so this belongs
    // to the outdoor path alone.
    // `if(univ.debug_mode && univ.ghost_mode) forced = keep_going = true;`
    // (boe.actions.cpp:3971) — with both on, nothing refuses a step.
    const ghost = this.univ.debugMode && this.univ.ghostMode;
    if ((!check.canEnter && !ghost) || this.mode !== GameMode.OUTDOORS) return false;
    const specialForced = check.forced || ghost;

    const offset = { x: destination.x - party.outLoc.x, y: destination.y - party.outLoc.y };
    const storeCorner = { ...party.outdoorCorner };
    const storeIwc = { ...party.iwc };

    // Sliding the 96x96 window when the party nears its edge.
    if (destination.x < 6 && party.outdoorCorner.x > 0) out.shift(-1, 0);
    if (destination.x > 90 && party.outdoorCorner.x < scenario.outWidth - 1) out.shift(1, 0);
    if (destination.y < 6 && party.outdoorCorner.y > 0) out.shift(0, -1);
    else if (destination.y > 90 && party.outdoorCorner.y < scenario.outHeight - 1) out.shift(0, 1);
    // Every shift ends in `build_outdoors`, and `build_outdoors` ends in
    // `erase_out_specials` (boe.fileio.cpp:272): a rebuilt window starts
    // from the scenario's own terrain, so the hidden towns and finished
    // specials have to be taken out of it again.
    if (party.outdoorCorner.x !== storeCorner.x || party.outdoorCorner.y !== storeCorner.y) {
      this.eraseOutSpecials();
    }

    const realDest = loc(party.outLoc.x + offset.x, party.outLoc.y + offset.y);

    const atWorldEdge =
      (realDest.x < 1 && party.outdoorCorner.x <= 0) ||
      (realDest.x > 94 && party.outdoorCorner.x >= scenario.outWidth - 2) ||
      (realDest.x > 46 && party.outdoorCorner.x >= scenario.outWidth - 1) ||
      (realDest.y < 1 && party.outdoorCorner.y <= 0) ||
      (realDest.y > 94 && party.outdoorCorner.y >= scenario.outHeight - 2) ||
      (realDest.y > 46 && party.outdoorCorner.y >= scenario.outHeight - 1);
    if (atWorldEdge) {
      this.univ.addStringToBuf("You've reached the world's edge.");
      return false;
    }

    // The boat/horse block runs before `party.direction` is set in the C++
    // too — a leave/board decision doesn't need it. `forced` starts from the
    // special node's own `forced` return and the boat-bridge prompt can also
    // set it — either one bypasses the blockage test below, same as the C++'s
    // single combined `forced` local.
    let forced = specialForced;
    const ter = out.at(realDest.x, realDest.y);
    const terType = this.univ.terrainType(ter);
    // `[outmove]` — the pair to the harness's `BOE_TRACE_OUTMOVE=1`, printed at
    // the same point in `outd_move_party` (boe.actions.cpp:4045) and with the
    // same fields. The one that answers questions is `ter=`: an outdoor step
    // refused here and taken there, with no draws between them, is nearly
    // always the two runs holding *different terrain* on the square rather than
    // a movement rule. Without this the only evidence was "a turn happened
    // there and not here", which names nothing.
    if (TRACE_MMOVE) {
      // eslint-disable-next-line no-console
      console.log(`      [outmove] dest=(${destination.x},${destination.y})`
        + ` real=(${realDest.x},${realDest.y})`
        + ` corner=(${party.outdoorCorner.x},${party.outdoorCorner.y})`
        + ` ter=${ter} blocked=${Number(this.outdIsBlocked(realDest))}`
        + ` forced=${Number(forced)}`);
    }
    const diagonal = realDest.x !== party.outLoc.x && realDest.y !== party.outLoc.y;
    /**
     * **Nothing.** The C++ shifts the window before it decides whether the step
     * is legal, and when it refuses the step it *leaves the window shifted*
     * (boe.actions.cpp:3972 has no undo path). The party's `out_loc` has
     * already been renumbered by 48 at that point, so bumping into a mountain
     * near the seam still slides the whole 96×96 view a sector over — and the
     * recordings prove it: one walks east to (91,10), is refused by the
     * terrain, and the very next recorded move is `(42,9)`, which only makes
     * sense in the *new* window.
     *
     * This port used to put the window back, which reads like the obviously
     * right thing and is not what the game does. Kept as a named no-op rather
     * than deleted at the call sites, so the six places that "undo" still say
     * where the C++ chose not to.
     */
    const undoWindowShift = (): void => {
      void storeCorner; void storeIwc;
    };
    if (party.inBoat >= 0) {
      if (
        !this.outdIsBlocked(realDest)
        && (!terType.boatOver || diagonal)
        && terType.special !== TerSpec.TOWN_ENTRANCE
      ) {
        this.univ.addStringToBuf('You leave the boat.');
        party.inBoat = -1;
      } else if (diagonal || (!forced && this.outVehicleAt(party.boats, destination))) {
        this.univ.addStringToBuf("Move: Boat can't move diagonally.");
        undoWindowShift();
        return false;
      } else if (
        !this.outdIsBlocked(realDest)
        && terType.boatOver
        && terType.special !== TerSpec.TOWN_ENTRANCE
      ) {
        if ((await this.onConfirmBoatBridge?.()) ?? false) {
          forced = true;
        } else {
          this.univ.addStringToBuf('You leave the boat.');
          party.inBoat = -1;
        }
      } else if (terType.boatOver) {
        forced = true;
      }
    }

    party.direction = setDirection(party.outLoc, destination);
    const dirStr = DIR_NAMES[party.direction] ?? '';

    const boardBoat = party.inBoat < 0 && party.inHorse < 0
      ? this.outVehicleAt(party.boats, realDest) : null;
    const boardHorse = party.inBoat < 0 && party.inHorse < 0
      ? this.outVehicleAt(party.horses, realDest) : null;
    if (boardBoat) {
      if (this.flying) {
        this.univ.addStringToBuf('You land first.');
        party.partyStatus[PartyStatus.FLIGHT] = 0;
      }
      this.univ.addStringToBuf('Move: You board the boat.');
      party.inBoat = party.boats.indexOf(boardBoat);
      party.outLoc = realDest;
      party.iwc = { x: realDest.x > 48 ? 1 : 0, y: realDest.y > 48 ? 1 : 0 };
      party.locInSec = party.globalToLocal(realDest);
      return true;
    } else if (boardHorse) {
      if (this.flying) {
        this.univ.addStringToBuf('Land before mounting horses.');
        undoWindowShift();
        return false;
      }
      this.univ.addStringToBuf('Move: You mount the horses.');
      this.sound?.play(84);
      party.inHorse = party.horses.indexOf(boardHorse);
      party.outLoc = realDest;
      party.iwc = { x: realDest.x > 48 ? 1 : 0, y: realDest.y > 48 ? 1 : 0 };
      party.locInSec = party.globalToLocal(realDest);
      return true;
    } else if (this.outdIsBlocked(realDest) && !forced && !(this.flying && terType.flyOver)) {
      this.univ.addStringToBuf(`Blocked: ${dirStr}`);
      undoWindowShift();
      return false;
    }

    if (party.inHorse >= 0) {
      if (terType.special === TerSpec.DAMAGING || terType.special === TerSpec.DANGEROUS) {
        this.univ.addStringToBuf('Your horses quite sensibly refuse.');
        undoWindowShift();
        return false;
      }
      if (terType.blockHorse) {
        this.univ.addStringToBuf("You can't take horses there!");
        undoWindowShift();
        return false;
      }
    }
    if (this.flying && terType.special === TerSpec.TOWN_ENTRANCE) {
      this.univ.addStringToBuf('Moved: You have to land first.');
      undoWindowShift();
      return false;
    }

    party.outLoc = realDest;
    party.iwc = { x: realDest.x > 47 ? 1 : 0, y: realDest.y > 47 ? 1 : 0 };
    party.locInSec = party.globalToLocal(realDest);
    this.univ.addStringToBuf(`Moved: ${dirStr}`);
    this.moveSound(this.univ.out.at(realDest.x, realDest.y), this.numOutMoves);
    this.numOutMoves++;
    if (party.inBoat >= 0) this.runWaterfalls(false);
    if (party.inHorse >= 0) {
      party.horses[party.inHorse]!.whichTown = TOWN_NUM_OUTDOORS;
      party.horses[party.inHorse]!.loc = party.locInSec;
      party.horses[party.inHorse]!.sector = {
        x: party.outdoorCorner.x + party.iwc.x,
        y: party.outdoorCorner.y + party.iwc.y,
      };
    }
    return true;
  }

  /** move_sound (boe.main.cpp:1995), minus the boat/horse/swamp special cases. */
  /**
   * Public because `combat_move_monster` (boe.monster.cpp:721) plays this
   * too, from `monsterTurn.ts`'s free-function combat movement, not just the
   * party's own moves.
   */
  moveSound(ter: number, step: number): void {
    if (!this.sound) return;
    switch (this.univ.terrainType(ter).stepSound) {
      case StepSound.SQUISH:
        this.sound.play(Snd.SQUISH);
        break;
      case StepSound.CRUNCH:
        this.sound.play(Snd.CRUNCH);
        break;
      case StepSound.SPLASH:
        this.sound.play(Snd.SPLASH);
        break;
      case StepSound.NONE:
        break;
      case StepSound.STEP:
        this.sound.play(step % 2 === 0 ? Snd.STEP_A : Snd.STEP_B);
        break;
    }
  }

  /**
   * The town-entrance check that follows an outdoor move
   * (boe.actions.cpp:789). Entering is driven by the terrain's special, not
   * by the city_locs list alone — the list only names which town.
   */
  private checkTownEntrance(): void {
    const { party, out } = this.univ;
    const ter = this.univ.terrainType(out.at(party.outLoc.x, party.outLoc.y));
    if (ter.special !== TerSpec.TOWN_ENTRANCE) return;

    // find_direction_from: which of the town's four entrances we arrive at.
    let entryDir: number;
    if (party.direction === Direction.N) entryDir = 2;
    else if (party.direction === Direction.S) entryDir = 0;
    else if (party.direction < Direction.S) entryDir = 3;
    else entryDir = 1;

    for (const city of out.sector.cityLocs) {
      if (city.x !== party.locInSec.x || city.y !== party.locInSec.y) continue;
      if (city.spec >= 0) this.startTownMode(city.spec, entryDir);
      if (this.inTown) return;
    }
  }

  /**
   * is_blocked (boe.locutils.cpp) — can nothing stand here? Much broader than
   * terrain: it also counts creatures, the party, force barriers and cages, and
   * *during combat* the marked special spots and city-trim terrain (which is
   * how the original keeps combatants off portals). This is what combat
   * placement and monster movement have to ask; `townIsBlocked` alone let PCs
   * materialise on top of monsters and inside walls.
   */
  isBlocked(where: Location): boolean {
    const town = this.univ.town;
    if (!town) {
      if (!this.univ.out.isOnMap(where.x, where.y)) return true;
      if (this.outdIsBlocked(where)) return true;
      if (locsEqual(where, this.univ.party.outLoc)) return true;
      // The wandering groups block each other (boe.locutils.cpp:399). Note
      // this is `is_blocked`'s outdoor half, not `impassable`'s — the party's
      // own step asks the narrower question and may still walk into a group,
      // which is how an encounter happens at all.
      return this.univ.party.outC.some(
        (g) => g.exists && locsEqual(g.mLoc, where));
    }
    if (!town.isOnMap(where.x, where.y)) return true;
    if (this.townIsBlocked(where)) return true;

    const inCombat = isCombat(this.mode);
    if (inCombat) {
      // Keep combatants off marked specials and off portals. This is
      // `cCurTown::is_spot` — the **SPECIAL_SPOT field flag** — and not
      // `is_special`, the scan of `special_locs` that `specialAt` uses. The
      // difference is `erase_town_specials`: a completed one-shot keeps its
      // entry in `special_locs` for ever but loses the flag, and after that a
      // creature may walk over the square again. `checkSpecialTerrain` reads
      // the same flag for the same reason.
      if (town.hasField(where.x, where.y, FieldType.SPECIAL_SPOT)) return true;
      if (this.univ.terrainType(town.record.terrain[where.x]![where.y]!).trimType
        === TrimType.CITY) return true;
    }

    // The party's square, or a PC's, depending on the mode.
    if (!inCombat && locsEqual(where, this.univ.party.townLoc)) return true;
    if (inCombat && this.univ.party.pcs.some(
      (pc) => pc.isAlive && locsEqual(pc.combatPos, where))) return true;

    if (town.monsterAt(where)) return true;
    if (town.hasField(where.x, where.y, FieldType.BARRIER_FORCE)) return true;
    if (town.hasField(where.x, where.y, FieldType.BARRIER_CAGE)) return true;
    return false;
  }

  townIsBlocked(where: Location): boolean {
    const town = this.univ.town!;
    // Off the map counts as blocked: combat placement walks a table of offsets
    // that can run past the edge, and `sightObscurity` is asked the same way.
    if (!town.isOnMap(where.x, where.y)) return true;
    const ter = this.univ.terrainType(town.record.terrain[where.x]![where.y]!);
    return (
      ter.blockage === TerObstruct.BLOCK_MOVE ||
      ter.blockage === TerObstruct.BLOCK_MOVE_AND_SHOOT ||
      ter.blockage === TerObstruct.BLOCK_MOVE_AND_SIGHT
    );
  }

  /** town_move_party (boe.actions.cpp:4155). */
  private async townMoveParty(destination: Location): Promise<boolean> {
    const { party } = this.univ;
    const town = this.univ.town!;

    // **Leaving town is not decided here.** It used to be: this function
    // opened by testing the destination against `in_town_rect` and exiting the
    // town on the spot. The C++ tests `loc_off_act_area(univ.party.town_loc)`
    // in `handle_move` (boe.actions.cpp:769) — the party's square *after* a
    // move that actually succeeded — so a step into the border column is
    // refused like any other when a wall or a creature is standing in it, and
    // the party stays put. Walking into the town's edge wall used to walk the
    // party out of the town instead.
    // The other line that was missing: a party inside a force cage cannot
    // walk out of it (boe.actions.cpp:4159). The combat half already had it.
    if (town.hasField(party.townLoc.x, party.townLoc.y, FieldType.BARRIER_CAGE)) {
      this.univ.addStringToBuf("Move: Can't escape.");
      return false;
    }

    if (!town.isOnMap(destination.x, destination.y)) return false;

    /**
     * **A creature in the way just blocks the step.** This port used to start a
     * fight instead — "walking into something hostile starts a fight rather
     * than bouncing off" — which is an invention: `start_town_combat` has
     * exactly three callers in the C++ (`handle_combat_switch`, and two
     * specials), and walking is not one of them. In the original you bump into
     * a monster, read "Blocked: east", and press **C** if you want the fight.
     *
     * It desynced any recording where the player brushed past something, and
     * it is the kind of "improvement" the fidelity rule exists to catch.
     */
    const monsterThere = town.monsterAt(destination);

    // **`party.direction` is *not* set here.** The C++ sets it inside
    // `if(keep_going)`, after `check_special_terrain` and after the boat block
    // (boe.actions.cpp:4228) — `townVehicleStep` below is where this port does
    // it. Setting it up front turned every *refused* step into a facing change:
    // a square blocked by a wall, a special that said no, a boat that can't go
    // diagonally. Nothing prints the facing, so it went unnoticed until
    // `start_town_combat` dealt the party onto the board from it and four PCs
    // landed on the wrong squares — two of them on the same one.
    //
    // check_special_terrain for TOWN_MOVE (boe.specials.cpp:152).
    //
    // **Gated on there being no monster on the square** — the C++ only calls it
    // `if(univ.target_there(destination, TARG_MONST) == nullptr)`
    // (boe.actions.cpp:4152), so a creature standing on a scripted square stops
    // the script from running as well as stopping the step.
    // The town mover's copy of the same two lines (boe.actions.cpp:4193).
    const ghost = this.univ.debugMode && this.univ.ghostMode;
    let specialForced = ghost;
    if (monsterThere === null) {
      const check = await this.checkSpecialTerrain(destination, this.univ.party.pcs[0]!);
      if (!check.canEnter && !ghost) return false;
      specialForced = check.forced || ghost;
      // The chain may have taken the party somewhere else entirely.
      if (!this.inTown || this.univ.town !== town) return true;
    }

    // town_move_party's boat/horse handling (boe.actions.cpp:4159): a leave,
    // a diagonal refusal, a bridge prompt, or boarding a vehicle waiting on
    // the destination square. Boarding returns straight away, same as the
    // outdoor half; a bridge crossing sets `vehicleForced` to bypass the
    // blocked-terrain test below, the same way a scenario's `forced` return
    // does.
    const vehicleStep = await this.townVehicleStep(destination);
    if (vehicleStep === 'boarded') return true;
    if (vehicleStep === 'blocked') return false;
    const vehicleForced = vehicleStep === 'forced';

    // `is_blocked` (boe.locutils.cpp:261) is more than the terrain: a creature,
    // a force barrier or a force cage all stop the step the same way — **and so
    // does the party's own square** (`if(is_town() && to_check ==
    // univ.party.town_loc) return true`, :294).
    //
    // That last one is why this calls `isBlocked` rather than assembling the
    // list here, which is what it used to do: a `move` onto the square the
    // party is *already standing on* is refused by the C++ and was allowed
    // here, so it charged a turn the C++ never charges. Recordings contain
    // those moves — the original's own `set_direction` has a fall-through for
    // exactly this case — and one extra turn puts every creature in the town a
    // step ahead, permanently, while spending **no draws at all** to say so.
    const blocked = this.isBlocked(destination);

    // A `forced` return from the square's special — like the bridge prompt's —
    // only bypasses the blockage test. It does **not** short-circuit the rest
    // of the step: the horses still refuse dangerous ground, and the footstep
    // still makes a sound.
    if (blocked && !vehicleForced && !specialForced) {
      // `is_door` (boe.town.cpp:1564) — a door says so instead, which is the
      // hint that it is worth unlocking rather than walking round.
      const terSpec = this.univ.terrainType(
        town.record.terrain[destination.x]![destination.y]!).special;
      const isDoor = terSpec === TerSpec.UNLOCKABLE
        || terSpec === TerSpec.CHANGE_WHEN_STEP_ON;
      this.univ.addStringToBuf(
        `${isDoor ? 'Door locked' : 'Blocked'}: ${DIR_NAMES[party.direction] ?? ''}`);
      return false;
    }

    if (party.inHorse >= 0) {
      const terSpec = this.univ.terrainType(
        town.record.terrain[destination.x]![destination.y]!);
      if (terSpec.special === TerSpec.DAMAGING || terSpec.special === TerSpec.DANGEROUS) {
        this.univ.addStringToBuf('Your horses quite sensibly refuse.');
        return false;
      }
      if (terSpec.blockHorse) {
        this.univ.addStringToBuf("You can't take horses there!");
        return false;
      }
      if (town.record.lightingType !== Lighting.LIGHT_NORMAL && this.univ.rng.getRan(1, 0, 1) === 0) {
        this.univ.addStringToBuf('The darkness spooks your horses.');
        return false;
      }
    }

    party.townLoc = destination;
    this.univ.addStringToBuf(`Moved: ${DIR_NAMES[party.direction] ?? ''}`);
    this.moveSound(town.record.terrain[destination.x]![destination.y]!, this.numTownMoves++);
    town.makeExplored(destination.x, destination.y);
    this.updateExplored(this.univ.party.townLoc);
    if (party.inBoat >= 0) this.runWaterfalls(true);
    if (party.inHorse >= 0) {
      party.horses[party.inHorse]!.loc = { ...party.townLoc };
      party.horses[party.inHorse]!.whichTown = party.townNum;
    }
    return true;
  }

  /**
   * The boat/horse block of town_move_party (boe.actions.cpp:4159-4232):
   * leaving the boat on dry land, refusing a diagonal move, the "go under or
   * land" bridge prompt, and boarding a boat or horse waiting on the
   * destination square. Runs after check_special_terrain, same as the C++.
   */
  private async townVehicleStep(destination: Location): Promise<'continue' | 'forced' | 'boarded' | 'blocked'> {
    const { party } = this.univ;
    const town = this.univ.town!;
    let forced = false;
    if (party.inBoat >= 0) {
      const ter = town.record.terrain[destination.x]![destination.y]!;
      const terType = this.univ.terrainType(ter);
      const diagonal = destination.x !== party.townLoc.x && destination.y !== party.townLoc.y;
      if (
        !this.townIsBlocked(destination) && !this.blocksMonsters(destination)
        && (!terType.boatOver || diagonal)
      ) {
        this.univ.addStringToBuf('You leave the boat.');
        party.inBoat = -1;
      } else if (diagonal) {
        this.univ.addStringToBuf("Move: Boat can't move diagonally.");
        return 'blocked';
      } else if (!this.townIsBlocked(destination) && terType.boatOver && terType.special === TerSpec.BRIDGE) {
        if ((await this.onConfirmBoatBridge?.()) ?? false) {
          forced = true;
        } else if (!this.townIsBlocked(destination)) {
          this.univ.addStringToBuf('You leave the boat.');
          party.inBoat = -1;
        }
      } else if (this.townVehicleAt(party.boats, destination)) {
        this.univ.addStringToBuf('  Boat there already.');
        return 'blocked';
      } else if (terType.boatOver) {
        forced = true;
      }
    }

    party.direction = setDirection(party.townLoc, destination);

    const boardBoat = party.inBoat < 0 && party.inHorse < 0
      ? this.townVehicleAt(party.boats, destination) : null;
    if (boardBoat) {
      if (boardBoat.property) {
        this.univ.addStringToBuf('  Not your boat.');
        return 'blocked';
      }
      this.univ.addStringToBuf('Move: You board the boat.');
      party.inBoat = party.boats.indexOf(boardBoat);
      party.townLoc = destination;
      this.center = { ...party.townLoc };
      return 'boarded';
    }
    const boardHorse = party.inBoat < 0 && party.inHorse < 0
      ? this.townVehicleAt(party.horses, destination) : null;
    if (boardHorse) {
      if (boardHorse.property) {
        this.univ.addStringToBuf('  Not your horses.');
        return 'blocked';
      }
      this.univ.addStringToBuf('Move: You mount the horses.');
      this.sound?.play(84);
      party.inHorse = party.horses.indexOf(boardHorse);
      party.townLoc = destination;
      this.center = { ...party.townLoc };
      return 'boarded';
    }
    return forced ? 'forced' : 'continue';
  }

  /**
   * The Rest command (handle_rest). Returns false with a reason in the
   * transcript when the party can't.
   */
  async rest(): Promise<boolean> {
    this.recorder?.record('handle_rest');
    // The C++ only ever reaches handle_rest from MODE_OUTDOORS — both the
    // **r** key (boe.actions.cpp:3080) and the CAMP button (:1637) test the
    // mode first — and the command reads the *outdoor* map for its terrain, so
    // there is nothing sensible for it to do in town.
    if (!this.isOutdoors) return false;
    return handleRest(this);
  }

  // -------------------------------------------------------------------- use

  /**
   * handle_use_space (boe.actions.cpp:946) — the click that follows the **U**
   * button. Three lines in the C++ and every one of them matters:
   *
   * - the adjacency refusal is **here**, not in `use_space`, and it says
   *   "Must be adjacent." (this port used to say "That is too far away."
   *   from inside `use_space`, which is a message the C++ never prints);
   * - **the mode goes back to TOWN on every path**, refusal included, because
   *   the C++ sets it after the branch rather than inside it. Leaving
   *   `MODE_USE_TOWN` armed made the *next* `handle_use_space_select` read as
   *   a cancel, and the game and the recording then disagreed about which
   *   button was pressed for the rest of the run;
   * - `did_something` is `use_space`'s return, and `handle_action` spends it on
   *   `handle_monster_actions` (boe.actions.cpp:1921) — so a use that did
   *   something **costs a turn**. Without that this port's clock ran a tick
   *   behind the C++'s from the first cleared web onwards, which is invisible
   *   in the draw stream until a creature eight squares away notices the party
   *   on one side and not the other.
   */
  async handleUseSpace(where: Location): Promise<boolean> {
    this.recorder?.recordLoc('handle_use_space', where);
    // `adjacent` (boe.locutils.cpp:82) is Chebyshev and counts the square you
    // are standing on, and it is measured from the **party**, in every mode.
    const from = this.univ.party.townLoc;
    let did = false;
    if (Math.max(Math.abs(from.x - where.x), Math.abs(from.y - where.y)) > 1) {
      this.univ.addStringToBuf('  Must be adjacent.');
    } else {
      did = await this.useSpace(where);
    }
    this.mode = GameMode.TOWN;
    if (did) await this.afterPartyTurn();
    return did;
  }

  /**
   * use_space (boe.specials.cpp:1217) — the Use action on an adjacent square.
   * A "change when used" terrain flips to its counterpart; a "call special when
   * used" one runs a chain. Returns false when there's nothing to use, which is
   * what decides whether the turn is charged.
   */
  async useSpace(where: Location): Promise<boolean> {
    const from = this.inTown ? this.univ.party.townLoc : this.univ.party.outLoc;
    const ter = this.inTown
      ? this.univ.town?.record.terrain[where.x]?.[where.y]
      : this.univ.out.at(where.x, where.y);
    if (ter === undefined) return false;
    const info = this.univ.terrainType(ter);
    const town = this.univ.town;
    this.univ.addStringToBuf('Use...');

    // Webs and pushable objects come before the terrain checks: they're what's
    // *in* the space rather than the space itself (boe.specials.cpp:1220).
    if (town) {
      if (town.hasField(where.x, where.y, FieldType.FIELD_WEB)) {
        this.univ.addStringToBuf('  You clear the webs.');
        town.setField(where.x, where.y, FieldType.FIELD_WEB, false);
        return true;
      }
      // **A successful push does not end `use_space`** (boe.specials.cpp:1231
      // to :1268). The three tests are consecutive `if`s, not an `else if`
      // chain and not an early return: a square carrying both a crate and a
      // barrel pushes both, and either way the function falls through to the
      // terrain checks below. So pushing something and finding nothing else on
      // the square prints "Nothing to use." after "You push the crate." and
      // returns **false** — which means a push costs no turn. It reads like an
      // oversight; it is what ships, and `did_something` depends on it.
      // Only the *refused* push returns early.
      const pushables: [FieldType, string][] = [
        [FieldType.OBJECT_CRATE, 'crate'],
        [FieldType.OBJECT_BARREL, 'barrel'],
        [FieldType.OBJECT_BLOCK, 'block'],
      ];
      for (const [field, name] of pushables) {
        if (!town.hasField(where.x, where.y, field)) continue;
        const to = this.pushLoc(from, where);
        if (to.x === from.x && to.y === from.y) {
          this.univ.addStringToBuf(`  Can't push ${name}.`);
          return false;
        }
        this.univ.addStringToBuf(`  You push the ${name}.`);
        town.setField(where.x, where.y, field, false);
        // x 0 is push_loc's "it fell in the water" sentinel: the thing is gone.
        if (to.x !== 0) town.setField(to.x, to.y, field, true);
        // Whatever was inside a crate or barrel travels with it.
        if (field !== FieldType.OBJECT_BLOCK)
          for (const item of town.items)
            if (item.variety !== ItemType.NO_ITEM && item.contained && item.held
              && item.itemLoc.x === where.x && item.itemLoc.y === where.y)
              item.itemLoc = { ...to };
      }
    }

    if (info.special === TerSpec.CHANGE_WHEN_USED) {
      if (where.x === from.x && where.y === from.y) {
        this.univ.addStringToBuf('  Not while on space.');
        return false;
      }
      this.univ.addStringToBuf('  OK.');
      alterSpace(this.univ, where.x, where.y, info.flag1);
      if (info.flag2 >= 0) this.sound?.play(info.flag2);
      return true;
    }
    if (info.special === TerSpec.CALL_SPECIAL_WHEN_USED) {
      // flag2 picks which node list flag1 indexes: 1 means the local one.
      const type = info.flag2 === 1
        ? (this.inTown ? SpecCtxType.TOWN : SpecCtxType.OUTDOOR)
        : SpecCtxType.SCEN;
      await this.runSpecial(SpecCtx.USE_SPACE, type, info.flag1, where);
      return true;
    }
    this.univ.addStringToBuf('  Nothing to use.');
    return false;
  }

  /**
   * push_loc (boe.locutils.cpp:547) — where a pushed object ends up: one more
   * step along the push, unless something's in the way, in which case it swaps
   * places with the pusher. An object pushed into water or a pit is destroyed,
   * which the original signals by returning x = 0.
   */
  private pushLoc(from: Location, to: Location): Location {
    const target = loc(to.x + (to.x - from.x), to.y + (to.y - from.y));
    const town = this.univ.town;
    if (!town || !town.isOnMap(target.x, target.y)) return { ...from };
    const ter = town.record.terrain[target.x]![target.y]!;
    const info = this.univ.terrainType(ter);
    // Terrain 90 is the pit; boat_over means water.
    if (ter === 90 || info.boatOver) return loc(0, target.y);
    if (this.sightObscurity(target.x, target.y) > 0) return { ...from };
    if (info.blockage !== TerObstruct.CLEAR) return { ...from };
    if (this.locOffActiveArea(target)) return { ...from };
    if (town.monsterAt(target)) return { ...from };
    return target;
  }

  // ------------------------------------------------------------------- look

  /**
   * do_look (boe.text.cpp:695) — describe a space into the transcript and
   * return its terrain, or -1 when the party can't see it.
   *
   */
  lookAt(where: Location): number {
    // The C++ records this one as an info map, not a bare value
    // (boe.actions.cpp:682) — so a recording made here reads there. This port
    // has no quick-look modifier, hence the two constant fields.
    this.recorder?.record('handle_look', {
      destination: locationText(where), right_button: 'false', mods: '0',
    });
    const { univ } = this;
    const town = univ.town;
    // handle_look draws its line from the acting PC in MODE_LOOK_COMBAT and
    // from the party's own square otherwise (boe.actions.cpp:693).
    const from = isCombat(this.mode) ? univ.currentPc.combatPos
      : this.inTown ? univ.party.townLoc : univ.party.outLoc;
    const isLit = !town || this.ptInLight(from, where);
    const onMap = town ? town.isOnMap(where.x, where.y) : univ.out.isOnMap(where.x, where.y);
    if (!onMap) {
      univ.addStringToBuf('  Can\'t see space.');
      return -1;
    }
    if (this.canSeeLight(from, where) >= SIGHT_BLOCKED) {
      univ.addStringToBuf('  Can\'t see space.');
      return -1;
    }

    univ.addStringToBuf('You see...');
    const inFight = isCombat(this.mode);
    // Out of combat the party is one square; in combat it is six figures,
    // each named if lit and in the acting PC's sight (boe.text.cpp:703).
    if (!inFight && where.x === from.x && where.y === from.y) univ.addStringToBuf('    Your party');
    if (inFight) {
      for (const pc of univ.party.pcs) {
        if (pc.mainStatus !== MainStatus.ALIVE || !locsEqual(pc.combatPos, where)) continue;
        if (isLit && this.canSeeLight(from, where) < 5) univ.addStringToBuf(`    ${pc.name}`);
      }
    }

    if (town) {
      for (const monst of town.monsters) {
        if (!monst.isAlive || !isLit || monst.pictureNum === 0) continue;
        if (
          where.x < monst.curLoc.x || where.x >= monst.curLoc.x + monst.xWidth ||
          where.y < monst.curLoc.y || where.y >= monst.curLoc.y + monst.yWidth
        )
          continue;
        const name = univ.scenario.scenMonsters[monst.number]?.name ?? 'creature';
        const wounded = monst.health < monst.maxHealth ? 'Wounded ' : '';
        univ.addStringToBuf(`    ${wounded}${name}${monst.isFriendly ? ' (F)' : ' (H)'}`);
      }
      if (town.isRoad(where.x, where.y)) univ.addStringToBuf('    Track');
      if (this.townVehicleAt(univ.party.boats, where)) univ.addStringToBuf('    Boat');
      if (this.townVehicleAt(univ.party.horses, where)) univ.addStringToBuf('    Horse');
      // Fields and decals, in `do_look`'s order (boe.text.cpp:760). The two
      // barriers share a name, and so do the three bloodstains and two slimes.
      for (const [field, name] of LOOK_FIELD_NAMES) {
        if (town.hasField(where.x, where.y, field)) univ.addStringToBuf(`    ${name}`);
      }

      // Items: gold and food are lumped together, and a big pile is summarised.
      let gold = false;
      let food = false;
      let count = 0;
      for (const item of town.items) {
        if (item.variety === ItemType.NO_ITEM) continue;
        if (item.itemLoc.x !== where.x || item.itemLoc.y !== where.y || !isLit) continue;
        if (item.variety === ItemType.GOLD) gold = true;
        else if (item.variety === ItemType.FOOD) food = true;
        else count++;
      }
      if (gold) univ.addStringToBuf('    Gold');
      if (food) univ.addStringToBuf('    Food');
      if (count > 8) univ.addStringToBuf('    Many items');
      else
        for (const item of town.items) {
          if (item.variety === ItemType.NO_ITEM) continue;
          if (item.variety === ItemType.GOLD || item.variety === ItemType.FOOD) continue;
          if (item.itemLoc.x !== where.x || item.itemLoc.y !== where.y || item.contained) continue;
          univ.addStringToBuf(`    ${item.ident ? item.fullName : item.name}`);
        }
      if (town.specialSpots[where.x]?.[where.y]) univ.addStringToBuf('    Special Encounter');
    } else {
      // A wandering group on the square is named by its first monster.
      for (const group of univ.party.outC) {
        if (!group.exists || !locsEqual(group.mLoc, where)) continue;
        const first = group.whatMonst.monst.find((m) => m !== 0);
        if (first !== undefined) {
          univ.addStringToBuf(`    ${univ.scenario.scenMonsters[first]?.name ?? 'creature'}`);
        }
      }
      if (univ.out.isRoad(where.x, where.y)) univ.addStringToBuf('    Road');
      if (this.outVehicleAt(univ.party.boats, where)) univ.addStringToBuf('    Boat');
      if (this.outVehicleAt(univ.party.horses, where)) univ.addStringToBuf('    Horse');
      if (univ.out.isSpot(where.x, where.y)) univ.addStringToBuf('    Special Encounter');
    }

    // `adj_town_look` is the *caller's* job in the C++ (boe.actions.cpp:700),
    // and only in town or combat. Outdoors it has a standing TODO saying an
    // OUT_LOOK special ought to fire here; this port fires one, which is the
    // one thing here the original doesn't do.
    if (!town && dist(from, where) <= 1) {
      const special = this.specialAt(where);
      if (special >= 0)
        void this.runSpecial(SpecCtx.OUT_LOOK, SpecCtxType.OUTDOOR, special, where);
    }

    if (!isLit) {
      univ.addStringToBuf('    Dark');
      return 0;
    }
    const ter = town ? town.record.terrain[where.x]![where.y]! : univ.out.at(where.x, where.y);
    univ.addStringToBuf(`    ${univ.terrainType(ter).name}`);
    return ter;
  }

  /** `is_container` (boe.locutils.cpp:220); the port lives in `game/loot.ts`. */
  isContainer(where: Location): boolean {
    return isContainerAt(this.univ, where);
  }

  /**
   * `adj_town_look` (boe.specials.cpp:1292) — the *search* half of looking at
   * an adjacent square, which the caller runs after `do_look` has described it.
   * Searching a square with a special on it runs the special; searching a
   * container opens it.
   *
   * Returns the container's contents for the host to put in a get-items
   * dialog, or null when there is nothing to open. That split is the same one
   * training and the job board use: the rules here, the dialog in `main.ts`.
   *
   * Note the C++'s own return value is **always false** — the `need_redraw` it
   * feeds is never set by this function.
   */
  async adjTownLook(where: Location): Promise<Item[] | null> {
    const { univ } = this;
    const town = univ.town;
    if (!town) return null;

    // What is *inside* the square, as opposed to lying on it. `do_look` has
    // already listed everything that isn't contained.
    const itemThere = town.items.some((item) => item.variety !== ItemType.NO_ITEM
      && item.contained && item.itemLoc.x === where.x && item.itemLoc.y === where.y);

    let canOpen = true;
    let gotSpecial = false;
    const ter = town.isOnMap(where.x, where.y) ? town.record.terrain[where.x]![where.y]! : 0;

    if (this.specialAt(where) >= 0) {
      // Adjacency is measured from the party's square even in combat, which is
      // what the C++ passes. This branch is dead in play — `handle_look` only
      // calls adj_town_look for an adjacent square — and note that it skips
      // the *special* without touching `canOpen`, so a distant container would
      // still open. Kept as written.
      if (dist(univ.party.townLoc, where) > 1) {
        univ.addStringToBuf('  Not close enough to search.');
      } else {
        for (const spot of town.record.specialLocs) {
          if (spot.x !== where.x || spot.y !== where.y) continue;
          // A square you can't step into announces the find, since there is no
          // walking onto it to discover the same thing.
          if (this.getBlockage(ter) > 0)
            univ.addStringToBuf('  Search: You find something!');
          const { blocked } = await this.runSpecial(
            SpecCtx.TOWN_LOOK, SpecCtxType.TOWN, spot.spec, where);
          if (blocked) canOpen = false;
          gotSpecial = true;
        }
      }
    }

    if (this.isContainer(where) && itemThere && canOpen) {
      // get_item(where, 6, true): everything contained *on that square*.
      return town.items.filter((item) => item.variety !== ItemType.NO_ITEM
        && item.contained && item.itemLoc.x === where.x && item.itemLoc.y === where.y);
    }
    const spec = univ.terrainType(ter).special;
    if (spec === TerSpec.CHANGE_WHEN_USED || spec === TerSpec.CALL_SPECIAL_WHEN_USED)
      univ.addStringToBuf('  (Use this space to do something with it.)');
    else if (!gotSpecial)
      univ.addStringToBuf("  Search: You don't find anything.");
    return null;
  }

  /**
   * The sign text at a space, or null when there is no readable sign there.
   * Signs must be adjacent to read (boe.actions.cpp:706).
   */
  signAt(where: Location): string | null {
    const ter = this.inTown
      ? this.univ.town?.record.terrain[where.x]?.[where.y]
      : this.univ.out.at(where.x, where.y);
    if (ter === undefined) return null;
    if (this.univ.terrainType(ter).special !== TerSpec.IS_A_SIGN) return null;

    const from = this.inTown ? this.univ.party.townLoc : this.univ.party.locInSec;
    const local = this.inTown ? where : this.univ.party.globalToLocal(where);
    const signs = this.inTown
      ? (this.univ.town?.record.signLocs ?? [])
      : this.univ.out.sectorAt(where).signLocs;
    for (const sign of signs) {
      if (sign.x !== local.x || sign.y !== local.y) continue;
      if (Math.max(Math.abs(sign.x - from.x), Math.abs(sign.y - from.y)) > 1) {
        this.univ.addStringToBuf('  Too far away to read sign.');
        return null;
      }
      return sign.text;
    }
    return null;
  }

  // ------------------------------------------------------------------ items

  /**
   * The items a "get" at `place` can reach — get_item (boe.items.cpp:258).
   * Adjacent items are always in reach; anything further (up to 4 spaces, in
   * sight) only if no hostile creature is watching.
   *
   * **In an arena fight the four-space limit is lifted entirely** — the C++'s
   * `(dist(...) <= 4) || (is_combat() && which_combat_type == 0)`
   * (boe.items.cpp:272), where `which_combat_type == 0` is *outdoor* combat.
   * Line of sight is still required, so what it really says is "in an outdoor
   * fight you can sweep up everything you can see", which is how a party
   * collects a beaten encounter's dropped packs from across the arena. This
   * port had only the distance half, so a recording's `item9-key` named a row
   * that was not on this side's screen at all.
   *
   * `massGet` comes back with them because it is also what titles the dialog:
   * `display_item` says "Getting all **nearby** items:" when the sweep is on
   * and "all adjacent items:" when a hostile creature has narrowed it.
   */
  reachableItems(place: Location): { items: Item[]; massGet: boolean } {
    // **`univ.town` outdoors is the town the party last left, not nothing.**
    // The C++ never unloads it — `end_town_mode` only sets `town_num` to 200 —
    // so `get_item` outdoors sweeps whatever was last loaded. That is normally
    // harmless, because the square it sweeps is `combat_pos` and every ordinary
    // way out of a fight sets that to (-1,-1); after a **rout** it is a real
    // square in the arena the party ran from, and pressing **g** on the world
    // map rummages the fight. See `Universe.departedTown`.
    const town = this.univ.town ?? this.univ.departedTown;
    if (!town) return { items: [], massGet: false };
    let massGet = true;
    for (const monst of town.monsters)
      if (
        monst.isAlive &&
        !monst.isFriendly &&
        this.canSeeLight(place, monst.curLoc) < SIGHT_BLOCKED
      )
        massGet = false;

    const found: Item[] = [];
    for (const item of town.items) {
      if (item.variety === ItemType.NO_ITEM || item.contained) continue;
      const adjacent =
        Math.max(Math.abs(place.x - item.itemLoc.x), Math.abs(place.y - item.itemLoc.y)) <= 1;
      const nearby =
        massGet &&
        (dist(place, item.itemLoc) <= 4
          || (isCombat(this.mode) && this.whichCombatType === 0)) &&
        this.canSeeLight(place, item.itemLoc) < SIGHT_BLOCKED;
      if (!adjacent && !nearby) continue;
      // Worthless items identify themselves when you pick them up.
      if (item.value < 2) item.ident = true;
      found.push(item);
    }
    return { items: found, massGet };
  }

  /**
   * Give a floor item to a PC and remove it from the town. Returns what should
   * be printed; an empty string means nothing happened.
   */
  takeItem(item: Item, pcNum: number): string {
    // `departedTown` for the same reason `reachableItems` needs it: outdoors
    // the C++ is still holding the town it last loaded, and after a rout the
    // pile being rummaged is a real one in the arena the party ran from. Taking
    // from it has to blank the entry there too, or the same four items are
    // still on the floor next time and `get_item` answers 1 where the C++
    // answers 0 — which is a turn charged on one side and not the other.
    const town = this.univ.town ?? this.univ.departedTown;
    if (!town) return '';
    const pc = this.univ.party.pcs[pcNum];
    if (!pc) return '';
    const result = giveItem(pc, this.univ.party, item);
    if (result.status !== GiveStatus.OK) {
      this.univ.addStringToBuf(`  ${result.message}`);
      // get_item (boe.items.cpp:501): an overweight pickup gets its own cue,
      // the same one a failed lockpick uses.
      if (result.status === GiveStatus.TOO_HEAVY) this.sound?.play(Snd.TOO_HEAVY);
      return result.message;
    }
    // **The slot is blanked, not removed** (`*item_array[item_hit] = cItem()`,
    // boe.items.cpp:516). `cTown::items` is a vector with holes: `place_item`
    // fills the *first* hole, so an item dropped after a pickup lands where the
    // taken one was. Splicing the entry out instead shifted every later item
    // down, and the get-items screen builds its rows from that order — so from
    // the first pickup onwards a recording's `item3-key` named a different
    // object on each side.
    const index = town.items.indexOf(item);
    if (index >= 0) town.items[index] = defaultItem();
    // Remember that a preset item has been taken, so it doesn't come back.
    if (item.isSpecial > 0) town.record.itemTaken[item.isSpecial - 1] = true;
    this.univ.addStringToBuf(result.message);
    // get_item (boe.items.cpp:486-508): gold and food each get their own
    // sound, everything else the generic pickup cue.
    if (item.variety === ItemType.GOLD) this.sound?.play(Snd.GOT_GOLD);
    else if (item.variety === ItemType.FOOD) this.sound?.play(Snd.GOT_FOOD);
    else this.sound?.play(Snd.GOT_ITEM);
    return result.message;
  }

  /**
   * `get_item`'s tail (boe.items.cpp:283) — once the get-items screen closes
   * having seen a theft, anyone friendly who could see **the party's square**
   * turns the whole town on them.
   *
   * Two things about it that this port had wrong. It ran per item taken, from
   * the *item's* square rather than `place`; and it fired on `property` alone,
   * where the C++ fires on the screen's result — which is only set when the
   * player answers "steal", so declining the prompt is not a crime.
   */
  reportTheft(place: Location): void {
    const town = this.univ.town;
    if (!town) return;
    for (const monst of town.monsters) {
      if (!monst.isAlive || !monst.isFriendly) continue;
      if (this.canSeeLight(place, monst.curLoc) >= SIGHT_BLOCKED) continue;
      makeTownHostile(this);
      this.univ.addStringToBuf('Your crime was seen!');
      break;
    }
  }

  // Giving and dropping live in `game/giveDrop.ts` — they are `give_thing` and
  // `drop_item`, and the two-part shape of a drop (arm the item, then click the
  // square) is a mode change rather than a method on the session. What used to
  // be here were inventions: a drop that always landed on the party's own
  // square and a give that offered anyone alive.

  /**
   * `equip_item` (boe.items.cpp:95) — the free function behind the E button,
   * which toggles.
   *
   * **Two refusals live here rather than in `cPlayer::equip_item`**, and this
   * port had neither: food can't be equipped in combat, and neither can armour.
   * They matter beyond the message — a recording that clicks armour during a
   * fight leaves it unequipped in the C++ and equipped here, and the equipped
   * set decides what `load_missile` and `has_type_equip` find later.
   *
   * Note the order: the *unequip* branch is tested before the armour refusal,
   * so taking armour off mid-fight is allowed and putting it back on is not.
   */
  toggleEquip(pcNum: number, slot: number): void {
    const pc = this.univ.party.pcs[pcNum];
    if (!pc) return;
    const item = pc.items[slot];
    if (!item || item.variety === ItemType.NO_ITEM) return;
    // `overall_mode == MODE_COMBAT` here, not `is_combat()` — the narrower
    // test, so the refusal does not fire while a target is being picked.
    if (this.mode === GameMode.COMBAT && item.variety === ItemType.FOOD) {
      this.univ.addStringToBuf('Equip: Not in combat');
      return;
    }
    if (pc.equip[slot]) {
      this.univ.addStringToBuf(unequipItem(pc, slot).message);
      return;
    }
    if (isCombat(this.mode) && item.variety === ItemType.ARMOR) {
      this.univ.addStringToBuf('Equip: Not armor in combat');
      return;
    }
    this.univ.addStringToBuf(equipItem(pc, slot).message);
  }

  // ------------------------------------------------------- special terrain

  /**
   * The specials interpreter. The host installs it (with its dialog hooks) via
   * `attachSpecials`; without one the game runs with scripting inert, which is
   * what the headless tests that don't care about specials do.
   */
  specials: SpecialsEngine | null = null;

  /**
   * The same host, reachable by the item actions.
   *
   * The C++ has no seam here at all — a dialog is a dialog, and `give_thing`
   * puts one up exactly as a special node does. Keeping the host only inside
   * the specials engine meant the driver ran `use_item` with no dialogs
   * attached, so an item that asks who to heal silently healed nobody.
   */
  host: SpecialHost | null = null;

  attachSpecials(host: SpecialHost): void {
    this.host = host;
    this.specials = new SpecialsEngine(this.univ, host, this);
  }

  /**
   * Run a special chain and apply what it decided. Returns `blocked` so
   * movement can cancel the step, matching run_special's `a` return.
   */
  async runSpecial(
    mode: SpecCtx, type: SpecCtxType, node: number, where: Location,
    seedTarget: number | null = null,
  ): Promise<{ blocked: boolean; forced: boolean }> {
    if (!this.specials || node < 0) return { blocked: false, forced: false };
    const result = await this.specials.run(mode, type, node, where, seedTarget);
    if (result.redraw) this.onRedraw?.();
    // Every C++ path that runs a chain returns through `handle_action`, whose
    // tail is `advance_time` — so a node that ends the scenario is acted on as
    // soon as its chain finishes, whether the player got there by walking, by
    // talking, or by using something. This port only reaches `advance_time`'s
    // other callers on a *move*, so the check goes here too.
    this.checkGameOver();
    return { blocked: result.a > 0, forced: result.b > 0 };
  }

  /** The same, but handing back the raw return slots (TALK uses them for strings). */
  /**
   * `cast_spell_on_space` (boe.party.cpp:1473) — **the square gets a say in
   * whether a spell cast on it does anything.**
   *
   * A town special whose node is an `IF_CONTEXT` runs in the `TARGET` context
   * when a spell lands on its square, and a non-zero `s1` cancels the spell's
   * ordinary behaviour. The `IF_CONTEXT` test is the C++'s and it carries its
   * own doubt beside it — "is there a way to skip this condition without
   * breaking compatibility?" — because the node type is what keeps every
   * *other* kind of square special from firing at a spell.
   *
   * Returns whether the spell should carry on.
   */
  async castSpellOnSpace(where: Location, spell: Spell): Promise<boolean> {
    const town = this.univ.town;
    if (!town) return true;
    for (const spot of town.record.specialLocs) {
      if (spot.x !== where.x || spot.y !== where.y) continue;
      if (town.record.specials.get(spot.spec)?.type !== SpecType.IF_CONTEXT) return true;
      const r = await this.runSpecialRaw(SpecCtx.TARGET, SpecCtxType.TOWN, spot.spec, where);
      // The C++'s `s1` starts at **0** and the chain may never touch it; this
      // port's `retA` starts at -1 for the same "nobody said" case, so both
      // mean "carry on". Only a positive answer intercepts.
      return r.a <= 0;
    }
    // Ritual of Sanctification is the one spell that says so when the square
    // it was aimed at had nothing on it.
    if (spell === Spell.RITUAL_SANCTIFY) this.univ.addStringToBuf('  Nothing happens.');
    return true;
  }

  /**
   * `spec_target_type` / `spec_target_fail` (boe.specials.cpp:4311) — where a
   * `TOWN_START_TARGETING` node came from, and which node to run when the
   * targeting is refused or intercepted.
   *
   * Set by `TOWN_START_TARGETING` (boe.specials.cpp:4311) and read by the two
   * casts when a target is refused or intercepted.
   */
  specTargetType: SpecCtxType = SpecCtxType.SCEN;
  specTargetFail = -1;

  /**
   * `spec_target_options` — **units** are "may target an obstructed square",
   * **tens** are the antimagic rule: 1 refuses an antimagic square in town, 2
   * is the combat arm's `allow_antimagic = false`, which is what it already
   * was, so that half of the C++ does nothing at all. Kept as written.
   */
  specTargetOptions = 0;

  async runSpecialRaw(
    mode: SpecCtx, type: SpecCtxType, node: number, where: Location,
  ): Promise<{ a: number; b: number }> {
    if (!this.specials || node < 0) return { a: -1, b: -1 };
    const result = await this.specials.run(mode, type, node, where);
    if (result.redraw) this.onRedraw?.();
    this.checkGameOver();
    return { a: result.a, b: result.b };
  }

  /**
   * screen_shift (boe.actions.cpp:1465) — slide the view without moving the
   * party, so a spell or a shot can reach past the edge of what's on screen.
   *
   * **It is three lines and none of them is a bound**: refuse a zero delta,
   * then `center.x += dx; center.y += dy`. The view is allowed to run clean
   * off the map, and `can_draw` paints the squares that aren't there black.
   * This port used to clamp to the town's rect and to the 9×9 view's half
   * width, which is tidier and wrong in a way that compounds: `center` is what
   * `handle_terrain_screen_actions` builds every move destination from, so a
   * shift the C++ took and this port refused left the two disagreeing about
   * where a click landed for the rest of the recording. The return value is
   * this port's own, for the browser's "did anything move?" redraw.
   */
  screenShift(dx: number, dy: number): boolean {
    if (dx === 0 && dy === 0) return false;
    this.center.x += dx;
    this.center.y += dy;
    return true;
  }

  /** Set by the host so a special that changes the world can repaint. */
  /**
   * `current_working_monster` (boe.main.cpp:183) — **0-5 for a PC, 100+i for a
   * creature, -1 for nobody**, and the thing `draw_terrain(2)` returns at
   * before it draws (boe.graphics.cpp:842). Every mode-2 redraw is therefore
   * free or not depending on who is *acting*, which is why the flag has to
   * exist here at all: `damage_monst`'s "no damage" redraw runs from a PC's
   * swing (a die) and from a blade wall in `process_fields` (not one), and
   * nothing else in the call tells them apart.
   *
   * Set and cleared in pairs at exactly the C++'s sites; `combat_posing_monster`
   * moves with it there and is purely cosmetic, so it is not modelled.
   */
  workingMonster = -1;
  /**
   * The status bar's right-hand hint — "M: Recast Fireball" — as the last
   * `draw_text_bar` worked it out (`textBar.ts`). Empty outside combat.
   */
  recastHint = '';

  /**
   * `combat_posing_monster` (boe.main.cpp:183) — who is drawn in their **attack
   * sprite** this frame. Same encoding as `workingMonster`: 0-5 a PC,
   * 100 + slot a creature, -1 nobody.
   *
   * **The C++ assigns the two together at every one of its fifteen sites** —
   * `combat_posing_monster = current_working_monster = X` — and only
   * `TOWN_START_TARGETING`'s neighbour `TOWN_MONST_ATTACK` ever moves one
   * without the other. They are two fields here anyway, because this port sets
   * `workingMonster` at only the four sites where a redraw's *cost* depends on
   * it, and those placements are what the corpus proved. Widening it to the
   * C++'s full extent would change the draw stream on nothing but a guess;
   * widening the pose costs nothing, so the pose gets the real extent and the
   * discrepancy is written down rather than papered over.
   */
  posingMonster = -1;

  /**
   * `posted_labels` (boe.text.cpp:1179) — floating captions a
   * `TOWN_PLACE_LABEL` node has put on the map.
   *
   * **They last exactly one frame.** `draw_terrain` draws the list and then
   * clears it (boe.graphics.cpp:1069-1072), which is why the node redraws and
   * then sleeps: the caption is visible for the length of that sleep and gone
   * on the next repaint. Nothing persists them, so nothing saves them.
   *
   * The pixel rect is worked out at draw time rather than post time, because
   * measuring the string needs a canvas; `center` is carried along so the
   * arithmetic still uses the view the node saw, as `place_text_label` does.
   */
  postedLabels: PostedLabel[] = [];

  /**
   * `current_pat` (boe.combat.cpp:45) — the **resolved grid** the last
   * targeting settled on, rotation and all. `PAT_CURRENT` (-1) is how a
   * special node asks for it.
   *
   * The C++'s casts read this where this port reads the enum on
   * `spellTargeting` / `townTarget` plus `forceWallPosition`; the two are kept
   * in step by writing this at the same seven places the C++ writes it — the
   * three `start_*_targeting` tails, `spell_cast_hit_return`'s rotation, and
   * the four throw/fire arms. Nothing but the two `TOWN_SPELL_PAT_*` opcodes
   * reads it here, so it costs no draws.
   */
  currentPat: EffectPattern = getBuiltinPattern(SpellPat.SINGLE);

  onRedraw: (() => void) | null = null;

  /**
   * The monsters' half of a turn is `async` now — it waits on the animation
   * timeline where the C++ blocks, so the model advances at the same rate the
   * screen does (see `animSettle`). That would otherwise colour every caller
   * of `afterCombatAction` async, and several of them are free functions
   * (`combatCastSpell`, `doCombatCast`) whose own callers would follow.
   *
   * So the async part is *queued* rather than awaited: these methods stay
   * synchronous and chain the monster round here, one at a time and in order.
   * `busy` is the "the monsters are going" flag the input layer gates on —
   * the C++ gets that for free by blocking, and even flushes queued keys
   * (`flushingInput`, boe.combat.cpp:2432). `settled()` is how a test or the
   * host waits for the fight to catch up.
   */
  /**
   * `need_redraw` — the out-param `replay_action` declares and every handler
   * writes (boe.main.cpp:709). It is not cosmetic: `advance_time` ends with
   * `if(need_redraw) draw_terrain();` (boe.actions.cpp:1931) and *that* spends
   * an encumbrance roll through the status bar's recast hint. See `textBar.ts`.
   *
   * It lives on the session rather than in the driver because
   * `handle_monster_actions` reads **and rewrites** it in combat, and that is
   * session code. The driver owns its lifetime: false at the start of every
   * top-level action, and the handlers set it.
   */
  needRedraw = false;

  private turnChain: Promise<void> = Promise.resolve();
  private turnsQueued = 0;

  /** True while a monster round is still playing out. `prime_time` is not. */
  get busy(): boolean {
    return this.turnsQueued > 0;
  }

  /**
   * `monsters_going` (boe.main.cpp:190) — set for exactly the span of
   * `do_monster_turn` and read by the *drawing* code, which is why it is here
   * rather than local to that function. It is not the same thing as `busy`:
   * `busy` covers the whole queued round, including the bookkeeping either
   * side, whereas this is only the part where the view is following monsters
   * around instead of sitting on the party.
   *
   * Three things depend on it (boe.graphics.cpp:940, :692/:732, :1635, and
   * boe.graphutil.cpp:264):
   * - Terrain drawn while the camera is off on a monster **ignores the
   *   explored map**, so the monster isn't a sprite floating in blackness.
   * - The status bar names the monster that is going, rather than the PC whose
   *   turn it isn't.
   * - The active-PC ring and the pointing arrows are suppressed; both point at
   *   a PC who cannot act right now.
   */
  monstersGoing = false;

  /** Resolves once every queued monster round has finished. */
  settled(): Promise<void> {
    return this.turnChain;
  }

  private queueTurn(work: () => Promise<void>): void {
    this.turnsQueued++;
    this.turnChain = this.turnChain
      .then(work)
      // A throw must not poison the chain — every later turn would be skipped
      // silently and the fight would simply stop. Reported instead, which also
      // fails `verify-screen`'s console-error gate rather than hiding.
      .catch((err: unknown) => { console.error('monster turn failed', err); })
      .then(() => {
        this.turnsQueued--;
        if (this.turnsQueued === 0) this.onRedraw?.();
      });
  }

  /**
   * **`is_special(location)` (boe.locutils.cpp:412), which is not about
   * specials at all.** It asks one thing: is this square's terrain
   * `BLOCK_MONSTERS` — a counter, a rail, a bar? The name is a leftover from
   * the days when that blockage was called "special", and it is a trap: two
   * places in this port had translated it as "does a special node sit here?",
   * which is `specialAt`, a completely different question about a completely
   * different list.
   *
   * The two callers are `place_party` (boe.town.cpp:792), where it keeps PCs
   * from being dealt onto the shop counter at the start of a fight, and the
   * leave-the-boat branch of `town_move_party` (boe.actions.cpp:4162).
   */
  blocksMonsters(where: Location): boolean {
    const town = this.univ.town;
    const ter = town
      ? town.record.terrain[where.x]?.[where.y]
      : this.univ.out.at(where.x, where.y);
    if (ter === undefined) return false;
    return this.univ.terrainType(ter).blockage === TerObstruct.BLOCK_MONSTERS;
  }

  /**
   * The special node attached to a town square, if any (cTown::special_locs).
   */
  specialAt(where: Location): number {
    const town = this.univ.town;
    if (town) {
      if (!town.isSpecialSpot(where.x, where.y)) return -1;
      for (const loc of town.record.specialLocs)
        if (loc.x === where.x && loc.y === where.y) return loc.spec;
      return -1;
    }
    // Outdoors the list is in sector coordinates, and there's no flag gate.
    const local = this.univ.party.globalToLocal(where);
    for (const loc of this.univ.out.sectorAt(where).specialLocs)
      if (loc.x === local.x && loc.y === local.y) return loc.spec;
    return -1;
  }

  /**
   * check_special_terrain (boe.specials.cpp:152) — everything a square does to
   * the party that walks into it. `canEnter` false cancels the move; `forced`
   * is the special node's `b` return, which pushes the step through terrain
   * that would otherwise block.
   *
   * It runs **outdoors as well as in town** — the C++ calls it first thing in
   * `outd_move_party` (boe.actions.cpp:3950) with `eSpecCtx::OUT_MOVE`, which
   * is what makes a swamp poison you and a lava field burn you on the world
   * map. Only the terrain source and the special's context differ.
   *
   * **The square's own special node is run from in here**, not by the callers.
   * That is where the C++ runs it, and the order is load-bearing: the node goes
   * *before* the terrain switch, so a scripted square that also carries a
   * step-on door fires its chain on the same step that opens the door — and a
   * node that blocks the step stops the door opening at all. This port used to
   * run the node afterwards, from `town_move_party`, which meant the first
   * bump into such a door opened it silently and the *second* step raised the
   * message. In a replay that shows up as one extra dialog the recording never
   * saw; in play it is a message arriving a turn late.
   */
  private async checkSpecialTerrain(
    where: Location,
    /**
     * `which_pc` (boe.specials.cpp:152) — **whose** step this is, which is not
     * always `univ.cur_pc`. `check_fields` damages, curses and puts to sleep
     * exactly this PC, and the two callers that pass something else are the
     * ones that matter: a town or outdoor move passes `univ.party[0]`
     * (boe.actions.cpp:4190), and `pc_combat_move`'s swap branch passes the PC
     * who was *swapped into* the square being left (boe.combat.cpp:292). The
     * webs below are a separate rule and do read `univ.current_pc()`.
     */
    who: Player,
  ): Promise<{ canEnter: boolean; forced: boolean }> {
    // **The mode is the authority, not whether a town is loaded.**
    // `check_special_terrain` switches on `mode` for its terrain lookup
    // (boe.specials.cpp:166) and asks `is_out()` for the fields and webs
    // (:277) — never "is there a town object". The two coincide today because
    // this port clears `univ.town` on the way out of one, which the C++ never
    // does; asking the mode is what the C++ asks, and it is what keeps this
    // honest if that ever changes.
    const town = this.isOutdoors ? null : this.univ.town;
    const inCombatMove = isCombat(this.mode);
    let canEnter = true;
    let forced = false;
    const stop = { canEnter: false, forced: false };
    // from_loc: the square being left, which the conveyor and the pushables
    // both need — a crate is shoved on along the line the pusher was walking.
    const fromLoc = inCombatMove ? this.univ.currentPc.combatPos : this.univ.party.townLoc;

    const ter = town
      ? (town.isOnMap(where.x, where.y) ? town.record.terrain[where.x]![where.y]! : 0)
      : (this.univ.out.isOnMap(where.x, where.y) ? this.univ.out.at(where.x, where.y) : 0);
    const spec = this.univ.terrainType(ter);

    // A moving floor refuses to be walked against. `flag1` is the direction it
    // runs; the three headings that include it are the ones it blocks.
    // (The C++'s own TODO wonders why conveyors don't work outdoors; kept.)
    if (town && spec.special === TerSpec.CONVEYOR) {
      const dir = spec.flag1;
      if ((NO_MOVE_FROM_NORTH.has(dir) && where.y > fromLoc.y)
        || (NO_MOVE_FROM_EAST.has(dir) && where.x < fromLoc.x)
        || (NO_MOVE_FROM_SOUTH.has(dir) && where.y < fromLoc.y)
        || (NO_MOVE_FROM_WEST.has(dir) && where.x > fromLoc.x)) {
        this.univ.addStringToBuf('The moving floor prevents you.');
        return stop;
      }
    }

    // Outdoors the sector's own special list is consulted first of all, and
    // the chain is handed *sector-local* coordinates.
    if (!town) {
      const outSpec = this.specialAt(where);
      if (outSpec >= 0) {
        const r = await this.runSpecial(
          SpecCtx.OUT_MOVE, SpecCtxType.OUTDOOR, outSpec,
          this.univ.party.globalToLocal(where));
        if (r.blocked) canEnter = false;
        else if (r.forced) forced = true;
      }
    }

    // A marked encounter square can't be set off mid-fight. Note this is
    // `cCurTown::is_spot` — the **SPECIAL_SPOT field flag**, the glyph drawn on
    // the map — and *not* `is_special`, the scan of `special_locs` that
    // `specialAt` uses. They are easy to confuse and mean different things: one
    // scripted square in ten carries the marker. The `CITY` trim test beside it
    // is the C++'s own approximation of "this is town furniture", and it
    // carries its own TODO wondering about that; kept.
    if (isCombat(this.mode) && town
      && (town.hasField(where.x, where.y, FieldType.SPECIAL_SPOT)
        || this.univ.terrainType(
          town.isOnMap(where.x, where.y) ? town.record.terrain[where.x]![where.y]! : 0,
        ).trimType === TrimType.CITY)) {
      this.univ.addStringToBuf("Move: Can't trigger this special in combat.");
      return stop;
    }

    // Barriers stop the party before terrain is even consulted. They live on
    // the town's field grid, so there are none outdoors.
    if (town) {
      if (town.hasField(where.x, where.y, FieldType.BARRIER_FORCE)) {
        this.univ.addStringToBuf('  Magic barrier!');
        canEnter = false;
      }
      if (town.hasField(where.x, where.y, FieldType.BARRIER_CAGE)) {
        this.univ.addStringToBuf('  Force cage!');
        canEnter = false;
      }
    }

    // The square's own special node. A town fight only sets one off when it is
    // a *town* fight (`which_combat_type == 1`) — an arena has no town under it
    // to script.
    if ((this.mode === GameMode.TOWN || (inCombatMove && this.whichCombatType === 1))
      && canEnter && town) {
      // The C++'s loop condition, hoisted: "stop if the current town changes"
      // is `town_num == univ.party.town_num` (boe.specials.cpp:238) and
      // **nothing else**. See the note on the early return below.
      const townNumBefore = this.univ.party.townNum;
      const special = this.specialAt(where);
      if (special >= 0) {
        const blockedTer = this.townIsBlocked(where);
        const terType = this.univ.terrainType(
          town.isOnMap(where.x, where.y) ? town.record.terrain[where.x]![where.y]! : 0);
        // A CANT_ENTER node with ex2a set says "run me even on a blocked
        // square" — that's how a scenario explains a wall you can't pass.
        const node = town.record.specials.get(special);
        const forceAllowed = node?.type === SpecType.CANT_ENTER && node.ex2a > 0;
        const runIt = !blockedTer
          || terType.special === TerSpec.CHANGE_WHEN_STEP_ON
          || terType.special === TerSpec.CALL_SPECIAL
          || forceAllowed
          // A boat sailing over water still trips the square it sails onto.
          // The C++ gates this on `!univ.scenario.is_legacy`; this port reads
          // only the XML format, where that flag is always false.
          || (this.univ.party.inBoat >= 0 && terType.boatOver);
        if (runIt) {
          const r = await this.runSpecial(
            SpecCtx.TOWN_MOVE, SpecCtxType.TOWN, special, where);
          if (r.blocked) canEnter = false;
          else if (r.forced) forced = true;
          // The chain may have moved the party to another town, in which case
          // there is nothing left on *this* town's list to look at — the C++'s
          // loop condition is `town_num == univ.party.town_num`
          // (boe.specials.cpp:238). **What it does not do is forget what the
          // node just said.** This port used to return `canEnter: true` here,
          // which turned a door-to-another-town node — the node blocks the
          // step, having already moved you — into a move that *succeeded*, and
          // a successful move charges a turn. So every transition between two
          // towns cost a turn here and none in the C++, and every `age % n`
          // upkeep after it was one turn out.
          //
          // **The test is the town, not the mode.** This asked `!this.inTown`,
          // and `inTown` is false in combat — `MODE_COMBAT` sits outside
          // `is_town`'s range — so *every* combat step onto a scripted square
          // returned here and never reached the terrain switch below. A door
          // opened by walking into it therefore stayed shut for the whole
          // fight, which is a line of sight that differs and, in
          // `ASR_10-05-2025_17-55-45`, a Flame refused with "Can't see target"
          // while the C++ cast it.
          if (this.univ.party.townNum !== townNumBefore || this.univ.town !== town) {
            return { canEnter, forced };
          }
        }
      }
    }

    if (!canEnter) return stop;

    if (town) {
      if (!town.isOnMap(where.x, where.y)) return { canEnter: true, forced };
    } else if (!this.univ.out.isOnMap(where.x, where.y)) return { canEnter: true, forced };

    // Everything between the special node and the terrain switch: the fields
    // you walk into, the webs that catch you, and the things you shove.
    if (town) {
      await this.checkFields(where, inCombatMove, who);
      this.walkIntoWebs(where, inCombatMove);
      this.pushThings(fromLoc, where);
    }

    switch (spec.special) {
      case TerSpec.CHANGE_WHEN_STEP_ON: {
        // An unlocked door: walking into it swaps the terrain for flag1, and
        // if the old terrain blocked movement the party doesn't enter yet.
        //
        // **Through `alter_space`** (boe.specials.cpp:317), not by writing the
        // grid: `alter_space` also arms `belt_present` if the new terrain is a
        // conveyor and rebuilds the lighting map when the light radius changes
        // — a door opening onto a lit corridor is exactly the case that needs
        // the second one. Writing the array directly skipped both.
        alterSpace(this.univ, where.x, where.y, spec.flag1);
        if (spec.flag2 >= 0) this.sound?.play(spec.flag2);
        return { canEnter: !blocksMove(spec), forced };
      }
      case TerSpec.UNLOCKABLE:
        // A locked door: the caller has to ask the player what to do, which
        // needs a dialog, so it defers to the host via onLockedDoor.
        await this.onLockedDoor?.(where, ter);
        return stop;
      case TerSpec.CALL_SPECIAL: {
        // The terrain itself names a node; flag1 is which one and **flag2 says
        // which list it indexes** (boe.specials.cpp:465). The default is the
        // *scenario* list: only `flag2 == 1` means "the town or sector I'm
        // standing in". This port used to ignore flag2 and always take the
        // town/outdoor list, which is how Za-Khazi Run's mountain squares —
        // scenario node 1, a `CHANGE_TIME +30` that makes crossing rough
        // country cost four turns instead of one — went unspent here, leaving
        // the clock progressively behind the C++'s.
        //
        // The location handed over is the one `check_special_terrain` was
        // called with, i.e. the outdoor *window* square, not the sector-local
        // one the `special_locs` scan above uses. It reaches the chain as
        // reserved pointers 10/11/12.
        const callsTown = this.mode === GameMode.TOWN
          || (inCombatMove && this.whichCombatType === 1);
        const r = await this.runSpecial(
          inCombatMove ? SpecCtx.COMBAT_MOVE : (town ? SpecCtx.TOWN_MOVE : SpecCtx.OUT_MOVE),
          spec.flag2 === 1
            ? (callsTown ? SpecCtxType.TOWN : SpecCtxType.OUTDOOR)
            : SpecCtxType.SCEN,
          spec.flag1,
          where);
        // Only `a` is read here — the C++ ignores this node's `b`.
        if (r.blocked) return stop;
        return { canEnter: true, forced };
      }
      case TerSpec.DANGEROUS:
        this.dangerousTerrain(spec, where, inCombatMove, town !== null);
        return { canEnter: true, forced };
      case TerSpec.DAMAGING:
        // **Awaited.** `damagingTerrain` is async because `hitParty` waits on
        // each PC's blast animation, and this call site used to drop the
        // promise on the floor. The damage still happened and every draw was
        // still made — but the rest of the move ran *underneath* it, so the
        // turn's upkeep landed in the middle of the party's luck saves and the
        // draw stream came out interleaved:
        //
        //   C++   3d12, luck ×6,                    recuperation ×2
        //   here  3d12, luck ×2, recuperation ×2, luck ×3
        //
        // Nothing about the rules was wrong, and nothing in the game state
        // showed it. `get_ran`'s *call order* is part of the spec (PLAN.md §6),
        // and an unawaited promise is the one way this port can break it while
        // getting every individual answer right.
        await this.damagingTerrain(spec, where, inCombatMove, town !== null);
        return { canEnter: true, forced };
      case TerSpec.WILDERNESS_CAVE:
      case TerSpec.WILDERNESS_SURFACE:
        this.handleHunting();
        return { canEnter: true, forced };
      default:
        return { canEnter: true, forced };
    }
  }

  /**
   * check_fields (boe.specials.cpp:381) — walking *into* a field, as opposed
   * to standing in one (which is `process_fields`'s job). Out of combat the
   * walls only announce themselves: the C++ only damages on a COMBAT_MOVE,
   * because in town the party is about to be hit by `process_fields` anyway.
   */
  private async checkFields(
    where: Location, inCombatMove: boolean, who: Player,
  ): Promise<void> {
    // `if(is_out()) return;` (boe.specials.cpp:524), which the C++ asks a
    // second time here even though its one caller has already asked.
    if (this.isOutdoors) return;
    const town = this.univ.town;
    if (!town) return;
    const pc = who;
    const rng = this.univ.rng;
    const say = (line: string): void => this.univ.addStringToBuf(line);
    const hit = async (dam: number, type: DamageType): Promise<void> => {
      if (inCombatMove) await damagePc(this.univ, pc, dam, type, Race.UNKNOWN);
    };

    if (town.hasField(where.x, where.y, FieldType.WALL_FIRE)) {
      say('  Fire wall!');
      await hit(rng.getRan(1, 1, 6) + 1, DamageType.FIRE);
    }
    if (town.hasField(where.x, where.y, FieldType.WALL_FORCE)) {
      say('  Force wall!');
      await hit(rng.getRan(2, 1, 6), DamageType.MAGIC);
    }
    if (town.hasField(where.x, where.y, FieldType.WALL_ICE)) {
      say('  Ice wall!');
      const r1 = rng.getRan(2, 1, 6);
      await hit(r1, DamageType.COLD);
      // The C++ booms on the *party's* square, not the one stepped into, and
      // only outside combat. Kept.
      if (!isCombat(this.mode)) boomSpace(this.univ.party.townLoc, 4, r1, 7, this.univ.rng);
    }
    if (town.hasField(where.x, where.y, FieldType.WALL_BLADES)) {
      say('  Blade wall!');
      await hit(rng.getRan(4, 1, 8), DamageType.WEAPON);
    }
    if (town.hasField(where.x, where.y, FieldType.FIELD_QUICKFIRE)) {
      say('  Quickfire!');
      await hit(rng.getRan(2, 1, 8), DamageType.FIRE);
    }
    if (town.hasField(where.x, where.y, FieldType.CLOUD_STINK)) {
      say('  Stinking cloud!');
      pc.curse(rng.getRan(1, 2, 3));
    }
    if (town.hasField(where.x, where.y, FieldType.CLOUD_SLEEP)) {
      say('  Sleep cloud!');
      pc.sleep(Status.ASLEEP, 3, 0, rng);
    }
    if (town.hasField(where.x, where.y, FieldType.BARRIER_FIRE)) {
      say('  Magic barrier!');
      const r1 = rng.getRan(2, 1, 10);
      if (inCombatMove) await damagePc(this.univ, pc, r1, DamageType.MAGIC, Race.UNKNOWN);
      else await hitParty(this.univ, r1, DamageType.MAGIC);
    }
  }

  /**
   * The webs half of check_special_terrain (boe.specials.cpp:283). Walking
   * into a web catches you and *uses the web up*. Out of combat it webs the
   * whole party; in combat only the PC who walked in. Bugs walk through.
   */
  private walkIntoWebs(where: Location, inCombatMove: boolean): void {
    const town = this.univ.town;
    if (!town || !town.hasField(where.x, where.y, FieldType.FIELD_WEB)) return;
    // The race test reads the *current* PC even when the whole party is caught,
    // so out of combat it's PC 1's race that decides for everyone. Kept.
    if (this.univ.currentPc.race === Race.BUG) return;
    this.univ.addStringToBuf('  Webs!');
    if (!inCombatMove) {
      for (const pc of this.univ.party.pcs) pc.web(this.univ.rng.getRan(1, 2, 3));
    } else {
      this.univ.currentPc.web(this.univ.rng.getRan(1, 2, 3));
    }
    town.setField(where.x, where.y, FieldType.FIELD_WEB, false);
  }

  /**
   * The pushables half of check_special_terrain (boe.specials.cpp:290) plus
   * `push_thing` / `move_thing` (boe.town.cpp:1627) — walking into a crate,
   * barrel or stone block shoves it one square further along the same line.
   */
  pushThings(from: Location, where: Location): void {
    const town = this.univ.town;
    if (!town) return;
    const kinds: Array<[FieldType, string]> = [
      [FieldType.OBJECT_CRATE, '  You push the crate.'],
      [FieldType.OBJECT_BARREL, '  You push the barrel.'],
      [FieldType.OBJECT_BLOCK, '  You push the stone block.'],
    ];
    for (const [kind, message] of kinds) {
      if (!town.hasField(where.x, where.y, kind)) continue;
      this.univ.addStringToBuf(message);
      this.moveThing(kind, where, this.pushLoc(from, where));
    }
  }

  /** move_thing (boe.town.cpp:1630) — and the items inside a pushed container. */
  private moveThing(kind: FieldType, from: Location, to: Location): void {
    const town = this.univ.town!;
    town.setField(from.x, from.y, kind, false);
    if (to.x > 0) town.setField(to.x, to.y, kind, true);
    if (kind !== FieldType.OBJECT_CRATE && kind !== FieldType.OBJECT_BARREL) return;
    for (const item of town.items) {
      if (item.variety === ItemType.NO_ITEM || !item.contained || !item.held) continue;
      if (locsEqual(item.itemLoc, from)) item.itemLoc = { ...to };
    }
  }

  /**
   * "if the party is flying, in a boat, or entering a boat, they cannot be
   * harmed by terrain" — the four lines that open both the DAMAGING and the
   * DANGEROUS arms of `check_special_terrain` (boe.specials.cpp:326 and :393).
   *
   * **It comes before the damage roll**, so an immune party spends no draws at
   * all where a vulnerable one spends `get_ran(flag2,1,flag1)` and then a luck
   * save per PC. Leaving it out was not "the party takes damage it shouldn't":
   * it was a growing offset in the draw stream from the first lava square a
   * boat sailed over.
   *
   * Note the third and fourth tests are about the square being *entered* — a
   * boat moored on the lava counts, which is what "or entering a boat" means.
   */
  private terrainCantHarm(where: Location, inCombatMove: boolean, town: boolean): boolean {
    if (this.univ.party.partyStatus[PartyStatus.FLIGHT] > 0) return true;
    if (this.univ.party.inBoat >= 0) return true;
    // The C++ keys these off the *context*, not the mode: TOWN_MOVE looks in
    // the town's vehicle list and OUT_MOVE in the outdoor one, and a
    // COMBAT_MOVE checks neither.
    if (inCombatMove) return false;
    if (town) return this.townVehicleAt(this.univ.party.boats, where) !== null;
    return this.outVehicleAt(this.univ.party.boats, where) !== null;
  }

  /**
   * The DAMAGING terrain branch of check_special_terrain
   * (boe.specials.cpp:323) — lava, fire, spikes. flag3 names the damage type
   * (0 or out of range means a plain wound), and the damage is
   * `get_ran(flag2, 1, flag1)`. Outside combat it hits the whole party; in
   * combat only the PC who stepped in it (:383).
   */
  private async damagingTerrain(
    spec: Terrain, where: Location, inCombatMove: boolean, town: boolean,
  ): Promise<void> {
    if (this.terrainCantHarm(where, inCombatMove, town)) return;
    let damType: DamageType = spec.flag3 > 0 && spec.flag3 < DamageType.SPECIAL
      ? spec.flag3 as DamageType
      : DamageType.WEAPON;
    let amount = this.univ.rng.getRan(spec.flag2, 1, spec.flag1);
    const say = (line: string): void => this.univ.addStringToBuf(line);
    switch (damType) {
      case DamageType.FIRE:
        say("  It's hot!");
        // **Firewalk makes burning ground harmless** (boe.specials.cpp:342),
        // and only burning ground: the C++ carries its own "would be nice to
        // have something similar for other damaging terrains" beside it. The
        // damage is set to **-1**, not 0, because the check below is `if(r1 <
        // 0) break;` — a zero would still run `hit_party` and spend its luck
        // saves.
        if ((this.univ.party.partyStatus[PartyStatus.FIREWALK] ?? 0) > 0) {
          say("  It doesn't affect you.");
          amount = -1;
        }
        break;
      case DamageType.COLD: say('  You feel cold!'); break;
      case DamageType.ACID: say('  It burns!'); break;
      case DamageType.SPECIAL:
        // Terrain can't deal true assassination damage; it becomes unblockable.
        damType = DamageType.UNBLOCKABLE;
        say('  Something shocks you!');
        break;
      case DamageType.MAGIC:
      case DamageType.UNBLOCKABLE:
        say('  Something shocks you!');
        break;
      case DamageType.WEAPON: say('  You feel pain!'); break;
      case DamageType.POISON: say('  You suddenly feel very ill for a moment...'); break;
      case DamageType.UNDEAD:
      case DamageType.DEMON:
        say('  A dark wind blows through you!');
        break;
      default: break;
    }
    if (amount < 0) return;
    // "In combat, only hurt the active player" (:382). `hit_party` makes a
    // luck save per living PC, so getting this wrong is five spare draws.
    if (inCombatMove) {
      await damagePc(this.univ, this.univ.currentPc, amount, damType, Race.UNKNOWN);
      return;
    }
    await hitParty(this.univ, amount, damType);
  }

  /**
   * find_waterfall (boe.actions.cpp:3845) — which way the water is carrying
   * the boat, or null. A neighbouring square counts only if it is a waterfall
   * **and its flag1 names the direction it is in**, which is how a scenario
   * draws a river that flows one way. More than one candidate picks at random,
   * and that `get_ran(1,1,count)` is the only draw here.
   */
  private findWaterfall(where: Location, town: boolean): Direction | null {
    const terAt = (x: number, y: number): number => {
      // coord_to_ter (boe.locutils.cpp:210) reads 0 off the map. The C++'s
      // find_waterfall indexes the arrays raw instead, which is out of bounds
      // at the very edge; 0 is what the rest of the file would have said.
      if (town) {
        const t = this.univ.town;
        if (!t || !t.isOnMap(x, y)) return 0;
        return t.record.terrain[x]![y]!;
      }
      if (!this.univ.out.isOnMap(x, y)) return 0;
      return this.univ.out.at(x, y) ?? 0;
    };
    const candidates: Direction[] = [];
    for (let dir = 0; dir < Direction.Here; dir++) {
      const at = shiftLoc(where, dir as Direction);
      const spec = this.univ.terrainType(terAt(at.x, at.y));
      if (spec.special !== TerSpec.WATERFALL_CAVE && spec.special !== TerSpec.WATERFALL_SURFACE)
        continue;
      if (spec.flag1 !== dir) continue;
      candidates.push(dir as Direction);
    }
    if (candidates.length === 0) return null;
    return candidates[this.univ.rng.getRan(1, 1, candidates.length) - 1]!;
  }

  /**
   * run_waterfalls (boe.actions.cpp:3875) — the current sweeps a boat two
   * squares at a time, for as long as it keeps finding waterfalls, and costs
   * the party supplies each time.
   *
   * **Its tail is why a boat follows the party at all.** The C++ never updates
   * `boats[in_boat]` in `outd_move_party` or `town_move_party` — only horses
   * are re-parked there — so this function, called on every move made in a
   * boat, is the *only* thing that keeps the boat under the party. Without it
   * the boat stays wherever it was boarded, and stepping back onto that square
   * later is a plain blocked move instead of "Move: You board the boat." That
   * is what this port did before, and it looked like a blockage bug.
   */
  private runWaterfalls(town: boolean): void {
    const { univ } = this;
    const { party } = univ;
    let where = town ? party.townLoc : party.outLoc;
    for (;;) {
      const dir = this.findWaterfall(where, town);
      if (dir === null) break;
      univ.addStringToBuf('  Waterfall!');
      const step = shiftLoc(shiftLoc({ x: 0, y: 0 }, dir), dir); // two squares
      where = { x: where.x + step.x, y: where.y + step.y };
      if (town) {
        party.townLoc = { ...where };
        this.updateExplored(party.townLoc);
      } else {
        party.outLoc = { ...where };
        party.locInSec = { x: party.locInSec.x + step.x, y: party.locInSec.y + step.y };
        this.updateExplored(party.outLoc);
      }
      // `wilderness_lore_present(coord_to_ter(...) > 0)` — the `> 0` is
      // **inside** the call in the C++, so what gets passed is 0 or 1, a
      // terrain type with no special, and the test is effectively always
      // false. Kept: the draw it skips is part of the call order.
      const looksLikeLore = false;
      if (looksLikeLore && univ.rng.getRan(1, 0, 1) === 0) {
        univ.addStringToBuf('  (No supplies lost.)');
      } else {
        const here = town
          ? univ.town?.record.terrain[where.x]?.[where.y] ?? 0
          : univ.out.at(where.x, where.y) ?? 0;
        const spec = univ.terrainType(here);
        let lost = Math.trunc((party.food * spec.flag2) / 100);
        if (lost >= spec.flag3) {
          lost = spec.flag3;
          univ.addStringToBuf('  (Many supplies lost.)');
        } else univ.addStringToBuf(`  (${lost} supplies lost.)`);
        party.food -= lost;
      }
      this.sound?.play(28);
    }
    // The boat comes along, waterfall or no waterfall.
    const boat = party.boats[party.inBoat];
    if (!boat) return;
    if (town) {
      boat.loc = { ...party.townLoc };
      boat.whichTown = party.townNum;
    } else {
      boat.whichTown = TOWN_NUM_OUTDOORS;
      boat.loc = party.globalToLocal(party.outLoc);
      boat.sector = {
        x: party.outdoorCorner.x + party.iwc.x,
        y: party.outdoorCorner.y + party.iwc.y,
      };
    }
  }

  /**
   * handle_hunting (boe.actions.cpp:3593) — the WILDERNESS_CAVE and
   * WILDERNESS_SURFACE branch of check_special_terrain (boe.specials.cpp:504).
   * A woodsman in the wilds, or a cave lore PC underground, forages for food.
   *
   * **It reads the square the party is standing on, not the one it is walking
   * into.** check_special_terrain runs before the move, so `out_loc` is still
   * the old square — which usually isn't wilderness at all, and the function
   * falls straight out. Kept as written: it's a get_ran call order as much as
   * a rule, and the C++'s own `trait` sentinel (PACIFIST meaning "neither")
   * makes the intent clear enough that this isn't an accident of reading.
   *
   * `wilderness_lore_present` (boe.party.cpp:2841) is checked first and counts
   * *living* PCs with the trait, then each PC rolls for themselves — so a
   * party with one woodsman and one cave-lorist gets one roll each on the
   * square that suits them.
   */
  private handleHunting(): void {
    const { univ } = this;
    if (!this.isOutdoors) return;
    if (this.flying) return;
    const at = univ.party.outLoc;
    if (univ.out.isRoad(at.x, at.y)) return;
    const ter = univ.out.at(at.x, at.y);
    if (ter === undefined) return;
    const spec = univ.terrainType(ter);
    const alive = univ.party.pcs.filter((pc) => pc.mainStatus === MainStatus.ALIVE);
    // wilderness_lore_present: the *waterfall* variants count here too, even
    // though they can't be what called this.
    let trait: Trait | null = null;
    if (spec.special === TerSpec.WILDERNESS_CAVE || spec.special === TerSpec.WATERFALL_CAVE) {
      trait = Trait.CAVE_LORE;
    } else if (spec.special === TerSpec.WILDERNESS_SURFACE
      || spec.special === TerSpec.WATERFALL_SURFACE) {
      trait = Trait.WOODSMAN;
    }
    if (trait === null || !alive.some((pc) => pc.traits[trait])) return;
    // The second switch drops the waterfall pair, so a waterfall square that
    // got this far still leaves with nothing.
    if (spec.special !== TerSpec.WILDERNESS_CAVE && spec.special !== TerSpec.WILDERNESS_SURFACE)
      return;
    for (const pc of univ.party.pcs) {
      if (!pc.isAlive || !pc.traits[trait]) continue;
      if (univ.rng.getRan(1, 0, 12) !== 5) continue;
      univ.party.food += univ.rng.getRan(spec.flag1, 1, 6);
      // No space before "hunts" in the C++ either — it concatenates the name
      // straight onto the word.
      univ.addStringToBuf(`${pc.name}hunts.`);
    }
  }

  /**
   * The DANGEROUS terrain branch of check_special_terrain
   * (boe.specials.cpp:390) — swamps, briar patches and the like. flag2 is a
   * per-PC percentage chance, flag3 names the status, flag1 its strength.
   *
   * Now that the PC status methods exist, each case hands off to the one the
   * C++ names, and they print their own transcript lines.
   *
   * Flying and boats make the party immune, as they do for DAMAGING.
   */
  private dangerousTerrain(
    spec: Terrain, where: Location, inCombatMove: boolean, town: boolean,
  ): void {
    if (this.terrainCantHarm(where, inCombatMove, town)) return;
    const strength = spec.flag1;
    // **The loop starts at the moving PC in combat** and at 0 otherwise
    // (boe.specials.cpp:401) — so a fight only rolls for that PC and the ones
    // after them in the party, which is one `get_ran(1,1,100)` per PC fewer
    // than starting at the top. It reads like an oversight and it ships.
    const from = inCombatMove ? this.univ.curPc : 0;
    for (let i = from; i < 6; i++) {
      const pc = this.univ.party.pcs[i];
      if (!pc || pc.mainStatus !== MainStatus.ALIVE) continue;
      if (this.univ.rng.getRan(1, 1, 100) > spec.flag2) continue;
      switch (spec.flag3 as Status) {
        case Status.POISONED_WEAPON:
          // Nothing but atmosphere here in the original either.
          if (this.univ.rng.getRan(1, 1, 100) > 60)
            this.univ.addStringToBuf("It's eerie here...");
          break;
        case Status.BLESS_CURSE: pc.curse(strength); break;
        case Status.POISON:
          pc.poison(strength, this.univ.rng);
          this.sound?.play(17);
          break;
        case Status.HASTE_SLOW: pc.slow(strength); break;
        case Status.WEBS: pc.web(strength); break;
        case Status.DISEASE: pc.disease(strength, this.univ.rng); break;
        case Status.INVISIBLE:
          this.univ.addStringToBuf(strength < 0 ? 'You feel obscure.' : 'You feel exposed.');
          pc.applyStatus(Status.INVISIBLE, strength);
          break;
        case Status.DUMB: pc.dumbfound(strength, this.univ.rng); break;
        case Status.ASLEEP:
          pc.sleep(Status.ASLEEP, strength, Math.trunc(strength / 2), this.univ.rng);
          break;
        case Status.PARALYZED:
          pc.sleep(Status.PARALYZED, strength, Math.trunc(strength / 2), this.univ.rng);
          break;
        case Status.ACID: pc.acid(strength); break;
        case Status.FORCECAGE:
          // A cage can't hold you in the open — `if(is_out()) break;`
          // (boe.specials.cpp:455), which is the **mode**, so an outdoor arena
          // fight (mode COMBAT, town 200) still cages.
          if (!this.isOutdoors)
            pc.sleep(Status.FORCECAGE, strength, Math.trunc(strength / 2), this.univ.rng);
          break;
        case Status.INVULNERABLE:
        case Status.MAGIC_RESISTANCE:
        case Status.MARTYRS_SHIELD:
          pc.applyStatus(spec.flag3 as Status, strength);
          break;
        default:
          // MAIN and CHARM are illegal here; the C++ ignores them too.
          break;
      }
      // "only damage once in combat!" (boe.specials.cpp:456) — the break sits
      // *inside* the roll, so a fight rolls down the party from the moving PC
      // and stops at the first one the terrain actually catches. This port ran
      // the whole party, which is up to five extra `get_ran(1,1,100)` on every
      // step into a swamp.
      if (inCombatMove) break;
    }
  }

  /**
   * Set by the host: called when the party walks into a locked door, so the UI
   * can raise the pick/bash prompt. Without a handler the door simply blocks.
   *
   * **Awaited.** The C++'s pair of dialogs here is modal (`cChoiceDlog` then
   * `select_pc`), and the bash or the pick happens before anything else does;
   * a host that answers from a recording has to be able to finish before the
   * next action is read. `main.ts` returns void — it launches the prompt and
   * lets the player take as long as they like — and awaiting that is a no-op.
   */
  onLockedDoor: ((where: Location, terrain: number) => void | Promise<void>) | null = null;

  /** Set by the host: called when a TRAINING node needs its dialog. */
  onTrain: (() => void) | null = null;

  /**
   * Set by the host: called when a JOB_BANK node needs the job board
   * (`job-board.xml`). The personality is passed because a job taken from the
   * board records it as the job's source — see `takeJob`.
   */
  onJobBank: ((which: number, title: string, personality: number) => void) | null = null;

  /**
   * Set by the host: the "This creature isn't hostile. Attack anyway?" prompt
   * (`attack-friendly.xml`). Without a handler the swing is simply refused,
   * which is what Cancel does.
   */
  onConfirmAttackFriendly: (() => Promise<boolean>) | null = null;

  /**
   * `set_stat_window_for_pc` (boe.text.cpp:558) — move the item pane to a PC.
   * A hook rather than a direct call because the pane is the host's: `main.ts`
   * owns a real one and the replay driver owns its own. The *rules* decide
   * when it moves, though, which is why the call sites live in here.
   */
  onStatWindowForPc: ((pc: number) => void) | null = null;

  /**
   * Set by the host: `boat-bridge.xml`'s "go under, or land?" prompt when a
   * boat reaches a bridge. `true` means "go under" (the move is forced
   * through); `false` (including no handler) means "leave the boat".
   */
  onConfirmBoatBridge: (() => Promise<boolean>) | null = null;

  /**
   * Set by the host: `party-death.xml`'s "the whole party has died" prompt
   * (`handle_death`, boe.actions.cpp:3713). Fires once, the first time
   * `party.isAlive()` goes false *and stays false after fled PCs are given a
   * chance to come back* — see `checkPartyDeath`; `partyDead` latches so
   * upkeep ticking on a dead party doesn't fire it again. The dialog's three
   * buttons are Restore, Restart and Quit, and all three belong to the host:
   * only it knows about save slots and about how this port starts over.
   */
  onPartyDeath: (() => void) | null = null;

  /**
   * Set by the host: the tail of `handle_victory` (boe.actions.cpp:1412) —
   * `reload_startup(); overall_mode = MODE_STARTUP; draw_startup(0)`. The
   * scenario is over and won, and the original drops straight back to its
   * splash screen with no announcement of its own; the scenario's own closing
   * message has already been shown by the chain that set the flag.
   */
  onVictory: (() => void) | null = null;

  /**
   * Set by the host: `display_monst` (boe.infodlg.cpp:288), the monster sheet
   * Scry Monster opens on whatever it identified. Fire-and-forget — nothing in
   * the spell waits for it, and the *note* is the part that lasts.
   */
  onShowMonster: ((monst: Creature) => void) | null = null;
  private partyDead = false;
  private scenarioWon = false;

  /**
   * The tail of `advance_time` (boe.actions.cpp:1930), which is the one place
   * a game ends:
   *
   *     if(!univ.party.is_alive()) handle_party_death();
   *     else if(end_scenario)      handle_victory();
   *
   * The `else` is load-bearing — a chain that ends the scenario with the same
   * blow that kills the party is a **death**, not a win.
   */
  checkGameOver(): void {
    this.checkPartyDeath();
    if (this.partyDead || !this.specials?.endScenario) return;
    this.handleVictory();
  }

  /**
   * `handle_victory` (boe.actions.cpp:1412) — the END_SCENARIO flag come due.
   * It clears the flag, forgets which scenario was being played, and goes back
   * to the startup screen. It shows nothing on the way: a scenario says its own
   * goodbye with a message node before the end-scenario node, so anything added
   * here would be a second ending on top of the author's.
   *
   * TODO(M8): `exportGraphics`, `exportSummons` and `clear_stored_pcs` — the
   * three lines that carry a party out of one scenario and into the next. They
   * need the campaign-level state (custom sheets, stored PCs) that `saveIo.ts`
   * already lists as unmodelled.
   */
  private handleVictory(): void {
    this.scenarioWon = true;
    if (this.specials) this.specials.endScenario = false;
    // Fire-and-forget behind the animation queue, for the same reason the death
    // announcement is: the blast that finished the scenario may still be on
    // screen when the flag is read.
    void animSettle().then(() => { this.onVictory?.(); });
  }

  /** Whether `handle_victory` has run — the game is over and won. */
  get won(): boolean { return this.scenarioWon; }

  /**
   * `handle_party_death` (boe.actions.cpp:1431). `isAlive()` is `main_status
   * === ALIVE`, in this port and the original both — so a party that's
   * FLED, not dead, also reads as "not alive". The C++ handles that by
   * resetting every FLED PC back to ALIVE *first* and rechecking: if that
   * brings the party back, it's not death, it's a rout, and combat ends
   * instead (`end_town_mode`) — only if nobody comes back this way is it
   * really game over. Skipping this check is exactly the bug that made
   * fleeing an entire outdoor fight read as a party wipe.
   */
  private checkPartyDeath(): void {
    if (this.partyDead || this.univ.party.isAlive()) return;

    const fledPcs = this.univ.party.pcs.filter((pc) => pc.mainStatus === MainStatus.FLED);
    if (fledPcs.length > 0) {
      for (const pc of fledPcs) pc.mainStatus = MainStatus.ALIVE;
      if (this.univ.party.isAlive()) {
        // **A rout is `end_town_mode`, not `end_combat`** (boe.actions.cpp:1455;
        // the 1997 original does the same at ACTIONS.CPP:1446, so it is the
        // spec rather than an OBoE drift), and every *other* way out of a
        // fight runs `end_combat` first — which is the function that clears
        // `combat_pos` and `parry` and hands `cur_pc` back. So in the C++ a
        // routed party comes out of the fight still carrying it, on a
        // `univ.town` that is never unloaded, and `handle_get_items` outdoors
        // then rummages the arena it ran from.
        //
        // The 2026-09-03 attempt at this kept `univ.town` loaded outdoors and
        // cost the corpus 40,048 draws, because a great deal of code reads
        // `univ.town !== null` as "we are in a town". `univ.departedTown` is
        // the narrow version: a *separate* field, so nothing that asks the old
        // question changes its answer, and the two rules that actually need
        // the town after it is gone — the leave-town chain and
        // `handle_get_items` — ask the new one.
        if (this.mode === GameMode.COMBAT) {
          if (this.whichCombatType === 0) this.routOutOfArena();
          else {
            const direction = endTownCombat(this);
            if (direction !== Direction.Here) {
              this.univ.party.direction = direction;
              this.mode = GameMode.TOWN;
              this.center = { ...this.univ.party.townLoc };
              this.updateExplored(this.univ.party.townLoc);
              this.univ.addStringToBuf('End combat.');
            }
          }
        }
        return;
      }
    }

    // **A split-off PC dying is not the end of the game** (boe.actions.cpp:1442).
    // Whoever went on alone is the only one who could have died, so the rest of
    // the party is still standing where they were left: the split ends and the
    // survivors take over, from `left_at` or, if that is another town, by
    // changing level to it.
    if (this.univ.party.isSplit()) {
      this.univ.party.endSplit();
      const { party } = this.univ;
      if (party.leftIn === -1 || party.townNum === party.leftIn) {
        party.townLoc = { ...party.leftAt };
      } else {
        this.forceTownEntry(party.leftIn, party.leftAt);
        this.startTownMode(party.leftIn, 9);
      }
      this.updateExplored(party.townLoc);
      this.center = { ...party.townLoc };
      if (isCombat(this.mode)) this.mode = GameMode.TOWN;
      return;
    }

    this.partyDead = true;
    // The latch is set now, but the *announcement* waits for the screen to
    // catch up. The C++ reaches `handle_party_death` from the main loop, by
    // which time every blocking blast and sleep in the blow that killed you
    // has already played; here the blast is still in the queue when the
    // damage resolves, so telling the player they are dead over the top of it
    // is the wrong order. Fire-and-forget, like the other chains launched
    // from a synchronous path — nothing here depends on the dialog.
    void animSettle().then(() => { this.onPartyDeath?.(); });
  }

  /**
   * force_town_enter — pin where the party lands before start_town_mode runs,
   * which is how a staircase drops you at a specific square.
   */
  forcedTownLoc: Location | null = null;

  forceTownEntry(townNum: number, where: Location): void {
    this.forcedTownLoc = { ...where };
  }

  /**
   * `position_party` (boe.fileio.cpp:218) — put the party down somewhere else
   * on the world map entirely: sector (outX, outY), square (pcX, pcY) inside
   * it. This is a *scripted* teleport, not a step, so it slides the whole 96x96
   * window rather than nudging it, forgets every wandering group in flight, and
   * reloads the explored flags from the sectors it lands on.
   *
   * Returns false if the destination is out of bounds, which is the C++'s
   * `showError` arm — the party doesn't move.
   */
  positionParty(outX: number, outY: number, pcX: number, pcY: number): boolean {
    const { scenario } = this.univ;
    if (
      pcX !== minmax(0, 47, pcX) || pcY !== minmax(0, 47, pcY)
      || outX !== minmax(0, scenario.outWidth - 1, outX)
      || outY !== minmax(0, scenario.outHeight - 1, outY)
    ) {
      showError(this.univ,
        'The scenario has tried to place you in an out of bounds outdoor location.');
      return false;
    }
    this.univ.out.positionParty(outX, outY, pcX, pcY);
    // `build_outdoors`' tail, as above.
    this.eraseOutSpecials();
    if (this.isOutdoors) {
      this.center = { ...this.univ.party.outLoc };
      this.updateExplored(this.univ.party.outLoc);
    }
    return true;
  }

  // `select_pc`'s candidate list lives in `game/selectPc.ts`, with all eight
  // eSelectPC modes; the three-mode version that used to be here is gone.

  /** Try to pick a locked door's lock with a given PC. */
  /** `is_unlockable` (boe.town.cpp:1147) — a lock is something to pick or bash. */
  isUnlockable(where: Location): boolean {
    const town = this.univ.town;
    if (!town || !town.isOnMap(where.x, where.y)) return false;
    const ter = town.record.terrain[where.x]![where.y]!;
    return this.univ.terrainType(ter).special === TerSpec.UNLOCKABLE;
  }

  pickLock(where: Location, pcNum: number): void {
    pickLockAt(this.univ, where, pcNum, this.sound);
  }

  /** Try to bash a locked door open with a given PC. */
  async bashDoor(where: Location, pcNum: number): Promise<void> {
    await bashDoorAt(this.univ, where, pcNum, this.sound);
  }

  /**
   * `handle_spellcast`'s town branch (boe.actions.cpp:401) — cast, and then
   * decide whether it counted as a turn.
   *
   * **The test is whether any PC's spell points changed.** The C++ snapshots
   * all six before `cast_spell` and sets `did_something` only if one of them
   * differs afterwards, so a cast that was refused, cancelled or free leaves the
   * world exactly where it was, and a real one ends the party's turn — monsters
   * move, the clock ticks. This port ran no turn for any cast at all.
   *
   * *Note it is only the town branch.* Outdoors `handle_spellcast` never touches
   * `did_something`, so a spell cast on the world map costs nothing; the clock
   * out there moves in tens anyway.
   */
  async castTownSpell(pcNum: number, spell: Spell, freebie = false): Promise<void> {
    // `handle_spellcast`'s MODE_TOWN arm (boe.actions.cpp:400): snapshot every
    // PC's spell points, cast, and set `did_something` from whether any of them
    // moved. **The mode test is on the way *in*, not on the way out** — this
    // used to return early when the cast had left some other mode behind, on
    // the reasoning that town targeting must not charge a turn. It must not,
    // and the spell-point test already says so: `start_town_targeting` spends
    // nothing. What the early return also swallowed was **Identify and
    // Recharge**, which spend their points *and* leave `MODE_ITEM_TARGET`
    // behind — so the one spell in the game that pays up front and then opens a
    // screen was the one that never cost a turn.
    // `handle_spellcast` has one branch per mode (boe.actions.cpp:394): the
    // outdoor arm calls `cast_spell` and sets **no** `did_something`, and the
    // town arm snapshots every PC's spell points, casts, and sets it from
    // whether any of them moved.
    //
    // **The mode is read on the way in, and the cast happens either way.** This
    // used to test `mode !== TOWN` *after* the cast, which is right for
    // everything that leaves the mode alone and wrong for the two spells that
    // do not: Identify and Recharge spend their points and then open
    // `MODE_ITEM_TARGET`, so the only spells in the game that pay up front were
    // the only ones that never cost a turn. Moving the same test to the top
    // fixed that and broke something bigger — it skipped the **cast** outdoors,
    // where the C++ has a branch of its own — which is what the two-part shape
    // below avoids.
    const townCast = this.mode === GameMode.TOWN;
    const before = this.univ.party.pcs.map((pc) => pc.curSp);
    castSpell(this, pcNum, spell, freebie);
    if (!townCast) return;
    if (this.univ.party.pcs.some((pc, i) => pc.curSp !== before[i])) {
      await this.afterPartyTurn();
    }
  }

  // ------------------------------------------------------------------- talk

  /**
   * The TALK action (boe.actions.cpp:826): pick an adjacent creature and open
   * a conversation with it. Returns false when there's nobody to talk to.
   */
  async talkTo(destination: Location): Promise<boolean> {
    const town = this.univ.town;
    if (!town) return false;
    // handle_talk's own visibility gate, which is stricter than sight alone:
    // note it compares against 4, not SIGHT_BLOCKED.
    if (!town.isOnMap(destination.x, destination.y)
      || this.canSeeLight(this.center, destination) >= 4) {
      this.univ.addStringToBuf("  Can't see space.");
      return false;
    }
    const monst = town.monsterAt(destination);
    if (!monst) {
      this.univ.addStringToBuf('  Nobody there');
      return false;
    }
    /**
     * **Hailing something costs a turn; holding a conversation doesn't.**
     * `handle_talk` sets `did_something` the moment a creature is on the space
     * and only takes it back when `start_talk_mode` actually opens the
     * conversation (boe.actions.cpp:848). So a shout at a hostile, at a summon,
     * at a corpse, or a HAIL special that swallows the greeting, all end the
     * party's turn — the monsters move and the clock ticks — while a real
     * conversation freezes the world for as long as it lasts.
     *
     * This port ran no turn for any of them, which is where its clock started
     * falling behind the C++'s in a talky recording.
     */
    const spentTurn = async (): Promise<boolean> => {
      await this.afterPartyTurn();
      return false;
    };

    // A creature can carry a HAIL special that runs first and, if it blocks,
    // stands in for the conversation entirely (boe.actions.cpp:830).
    if (monst.specialOnTalk >= 0) {
      const { blocked } = await this.runSpecial(
        SpecCtx.HAIL, SpecCtxType.TOWN, monst.specialOnTalk, monst.curLoc);
      if (blocked) return spentTurn();
    }
    if (!monst.isFriendly) {
      this.univ.addStringToBuf('  Creature is hostile.');
      return spentTurn();
    }
    if (monst.summonTime > 0 || monst.personality < 0) {
      // `small_talk` is 1 for a summoned creature and `-personality` otherwise;
      // over 1000 it indexes the scenario's own strings, which is how a
      // scenario gives a mute townsperson one canned line. The C++ carries a
      // TODO about wanting a set of pre-cooked responses; there isn't one.
      const smallTalk = monst.summonTime === 0 ? -monst.personality : 1;
      const strs = this.univ.scenario.specStrs;
      const str = (smallTalk > 1000 && smallTalk < 1000 + strs.length)
        ? strs[smallTalk - 1000]! : 'No response.';
      this.univ.addStringToBuf(`Talk: ${str}`);
      return spentTurn();
    }
    // **A corpse says nothing at all** — not even "No response.". The C++'s
    // last branch is `else if(is_alive())`, so a dead creature with a real
    // personality falls out of the chain silently, having spent the turn.
    if (!monst.isAlive) return spentTurn();
    // A creature's own face overrides its monster template's default one.
    const template = this.univ.scenario.scenMonsters[monst.number];
    const face = monst.facialPic >= 0 ? monst.facialPic : (template?.defaultFacialPic ?? -1);
    this.startTalkMode(town.monsters.indexOf(monst), monst.personality, monst.number, face);
    return true;
  }

  /** start_talk_mode (boe.dlgutil.cpp:709). */
  startTalkMode(
    monsterIndex: number,
    personality: number,
    monsterType: number,
    facePic: number,
  ): void {
    this.preTalkMode = this.mode;
    this.mode = GameMode.TALKING;
    this.talk = new TalkState(this.univ, monsterIndex, personality, monsterType, facePic);
    // A talk SHOP node asks for `cancel_when_empty` (boe.dlgutil.cpp:1000) and
    // then tries the rest of the party; only when nobody can buy does the node
    // fall through to its "nothing available" line.
    this.talk.onShop = (shopNum, costAdj, name) =>
      this.startShopMode(shopNum, costAdj, name, true)
      || this.startShopModeAnyPc(shopNum, costAdj, name);
    this.talk.onItemShop = (mode, a, b, c) => this.startItemShop(mode, a, b, c);
    this.talk.onTrain = () => this.onTrain?.();
    this.talk.onJobBank = (which, title) => this.onJobBank?.(which, title, personality);
    this.talk.onMakeTownHostile = () => makeTownHostile(this);
    this.talk.onCallSpecial = (node, scenario) => {
      const type = scenario ? SpecCtxType.SCEN : SpecCtxType.TOWN;
      void this.runSpecialRaw(SpecCtx.TALK, type, node, this.univ.party.townLoc).then((r) => {
        // In TALK mode a message node hands back string numbers instead of
        // showing a dialog (handle_message, boe.specials.cpp:4645).
        const strs = scenario
          ? this.univ.scenario.specStrs
          : this.univ.town?.record.specStrs ?? [];
        this.talk?.setReply(r.a, r.b, strs);
        this.onRedraw?.();
      });
    };
    this.talk.onRest = (length, hp, sp, wakeAt) => {
      doRest(this.univ, length, hp, sp, this.isOutdoors, this);
      this.univ.party.townLoc = { ...wakeAt };
      this.center = { ...wakeAt };
      this.updateExplored(this.center);
    };
  }

  /** end_talk_mode (boe.dlgutil.cpp:752). */
  endTalkMode(): void {
    this.mode = this.preTalkMode === GameMode.TALK_TOWN ? GameMode.TOWN : this.preTalkMode;
    this.talk = null;
    // The panel drops back to plain inventory when the shopkeeper is done.
    this.itemShop = null;
    if (this.mode === GameMode.TOWN) {
      this.center = { ...this.univ.party.townLoc };
      this.updateExplored(this.center);
    }
  }

  // ------------------------------------------------------------------ shops

  /**
   * start_shop_mode (boe.dlgutil.cpp:160). Returns false when the shop has
   * nothing the current PC can use, which is how the caller knows to try
   * another PC or print "There is nothing available to buy."
   */
  /**
   * `start_shop_mode` (boe.dlgutil.cpp:160).
   *
   * **`cancel_when_empty` defaults to false**, and this port had it wired the
   * other way round: it refused any shop whose list came out empty, always.
   * Only two of the four callers ask for that — the talk SHOP node and
   * `start_shop_mode_other_pc`'s per-PC sweep. A scenario's `ENTER_SHOP`
   * opcode passes three arguments and gets the default, so **an empty shop
   * still opens**: the player is put in front of a counter with nothing on it
   * and has to press Done. Refusing instead left the game in whatever mode it
   * was in with a stale `store_pre_shop_mode` behind it, and the recorded
   * `end_shop_mode` that followed then teleported the mode to a town the party
   * was nowhere near — `VoDT_06-04-2025_18-20-44` walked into an outdoor
   * healer and came out in `MODE_TOWN` with no town loaded.
   *
   * `already_started` keeps `store_pre_shop_mode` where it is, for the calls
   * that re-enter a shop that is already open.
   */
  startShopMode(
    which: number, costAdj: number, storeName: string,
    cancelWhenEmpty = false, alreadyStarted = false,
  ): boolean {
    const scenShop = this.univ.scenario.shops[which];
    if (!scenShop) {
      this.univ.addStringToBuf('The scenario tried to place you in a nonexistent shop!');
      return false;
    }
    const shop = scenShop.clone();
    shop.costAdj = costAdj;
    shop.name = storeName;

    // Apply whatever the party has already bought out of this shop's stock.
    const sold = this.univ.party.storeLimitedStock.get(which);
    if (sold) {
      for (const [slot, left] of sold) {
        if (slot < 0 || slot >= shop.size) continue;
        const entry = shop.getItem(slot);
        if (entry.quantity === 0) continue; // infinite stock; nothing to track
        if (left === 0) entry.type = ShopItemType.EMPTY;
        else if (entry.type === ShopItemType.OPT_ITEM)
          entry.quantity = left + Math.trunc(entry.quantity / 1000) * 1000;
        else entry.quantity = left;
        shop.replaceItem(slot, entry);
      }
    }

    const state = new ShopState(this.univ, which, shop);
    if (state.visible.length === 0 && cancelWhenEmpty) return false;

    if (!alreadyStarted) this.preShopMode = this.mode;
    this.mode = GameMode.SHOPPING;
    this.shop = state;
    return true;
  }

  /**
   * `store_cur_pc` (boe.dlgutil.cpp:136) — who was active when shopping began.
   * A healer walks `univ.cur_pc` down the party looking for someone who needs
   * the service, so without this the PC the player left the counter with is
   * whoever the shop last landed on. -1 means "not shopping".
   */
  private storeCurPc = -1;

  /**
   * start_shop_mode_other_pc (boe.dlgutil.cpp:132) — a healer with nothing for
   * the active PC may still have something for someone else, so try each in
   * turn and leave the first who can buy as the active PC.
   */
  startShopModeAnyPc(
    which: number, costAdj: number, storeName: string,
    allowEmpty = false, alreadyStarted = false,
  ): boolean {
    // `if(store_cur_pc == -1) store_cur_pc = univ.cur_pc;` — only the *first*
    // sweep records it, because the shop may walk the party more than once
    // and it is the PC from before any of that who should come back.
    if (this.storeCurPc === -1) this.storeCurPc = this.univ.curPc;
    const pcBuying = this.univ.curPc;
    for (let i = 0; i < this.univ.party.pcs.length; i++) {
      if (this.univ.party.pcs[i]!.mainStatus === MainStatus.ABSENT) continue;
      this.univ.curPc = i;
      if (this.startShopMode(which, costAdj, storeName, true, alreadyStarted)) return true;
    }
    // "if no one can buy anything but we want to leave an empty shop, we can
    // leave the PC selection where it is" (boe.dlgutil.cpp:139).
    if (allowEmpty) {
      this.univ.curPc = pcBuying;
      this.startShopMode(which, costAdj, storeName, false, alreadyStarted);
    } else this.univ.curPc = pcBuying;
    return false;
  }

  /** end_shop_mode (boe.dlgutil.cpp:227). */
  endShopMode(): void {
    if (this.storeCurPc >= 0) {
      this.univ.curPc = this.storeCurPc;
      this.storeCurPc = -1;
    }
    this.shop = null;
    this.mode = this.preShopMode === GameMode.TALK_TOWN ? GameMode.TOWN : this.preShopMode;
    if (this.mode === GameMode.TALKING && this.talk) {
      // Back to the conversation, which reports the visit is over.
      this.talk.concludeBusiness();
    } else if (this.mode === GameMode.TOWN) {
      this.center = { ...this.univ.party.townLoc };
      this.updateExplored(this.center);
    }
  }

  /** Buy the entry on a given screen row — what a click on the list means. */
  async buyShopRow(row: number): Promise<void> {
    const target = this.shop?.rowEntry(row);
    if (target) await this.buyShopItem(target.index);
  }

  /**
   * `handle_sale` (boe.dlgutil.cpp:333) — buy the shop's item `index`.
   *
   * The **absolute** index into the shop, not a screen row: that is what the
   * C++ works in (`active_shop.getItem(i)`) and what a replay records, while
   * the row a player clicked depends on where the scrollbar happens to sit.
   */
  async buyShopItem(index: number): Promise<void> {
    const state = this.shop;
    if (!state) return;
    if (handleSale(this.univ, state, index, this.sound) === 'special') {
      // A shop entry that is a scenario node: it runs in the SHOPPING context,
      // and only a node that doesn't refuse (`s1 <= 0`) is paid for and taken
      // off the shelf (boe.dlgutil.cpp:461).
      const entry = state.shop.getItem(index);
      const { blocked } = await this.runSpecial(
        SpecCtx.SHOPPING, SpecCtxType.SCEN, entry.item.itemLevel, loc(0, 0));
      if (!blocked) {
        this.univ.party.gold -= state.cost(entry);
        state.shop.takeOne(index);
      }
    }
    this.recordShopStock(state);
    // A healer whose list just emptied moves on to the next PC who needs help
    // — `if(shop_array.empty()) start_shop_mode_other_pc(true, true);`
    // (boe.dlgutil.cpp:505). **Not through `end_shop_mode`**, which is what
    // this used to do: that restores `cur_pc`, rewrites `store_pre_shop_mode`
    // and banks the limited stock a second time, none of which the C++ does
    // between two sales at the same counter.
    if (state.visible.length === 0 && state.shopNum >= 0) {
      this.startShopModeAnyPc(state.shopNum, state.costAdj, state.name, true, true);
    }
  }

  /**
   * end_shop_mode's bookkeeping (boe.dlgutil.cpp:270) — remember how much of
   * each limited-stock entry is left so the shop stays picked-over.
   */
  private recordShopStock(state: ShopState): void {
    if (state.shopNum < 0) return;
    const scenShop = this.univ.scenario.shops[state.shopNum];
    if (!scenShop) return;
    let left = this.univ.party.storeLimitedStock.get(state.shopNum);
    for (let i = 0; i < state.shop.size; i++) {
      const original = scenShop.getItem(i);
      if (original.quantity === 0) continue; // infinite stock
      const entry = state.shop.getItem(i);
      const remaining = entry.type === ShopItemType.EMPTY ? 0 : entry.quantity % 1000;
      if (!left) {
        left = new Map();
        this.univ.party.storeLimitedStock.set(state.shopNum, left);
      }
      left.set(i, remaining);
    }
  }

  // ------------------------------------------------- shop services on our own
  //                                                    goods

  /**
   * Put the inventory panel into one of the four service modes. The panel stays
   * in that mode until the conversation ends, which is how the C++ leaves the
   * sell buttons up while you work through a pack.
   */
  startItemShop(
    mode: ItemShopMode, cost = 0, rechargeLimit = 0, rechargeAmount = 0,
  ): void {
    this.itemShop = { mode, cost, rechargeLimit, rechargeAmount };
  }

  /**
   * `do_mage_spell`'s Identify and Recharge arms (boe.party.cpp:646 and :678) —
   * the same item panel a shop opens, but reached from a spell, and **it takes
   * the game mode with it**: `overall_mode = MODE_ITEM_TARGET`, so the world is
   * frozen behind it until Space or `cancel_item_target` closes it. A talk
   * node's identify/recharge does *not* do that — it sets `stat_screen_mode`
   * alone and the conversation stays up — which is why this is a second
   * entry point rather than an argument to `startItemShop`.
   */
  startItemTarget(
    mode: ItemShopMode, cost = 0, rechargeLimit = 0, rechargeAmount = 0,
  ): void {
    this.startItemShop(mode, cost, rechargeLimit, rechargeAmount);
    this.mode = GameMode.ITEM_TARGET;
  }

  /**
   * `cancel_item_target` (boe.actions.cpp:2579) — Space, or the panel's Done.
   *
   * Three things beyond closing the panel, and this port had none of them:
   * it names which queue it was, it sets `overall_mode = MODE_TOWN`
   * **unconditionally**, and it sets `did_something` — the C++'s own comment
   * says why: *"Time passes because a spell was cast."* Identify and Recharge
   * spend their points when they open the screen, so the turn they owe is
   * charged when it closes.
   *
   * Returns whether the caller owes that turn, so the one caller that is not a
   * spell — a shop's identify queue, reached from a conversation — can be told
   * apart if it ever needs to be.
   */
  endItemShop(): boolean {
    if (this.itemShop?.mode === ItemShopMode.IDENTIFY) {
      this.univ.addStringToBuf('Identify: Finished');
    } else if (this.itemShop?.mode === ItemShopMode.RECHARGE) {
      this.univ.addStringToBuf('Recharge: Finished');
    }
    this.itemShop = null;
    this.mode = GameMode.TOWN;
    return true;
  }

  /** Act on one item's spec button. */
  useItemShop(pcNum: number, slot: number): void {
    if (!this.itemShop) return;
    handleItemShopAction(this.univ, this.itemShop, pcNum, slot, this.sound);
  }

  /** Route a conversation choice; closes the conversation when it's done. */
  async chooseTalkNode(node: number): Promise<void> {
    if (!this.talk) return;
    // **"Ask About..." blocks inside `handle_talk_node`** (boe.dlgutil.cpp:919):
    // its TALK_ASK arm calls `get_text_response` and then dispatches on what was
    // typed. This port used to split the two, with the prompt living in
    // `main.ts` — which meant a replay had no way to answer it, and the live UI
    // had a rule the driver didn't (it skipped an empty answer, where the C++
    // asks the speech list about "" and gets the dunno line).
    if (node === TalkAction.ASK) {
      const asked = await this.host?.askText('Ask about what?') ?? '';
      if (this.talk.askAbout(asked) === 'done') this.endTalkMode();
      return;
    }
    const before = this.talk.str1;
    if (this.talk.handleNode(node) === 'done') {
      this.endTalkMode();
      return;
    }
    this.sound?.play(Snd.BUTTON);
    if (this.talk.lastUnsupported !== null)
      this.univ.addStringToBuf(
        `(${TalkNodeType[this.talk.lastUnsupported]} conversation nodes are not implemented yet)`,
      );
    if (this.talk.str1 === before && node === TalkAction.RECORD) return;
  }

  // ------------------------------------------------------------ transitions

  /**
   * start_town_mode (boe.town.cpp:77). Populates the town from its presets;
   * saved populations, field placement, and entry specials come later.
   *
   * `entryDir` indexes start_locs; 9 means "use the forced location", which
   * for now resolves to the first usable start location.
   */
  /**
   * Enter town combat, facing `direction` — the C++'s `start_town_combat` plus
   * the mode change `handle_action` does around it. `whichCombatType` is 1 for a
   * fight inside a town, which is all this port supports so far.
   *
   * **A party in a boat or on a horse cannot start a fight**
   * (`handle_combat_switch`, boe.actions.cpp:1321): the two refusals sit above
   * the branch that calls `start_town_combat`, and Space — which dismounts —
   * is what a player presses between the refusal and the second attempt.
   * Returns whether the fight actually started.
   */
  startCombat(direction: Direction): boolean {
    this.recorder?.recordValue('handle_combat_switch', direction);
    if (!this.univ.town) return false;
    if (this.univ.party.inBoat >= 0) {
      this.univ.addStringToBuf('Combat: Not while in boat.');
      return false;
    }
    if (this.univ.party.inHorse >= 0) {
      this.univ.addStringToBuf('Combat: Not while on horseback.');
      return false;
    }
    // The two lines `handle_combat_switch` has before `start_town_combat`
    // (boe.actions.cpp:1329). Neither draws a die.
    this.univ.addStringToBuf('Combat!');
    this.sound?.play(18);
    startTownCombat(this, direction);
    this.whichCombatType = 1;
    this.mode = GameMode.COMBAT;
    this.combatActivePc = NO_ONE;
    this.center = { ...this.univ.currentPc.combatPos };
    return true;
  }

  /**
   * Leave combat and regroup. Returns false when the party can't — someone
   * caged apart from the rest — with the refusal already in the transcript.
   */
  endCombat(): boolean {
    this.recorder?.record('handle_combat_switch');
    if (this.mode !== GameMode.COMBAT) return false;
    if (this.whichCombatType === 0) {
      const ended = this.endOutdoorCombat();
      // end_combat's tail: only an outdoor fight autosaves (boe.combat.cpp:4480).
      if (ended) tryAutoSave('EndOutdoorCombat');
      // `set_stat_window_for_pc(univ.cur_pc)` (boe.actions.cpp:1347).
      if (ended) this.onStatWindowForPc?.(this.univ.curPc);
      return ended;
    }
    const direction = endTownCombat(this);
    if (direction === Direction.Here) return false;
    this.univ.party.direction = direction;
    this.mode = GameMode.TOWN;
    this.center = { ...this.univ.party.townLoc };
    this.updateExplored(this.univ.party.townLoc);
    // **The item pane goes back to whoever was up before the fight**
    // (boe.actions.cpp:1358). `end_town_combat` has just restored
    // `univ.cur_pc = store_current_pc`, so this hands the pane to the PC the
    // party was looking at when the fight started — not to whoever happened to
    // be acting when it ended. Missing it left the pane on the last combatant,
    // and `handle_equip_item` is given `stat_window`, so the equips that
    // followed went into the wrong pack.
    this.onStatWindowForPc?.(this.univ.curPc);
    return true;
  }

  /**
   * The turn between rounds: the monsters act, the clock ticks and statuses
   * decay, then the party gets a fresh set of moves.
   *
   * One round only — `afterCombatAction` owns the loop that decides whether
   * another is needed.
   */
  async startCombatRound(): Promise<void> {
    await combatRunMonst(this);
    setPcMoves(this.univ);
    // "The active character is unable to act!" — a PC pinned with X who is
    // asleep, paralysed or slowed to a standstill would otherwise burn the
    // whole party's moves every round, forever, with no way to notice or
    // undo it. The C++ releases the pin itself (boe.combat.cpp:1791).
    if (this.combatActivePc < NO_ONE
      && (this.univ.party.pcs[this.combatActivePc]?.ap ?? 0) === 0) {
      this.combatActivePc = NO_ONE;
      this.univ.addStringToBuf(
        'The active character is unable to act! The whole party is now active.');
    }
  }

  /**
   * char_parry (boe.combat.cpp) — spend the rest of the turn on defence. The
   * bonus scales with the action points given up, so parrying early is worth
   * more; `damagePc` and the to-hit rolls both read it.
   */
  async parry(): Promise<void> {
    // **`handle_parry` (boe.actions.cpp:529) has no guards at all** — no mode
    // test and no action-point test. Both of those live at the *call sites*:
    // the `d` key (:3119) and the SHIELD button (:1644) each check
    // `overall_mode == MODE_COMBAT` before calling it, and `main.ts` keeps
    // that check for the same two. **The replay dispatcher does not**
    // (boe.main.cpp:1103), so a recording can parry outdoors — and it does:
    // `VoDT_09-04-2025_09-41-10` parries three times on the world map after a
    // rout, and each one charges an outdoor turn. This port refused them and
    // its clock fell ten ticks behind per parry.
    //
    // A PC with no points parries for zero and still spends the turn, which is
    // the same shape as `handle_target_space`'s `did_something` (see the entry
    // for `VoDT-5-11`).
    const pc = this.univ.currentPc;
    pc.parry = Math.trunc(pc.ap / 4)
      * (2 + pc.statAdj(Skill.DEXTERITY) + pc.skill(Skill.DEFENSE));
    pc.ap = 0;
    this.univ.addStringToBuf('Parry.');
    // `did_something = true`, unconditionally — so `advance_time` runs
    // `handle_monster_actions`, whichever arm the *mode* selects. Going through
    // `afterPartyTurn` rather than straight to `monsterActionsCombat` also
    // picks up the `play_ambient_sound()` that sits above the combat branch
    // (boe.actions.cpp:1960), which this port was skipping on every parry.
    await this.afterPartyTurn();
  }

  /**
   * handle_wait (boe.actions.cpp:1296) — the **w** key, which is not Space.
   * Space is `handle_pause`, one turn; this is the *long* wait, up to eighty.
   *
   * **The combat arm of the C++'s own dispatcher is dead code, and it is kept
   * dead here.** It reads:
   *
   *     if(overall_mode == MODE_TOWN)   handle_town_wait(...);
   *     else if(!is_town())             "Wait: In town only."
   *     else if(overall_mode == MODE_COMBAT) { handle_stand_ready(...); ... }
   *
   * — but `is_town()` (boe.locutils.cpp:60) is `mode > OUTDOORS && mode <
   * COMBAT`, so it is **false** in combat and the second arm swallows it.
   * Waiting in a fight says "In town only.", which reads like a bug and is
   * what the original does; the third arm can only ever be reached with
   * `cartoon_happening` set, which no player input does. The stand-ready it
   * wanted is on Space instead (`pause`), so nothing is actually lost.
   *
   * The last arm — a town mode that isn't plain MODE_TOWN, i.e. mid-talk or
   * mid-targeting — is the one that tells you to finish up first.
   */
  async wait(): Promise<void> {
    this.recorder?.record('handle_wait');
    if (this.mode === GameMode.TOWN) {
      await this.townWait();
      return;
    }
    if (!isTown(this.mode)) {
      this.univ.addStringToBuf('Wait: In town only.');
      return;
    }
    this.univ.addStringToBuf("Wait: Finish what you're doing first.");
  }

  /**
   * handle_town_wait (boe.actions.cpp:1242) — stand still for up to eighty
   * turns, and stop the moment anything happens.
   *
   * The C++ draws the rest screen and sleeps between iterations; here the loop
   * just runs, the same way `doRest` does. What matters is the sequence, since
   * `get_ran`'s call order is part of the spec.
   */
  private async townWait(): Promise<void> {
    const { univ } = this;
    // The opening test is also the loop's guard, so a monster already in sight
    // means the whole thing is one line and no time passes at all.
    const storeHp: number[] = [];
    const storeAlive: boolean[] = [];
    if (this.partySeesAMonst()) {
      univ.addStringToBuf('Long wait: Monster in sight.');
    } else {
      univ.addStringToBuf('Long wait...');
      // `play_sound(-20)`: negative is the C++'s "don't wait for it", which is
      // the only kind this port has.
      this.sound?.play(20);
      for (const pc of univ.party.pcs) {
        storeHp.push(pc.curHealth);
        storeAlive.push(pc.isAlive);
        // Settling in tears you free of any webs, before the baseline is used
        // to decide whether you were interrupted.
        pc.status[Status.WEBS] = 0;
      }
    }

    let interrupted = false;
    for (let i = 0; i < 80 && !this.partySeesAMonst() && !interrupted; i++) {
      // `increase_age(false)` — which now ticks the clock itself, as the C++
      // does, so the long wait no longer has to do it by hand.
      await increaseAgeEffects(this);
      specialIncreaseAge(this, 1);
      await processFields(this);
      await doMonsters(this);
      await doMonsterTurn(this);
      // **A different roll from the one an ordinary town turn makes.** The
      // turn-by-turn one (boe.actions.cpp:1989) is
      // `get_ran(1,1,160 - difficulty + less_wm*200) == 2`; the long wait's is
      // `== 10` and carries no `less_wm` term. Kept as written — waiting and
      // walking really do attract wandering monsters at different rates.
      const difficulty = univ.townRecord?.difficulty ?? 0;
      if (univ.rng.getRan(1, 1, Math.max(1, 160 - difficulty)) === 10) {
        createWandMonst(this);
      }
      for (let j = 0; j < 6; j++) {
        const pc = univ.party.pcs[j];
        if (pc === undefined) continue;
        // Losing health *or* dying ends it. The two tests are separate because
        // a PC already on 0 health can die without their health changing — the
        // C++ has a comment about the bug that used to be here.
        if (pc.curHealth < (storeHp[j] ?? 0) || pc.isAlive !== (storeAlive[j] ?? false)) {
          interrupted = true;
          univ.addStringToBuf('  Waiting interrupted.');
          break;
        }
      }
      if (this.partySeesAMonst()) {
        interrupted = true;
        univ.addStringToBuf('  Monster sighted!');
      }
      if (!univ.party.isAlive()) break;
    }
    this.checkGameOver();
    // Only a wait that ran its full course quietly is worth a save point.
    if (!this.partySeesAMonst() && !interrupted) tryAutoSave('TownWaitComplete');
  }

  /**
   * party_sees_a_monst (boe.locutils.cpp:506) — is a *hostile* monster in
   * sight? A friendly townsperson walking past doesn't interrupt anything.
   */
  partySeesAMonst(): boolean {
    return (this.univ.town?.monsters ?? []).some(
      (m) => m.isAlive && !m.isFriendly && this.partyCanSeeMonst(m));
  }

  /**
   * handle_pause — "stand ready" in combat (parry 100, which also means the
   * to-hit bonus caps out), or a plain pause otherwise. Either way it's a turn
   * spent, and webs get torn at.
   */
  async pause(): Promise<void> {
    this.recorder?.record('handle_pause');
    if (this.mode === GameMode.COMBAT) {
      const pc = this.univ.currentPc;
      pc.parry = 100;
      pc.ap = 0;
      this.univ.addStringToBuf('Stand ready.');
      if ((pc.status[Status.WEBS] ?? 0) > 0) {
        this.univ.addStringToBuf('You clean webs.');
        pc.status[Status.WEBS] = Math.max(0, (pc.status[Status.WEBS] ?? 0) - 2);
      }
      // **Standing still in a fire still burns you** — `handle_pause` ends with
      // `check_fields(univ.current_pc().combat_pos, COMBAT_MOVE,
      // univ.current_pc())` (boe.actions.cpp:627). Only the combat branch has
      // it; a town pause does not. Without it a PC could stand ready on a wall
      // of fire for the whole fight and take nothing, and the C++ spent two
      // draws here that this port did not.
      await this.checkFields(pc.combatPos, true, pc);
      // `handle_pause` ends `did_something = true; need_redraw = true;`
      // (boe.actions.cpp:678) — so, like every other action, the round is
      // stepped by `handle_monster_actions`, which draws before it steps.
      // Note it is `char_stand_ready` that runs here, **not**
      // `handle_stand_ready`: that is a different key, and it is one of the
      // only two places the C++ calls `combat_next_step` for itself.
      this.monsterActionsCombat();
      return;
    }
    this.univ.addStringToBuf('Pause.');
    for (const pc of this.univ.party.pcs) {
      if (!pc.isAlive || (pc.status[Status.WEBS] ?? 0) <= 0) continue;
      this.univ.addStringToBuf(`${pc.name} cleans webs.`);
      pc.status[Status.WEBS] = Math.max(0, (pc.status[Status.WEBS] ?? 0) - 2);
    }
    this.pauseVehicles();
    // **The town branch checks fields too**, and this port only had the combat
    // one. `handle_pause` ends its `else` arm with
    // `check_fields(univ.party.town_loc, TOWN_MOVE, univ.party[0])`
    // (boe.actions.cpp:675) — the same call the combat arm makes at :627, with
    // the town context and PC 0 rather than the acting one. Out of combat
    // `check_fields` only announces the wall, so it costs the party nothing;
    // what it does spend is **dice**, and pausing in a wall of fire made two
    // draws here that this port did not.
    await this.checkFields(this.univ.party.townLoc, false, this.univ.party.pcs[0]!);
    await this.afterPartyTurn();
  }

  /**
   * The vehicle half of handle_pause (boe.actions.cpp:630-676): a horse
   * always dismounts; a boat only dismounts onto passable ground, and
   * re-boards on a second pause if you're still standing on it (which is how
   * you get stranded and un-stranded on a single-tile passable patch of
   * water).
   */
  private pauseVehicles(): void {
    const { party } = this.univ;
    if (party.inHorse >= 0) {
      const horse = party.horses[party.inHorse]!;
      if (this.isOutdoors) {
        horse.whichTown = TOWN_NUM_OUTDOORS;
        horse.loc = party.globalToLocal(party.outLoc);
        horse.sector = { x: party.outdoorCorner.x + party.iwc.x, y: party.outdoorCorner.y + party.iwc.y };
      } else if (this.inTown) {
        horse.loc = { ...party.townLoc };
        horse.whichTown = party.townNum;
      }
      party.inHorse = -1;
    }
    if (party.inBoat >= 0) {
      const boat = party.boats[party.inBoat]!;
      if (this.isOutdoors && !blocksMove(this.univ.terrainType(this.univ.out.at(party.outLoc.x, party.outLoc.y)))) {
        boat.whichTown = TOWN_NUM_OUTDOORS;
        boat.loc = party.globalToLocal(party.outLoc);
        boat.sector = { x: party.outdoorCorner.x + party.iwc.x, y: party.outdoorCorner.y + party.iwc.y };
        party.inBoat = -1;
      } else if (
        this.inTown && this.univ.town
        && !blocksMove(this.univ.terrainType(this.univ.town.record.terrain[party.townLoc.x]![party.townLoc.y]!))
      ) {
        boat.loc = { ...party.townLoc };
        boat.whichTown = party.townNum;
        party.inBoat = -1;
      }
    } else {
      // The above could leave you stranded in a single-tile passable area, so
      // pausing again should re-enter the boat.
      let boat: Vehicle | null = null;
      if (this.isOutdoors) boat = this.outVehicleAt(party.boats, party.outLoc);
      else if (this.inTown) boat = this.townVehicleAt(party.boats, party.townLoc);
      if (boat) {
        party.inBoat = party.boats.indexOf(boat);
        this.univ.addStringToBuf('You board the boat.');
      }
    }
  }

  /**
   * handle_toggle_active — pin the turn to one PC so they can act repeatedly,
   * or release it back to the whole party.
   */
  toggleActivePc(): void {
    if (this.mode !== GameMode.COMBAT) return;
    if (this.combatActivePc === NO_ONE) {
      this.univ.addStringToBuf('This PC now active.');
      this.combatActivePc = this.univ.curPc;
    } else {
      this.univ.addStringToBuf("All PC's now active.");
      this.univ.curPc = this.combatActivePc;
      this.combatActivePc = NO_ONE;
    }
  }

  /**
   * `prime_time` (boe.actions.cpp:295) — the game is in one of the three modes
   * where the party is free to act, rather than mid-conversation or mid-shop.
   */
  get primeTime(): boolean {
    return this.mode === GameMode.OUTDOORS || this.mode === GameMode.TOWN
      || this.mode === GameMode.COMBAT;
  }

  /**
   * handle_switch_pc (boe.actions.cpp:1012) — clicking a name in the party
   * stats list makes that PC the active one.
   *
   * In combat this costs nothing but needs the PC to have action points left;
   * out of combat they only have to be alive and present — **except in a
   * healing shop**, see below.
   */
  switchPc(which: number): void {
    const pc = this.univ.party.pcs[which];
    if (!pc) return;
    if (!this.primeTime && this.mode !== GameMode.SHOPPING
      && this.mode !== GameMode.TALKING && this.mode !== GameMode.ITEM_TARGET) {
      this.univ.addStringToBuf('Set active: Finish what you are doing first.');
      return;
    }
    if (isCombat(this.mode)) {
      // **Debug mode hands a spent PC four fresh points** rather than refusing
      // the switch (boe.actions.cpp:1021), which is how a tester walks a whole
      // party through a fight one PC at a time. The **fifth** rule that reads
      // the flag, and the second in a fight — its neighbour is
      // `do_monster_turn`'s `ap = 0`, which freezes the other side of the same
      // round. `AllMageSpells` casts every mage spell in the book this way:
      // debug mode on at action 69, and from there every `handle_switch_pc` to
      // an exhausted PC is a refusal here and a free turn there.
      if (this.univ.debugMode && pc.ap <= 0) pc.ap = 4;
      if (pc.ap > 0) {
        // `draw_terrain()` (boe.actions.cpp:1041), and it is **before**
        // `univ.cur_pc = which_pc` — so the recast hint it pays for is the
        // *outgoing* PC's, not the incoming one's. This branch leaves
        // `need_redraw` alone; only the out-of-combat one below sets it.
        drawTerrain(this);
        this.univ.curPc = which;
        this.center = { ...pc.combatPos };
      } else this.univ.addStringToBuf('Set active: PC has no APs.');
      return;
    }
    // **A dead PC can be made active inside a healing shop** — that is what
    // `eShopType::ALLOW_DEAD` is for (boe.actions.cpp:1031), and without it the
    // one service a corpse needs is the one service it can never be sold. This
    // port refused every time, so a recording that walked into a temple,
    // selected the dead PC and bought Raise Dead instead healed whoever
    // happened to be active, and carried a body for the rest of the game — a
    // divergence that shows up thousands of draws later as `hit_party` rolling
    // one luck save fewer than the C++, because `damage_pc` returns at its
    // first line for a PC who is not ALIVE.
    const allowDead = this.mode === GameMode.SHOPPING
      && this.shop !== null && shopAllowsDead(this.shop.shop);
    if (pc.mainStatus !== MainStatus.ALIVE && !allowDead) {
      this.univ.addStringToBuf('Set active: PC must be here & active.');
      return;
    }
    this.univ.curPc = which;
    this.univ.addStringToBuf(
      `${this.mode === GameMode.SHOPPING ? 'Now shopping' : 'Now active'}: ${pc.name}`);
    this.needRedraw = true;
  }

  /**
   * `handle_switch_pc_items` (boe.actions.cpp:1051) — the six tabs under the
   * item pane. **It is not `handle_switch_pc` with the page changed**: the
   * gate is different (no ITEM_TARGET), the refusal wording is different, and
   * out of combat it makes the PC *active* as well as showing their pack.
   *
   * Returns whether the caller should also move the item pane, which the C++
   * does on every path but the `prime_time` refusal.
   *
   * The driver used to set `cur_pc` here unconditionally, with neither gate.
   * A recording that flipped to a **dead** PC's tab therefore made a corpse
   * active, and everything that reads `univ.cur_pc` afterwards — the get-items
   * screen's carrier, above all — handed its pile to the wrong PC.
   */
  switchPcItems(which: number): boolean {
    const pc = this.univ.party.pcs[which];
    if (!pc) return false;
    if (!this.primeTime && this.mode !== GameMode.TALKING
      && this.mode !== GameMode.SHOPPING) {
      this.univ.addStringToBuf("Set active: Finish what you're doing first.");
      return false;
    }
    if (!isCombat(this.mode)) {
      const allowDead = this.mode === GameMode.SHOPPING
        && this.shop !== null && shopAllowsDead(this.shop.shop);
      if (pc.mainStatus !== MainStatus.ALIVE && !allowDead) {
        this.univ.addStringToBuf('Set active: PC must be here & active.');
      } else {
        this.univ.curPc = which;
        this.univ.addStringToBuf(`Now active: ${pc.name}`);
      }
    }
    return true;
  }

  /**
   * `current_switch` — who the player picked first for a trade-places. 6 is the
   * C++'s "nobody yet", and `increase_age` resets it every turn.
   */
  currentSwitch = NO_ONE;

  /**
   * switch_pc (boe.actions.cpp:3619) — trade two PCs' places in the marching
   * order. The first click names one, the second names the other.
   */
  tradePlaces(which: number): void {
    if (!this.primeTime) {
      this.univ.addStringToBuf('Trade places: Finish what you are doing first.');
      return;
    }
    if (isCombat(this.mode)) {
      this.univ.addStringToBuf("Trade places: Can't do this in combat.");
      return;
    }
    if (this.currentSwitch < NO_ONE) {
      if (this.currentSwitch !== which) {
        this.univ.addStringToBuf('Switch: OK.');
        this.univ.party.swapPcs(which, this.currentSwitch);
        if (this.univ.curPc === this.currentSwitch) this.univ.curPc = which;
        else if (this.univ.curPc === which) this.univ.curPc = this.currentSwitch;
      } else this.univ.addStringToBuf('Switch: Not with self.');
      this.currentSwitch = NO_ONE;
      return;
    }
    this.univ.addStringToBuf('Switch: Switch with who?');
    this.currentSwitch = which;
  }

  /** handle_print_pc_hp / handle_print_pc_sp — the two read-outs. */
  printPcHp(which: number): void {
    const pc = this.univ.party.pcs[which];
    if (!pc) return;
    this.univ.addStringToBuf(`${pc.name} has ${pc.curHealth} health out of ${pc.maxHealth}.`);
  }

  printPcSp(which: number): void {
    const pc = this.univ.party.pcs[which];
    if (!pc) return;
    this.univ.addStringToBuf(`${pc.name} has ${pc.curSp} spell points out of ${pc.maxSp}.`);
  }

  /**
   * `handle_missile` (boe.actions.cpp:1370) — the **s** key, Escape and the
   * SHOOT button all land here, and it is a *toggle*: in MODE_COMBAT it arms
   * the acting PC's missile, and in MODE_FIRING / MODE_THROWING it cancels the
   * aim again. In any other mode it does nothing **and says nothing** — the
   * C++'s three call sites gate on those modes themselves, and the function
   * has no else branch.
   *
   * This port used to refuse with "Shoot: Only in combat.", a string that
   * exists nowhere in the C++, *and* it never grew the cancel arm — so a
   * recording that pressed **s** twice to change its mind armed the missile,
   * then got the refusal instead of a cancel, and every action after it was
   * aimed at a party in the wrong mode.
   */
  handleMissile(): boolean {
    if (this.mode === GameMode.COMBAT) return this.armMissile();
    if (this.mode === GameMode.FIRING || this.mode === GameMode.THROWING) {
      this.univ.addStringToBuf('  Cancelled.');
      this.cancelMissile();
    }
    return false;
  }

  /**
   * `load_missile` — arm the current PC's missile and switch to FIRING or
   * THROWING, which is a targeting mode: the next click on the terrain is the
   * shot. Returns false (with the refusal in the transcript) when there's
   * nothing to shoot with.
   */
  private armMissile(): boolean {
    const loaded = loadMissile(this.univ);
    if (!isLoaded(loaded)) {
      this.univ.addStringToBuf(loaded.message);
      return false;
    }
    this.missile = loaded;
    this.mode = loaded.mode;
    // `current_pat` — all four of `load_missile`'s arms end the same way
    // (boe.combat.cpp:1490, :1508, :1520, :1532): an exploding missile aims a
    // radius-2 blast, anything else a single square.
    this.currentPat = getBuiltinPattern(
      this.univ.currentPc.items[loaded.ammoSlot]?.ability === ItemAbil.EXPLODING_WEAPON
        ? SpellPat.RADIUS_2 : SpellPat.SINGLE);
    // `handle_target_mode` (boe.combat.cpp:1488, :1504, :1516, :1528) — the
    // target lock scrolls the view onto the enemies, and its redraw spends an
    // encumbrance roll. A missile passes `eSpell::NONE`, so the spell table's
    // `target_lock` column does not gate it.
    handleTargetMode(this, loaded.range);
    this.univ.addStringToBuf(
      loaded.mode === GameMode.THROWING ? 'Throw: Select a target.' : 'Fire: Select a target.');
    this.univ.addStringToBuf("  (Hit 's' to cancel.)");
    return true;
  }

  /** Back out of targeting without spending the turn. */
  cancelMissile(): void {
    if (this.missile === null) return;
    this.missile = null;
    this.mode = GameMode.COMBAT;
  }

  /**
   * Loose the armed missile at `where`. The mode goes back to COMBAT either
   * way — a shot that was out of range or out of sight has still been aimed,
   * which is what the C++ does when `fire_missile` returns.
   */
  async fireMissileAt(where: Location): Promise<boolean> {
    const loaded = this.missile;
    if (loaded === null) return false;
    this.missile = null;
    this.mode = GameMode.COMBAT;
    await fireMissile(this, loaded, where);
    this.afterCombatAction();
    return true;
  }

  /**
   * The current PC swings at whatever is on `where`. Returns false when there's
   * nothing there to hit.
   */
  async attackAt(where: Location): Promise<boolean> {
    const target = this.univ.town?.monsterAt(where) ?? null;
    if (!target) return false;
    await pcAttack(this.univ, this.univ.curPc, target, this);
    this.afterCombatAction();
    return true;
  }

  /**
   * After anything that spends action points: hand over to the next PC, and
   * when nobody has moves left start a new round.
   *
   * `combat_run_monst` is what happens between rounds — the monsters act, then
   * everyone gets fresh moves. Public because it's the equivalent of the
   * C++'s `advance_time`-driven `combat_next_step` call, which runs after
   * *every* action including ones this class doesn't itself perform — casting
   * a spell is a free function (`combatCastSpell`/`doCombatCast` in
   * spellCombat.ts/spellCombatTarget.ts) that takes AP and has to be able to
   * trigger the same turn advance, or the caster never runs out of AP.
   */
  /**
   * `handle_monster_actions`' combat arm (boe.actions.cpp:1953) — the redraw
   * that runs **before** the round is stepped, then the step itself.
   *
   * It is its own method because two paths reach it: `advance_time` by way of
   * `afterPartyTurn`, and `do_combat_cast`, which in the C++ returns into
   * `handle_target_space` and then into `advance_time` but here calls the step
   * itself. Both have to pay the same rolls in the same order.
   *
   * The redraw comes first so its encumbrance roll lands ahead of everything
   * `combat_next_step` draws rather than behind it, and the clear after it is
   * the C++'s: the flag survives only while one PC is pinned active with no
   * points left.
   */
  monsterActionsCombat(): void {
    if (this.needRedraw) {
      drawTerrain(this);
      const pinned = this.univ.party.pcs[this.combatActivePc];
      if (this.combatActivePc === NO_ONE || (pinned?.ap ?? 0) > 0) {
        this.needRedraw = false;
      }
    }
    // `if(combat_next_step()) need_redraw = true;` (:1960) — and it is an
    // `if`, not an assignment, so a step that changes nothing leaves the flag
    // alone. This used to set the flag unconditionally on the reasoning that
    // "something has just been spent", which is wrong: `combat_next_step`
    // returns false whenever the cages did not move, the monsters did not run
    // and `cur_pc` did not change — the ordinary case of a PC who still has
    // action points. That bought an extra `draw_terrain` in `advance_time`'s
    // tail for every such action.
    if (this.afterCombatAction()) this.needRedraw = true;
  }

  afterCombatAction(): boolean {
    // combat_next_step opens by reconciling the cage barriers with the
    // FORCECAGE statuses — on *every* step, not only when the round rolls
    // over, so someone who just walked into one is caught straight away.
    //
    // Its return is `to_return`, which starts here: the cages moving is the
    // first of the three things that make a step count.
    let toReturn = syncForceCages(this);

    const storePc = this.univ.curPc;
    // `pick_next_pc` is always called at least once, even when the current PC
    // still has moves: it is also what burns everyone else's AP while one PC
    // is pinned active, which the old `ap > 0` early-out skipped.
    if (!pickNextPc(this.univ, this.combatActivePc)) {
      this.finishCombatStep(storePc);
      // `pick_next_pc(); if(univ.cur_pc != store_pc) to_return = true;` — the
      // second call is the one `finishCombatStep` has already made.
      return toReturn || this.univ.curPc !== storePc;
    }

    // The monsters are going to run, so `to_return` is true whatever the tail
    // finds — which is what makes this answerable now rather than when the
    // queued turn settles.
    toReturn = true;
    this.queueTurn(async () => {
      // `while(pick_next_pc()) { combat_run_monst(); set_pc_moves(); ... }`
      // (boe.combat.cpp:1789). The **loop** matters: if nobody can act after
      // the monsters have gone, the monsters go again. Running it once — as
      // this port did — deadlocks a party that has no moves to come back to,
      // and `setPcMoves` hands out zero AP to a slowed PC on every odd
      // `party.age`, so a fully-slowed party simply froze on odd rounds.
      do {
        await this.startCombatRound();
        // The C++'s own safety valve, and with a real loop it is load-bearing:
        // a dead party never regains AP, so this is what ends the round.
        if (!this.univ.party.isAlive()) break;
      } while (pickNextPc(this.univ, this.combatActivePc));
      pickNextPc(this.univ, this.combatActivePc);
      // The monsters ran, which is `to_return` in the C++.
      this.finishCombatStep(storePc, true);
    });
    return toReturn;
  }

  /**
   * combat_next_step's tail: recentre on whoever is up, and say so. The
   * `Active:` line is the only thing that tells the player the turn moved on
   * and how much the new PC can do with it — printed only when the party is
   * *not* pinned to one PC, and only when the turn actually changed hands.
   */
  private finishCombatStep(storePc: number, ranMonsters = false): void {
    this.center = { ...this.univ.currentPc.combatPos };
    if (this.combatActivePc === NO_ONE && this.univ.curPc !== storePc) {
      const pc = this.univ.currentPc;
      this.univ.addStringToBuf(
        `Active: ${pc.name} (#${this.univ.curPc + 1}, ${pc.ap} ap.)`);
    }
    // **The item pane follows whoever is up** (combat_next_step's last branch,
    // boe.combat.cpp:1823) — on a *wider* condition than the `Active:` line
    // above it, since a round of monsters counts even when the turn didn't
    // change hands. This is not cosmetic: `handle_equip_item` and its
    // siblings are handed `stat_window`, not `cur_pc` (boe.actions.cpp:1090),
    // so a pane left on the wrong PC equips out of the wrong pack — silently,
    // because the slot the recording names is empty there.
    if (this.univ.curPc !== storePc || ranMonsters) this.onStatWindowForPc?.(this.univ.curPc);
    this.onRedraw?.();
    this.checkGameOver();
  }

  /**
   * pc_combat_move (boe.combat.cpp:216) — one square for the current PC, which
   * may instead be an attack, a swap with another PC, or a refusal. One action
   * point for a move, four for a swing. Monsters adjacent to the square being
   * left get a free back-shot (boe.combat.cpp:300), below.
   */
  async combatMove(destination: Location): Promise<boolean> {
    const town = this.univ.town;
    // **`pc` is re-read after the terrain check, and that is load-bearing.**
    // The C++ writes `univ.current_pc()` afresh at every use — it is a lookup
    // through `univ.cur_pc`, not a bound reference — and `check_special_terrain`
    // can *change who that is*: a field or damaging terrain at the destination
    // kills the acting PC, `kill_pc` parks `cur_pc` on `first_active_pc()`, and
    // every line below then belongs to **the next PC**, who takes the
    // back-shots and makes the step. Binding it once at the top left this port
    // walking a corpse: the back-shot loop measured adjacency from the dead
    // PC's square, found nothing, and the `main_status == ALIVE` test at the
    // bottom refused the move outright — so the recording's step simply did not
    // happen here.
    let pc = this.univ.currentPc;
    if (this.mode !== GameMode.COMBAT || !town) return false;
    // **No action-point guard.** `pc_combat_move` (boe.combat.cpp:216) has
    // none: it is `pick_next_pc` that keeps a spent PC from being the one you
    // are driving, and a *recording* can still hand a move to one. The C++ lets
    // the step through, `take_ap(1)` clamps at zero, and `did_something` is set
    // — so `advance_time` runs `combat_next_step`, nobody has points, and the
    // **round turns over**. This port refused instead, so the round never
    // ended: `ZKR_15-05-2025_16-09-51` sat on a PC with no moves and refused
    // every action after it.

    const monstHit = town.monsterAt(destination);
    if (!monstHit && (pc.status[Status.FORCECAGE] ?? 0) > 0) {
      this.univ.addStringToBuf("Move: Can't escape.");
      this.univ.addStringToBuf('  (Try doing something else.)');
      return false;
    }
    if (!monstHit && !(await this.checkSpecialTerrain(destination, pc)).canEnter) return false;
    pc = this.univ.currentPc;

    const dir = setDirection(pc.combatPos, destination);
    if (this.locOffActiveArea(destination) && this.whichCombatType === 1
      && !this.townIsBlocked(destination)) {
      this.univ.addStringToBuf("Move: Can't leave town during combat.");
      // **Every `return true` owes a `combat_next_step`.** The C++ doesn't run
      // it here — `handle_move` sets `did_something` from this return and
      // `handle_monster_actions` calls `combat_next_step()` off *that*
      // (boe.actions.cpp:751 and :1959). So the turn moves on even when the
      // move was refused for this reason, and it did not here.
      this.monsterActionsCombat();
      return true;
    }
    // pc_combat_move (boe.combat.cpp:242): terrain 90 marks the edge of an
    // outdoor arena. Stepping onto it is a 30% roll to flee — the acting PC
    // leaves the fight and loses their remaining AP; a failed roll still
    // costs 1 AP as if they'd tried to bolt and been dragged back. Only
    // arena combat (whichCombatType === 0) has this border; town fights use
    // the "can't leave town" refusal above instead.
    if (town.record.terrain[destination.x]?.[destination.y] === 90 && this.whichCombatType === 0) {
      if (this.univ.rng.getRan(1, 1, 10) < 3) {
        pc.mainStatus = MainStatus.FLED;
        if (this.combatActivePc === this.univ.curPc) this.combatActivePc = NO_ONE;
        pc.ap = 0;
        this.univ.addStringToBuf('Moved: Fled.');
      } else {
        takeAp(this.univ, 1);
        this.univ.addStringToBuf("Moved: Couldn't flee.");
      }
      this.monsterActionsCombat();
      return true;
    }

    if (monstHit) {
      // Swinging at someone who isn't hostile asks first (the "attack-friendly"
      // dialog), and going through with it turns the whole town on you.
      let doAttack = !monstHit.isFriendly;
      if (!doAttack) doAttack = (await this.onConfirmAttackFriendly?.()) ?? false;
      if (doAttack) {
        if (monstHit.isFriendly) makeTownHostile(this);
        pc.lastAttacked = monstHit;
        await pcAttack(this.univ, this.univ.curPc, monstHit, this);
        this.monsterActionsCombat();
        return true;
      }
      return false;
    }

    // Another PC on the square: swap places, at a cost to both.
    //
    // **Including yourself.** The C++ asks `univ.target_there(destination,
    // TARG_PC)`, which matches any living PC on the square — and clicking your
    // own figure is a destination you are standing on, so the acting PC finds
    // *themselves* and swaps with themselves. It costs **two** action points
    // (one from `monst_hit->ap--`, one from `take_ap`) and says "Move: Switch
    // places." This port excluded the mover and let a self-move take the plain
    // move branch at one AP, which is a different number of actions per round —
    // a replay spinning on the spot ran out of AP a turn before the recording's
    // did.
    const other = this.univ.party.pcs.find(
      (p) => p.isAlive && locsEqual(p.combatPos, destination));
    if (other) {
      if (other.ap === 0) {
        this.univ.addStringToBuf("Move: Can't switch places.");
        this.univ.addStringToBuf('  (other PC has no APs)');
        return false;
      }
      other.ap--;
      this.univ.addStringToBuf('Move: Switch places.');
      const storeLoc = { ...pc.combatPos };
      pc.combatPos = { ...destination };
      other.combatPos = storeLoc;
      pc.direction = dir;
      takeAp(this.univ, 1);
      // **The square you just left is checked again, for the PC now standing on
      // it** (`check_special_terrain(store_loc, COMBAT_MOVE, switch_pc)`,
      // boe.combat.cpp:292). A swap walks *two* people onto new squares, so a
      // wall of fire between two PCs burns both of them — and a PC swapping
      // with themselves, which the C++ allows, is burnt twice by the same
      // square in one action. That second pair of draws is what named this.
      await this.checkSpecialTerrain(storeLoc, other);
      this.moveSound(town.record.terrain[destination.x]![destination.y]!, pc.ap);
      this.monsterActionsCombat();
      return true;
    }

    if (this.townIsBlocked(destination)) {
      this.univ.addStringToBuf(`Blocked: ${DIRECTION_NAMES[dir] ?? ''}`);
      return false;
    }

    // "monsters get back-shots" (boe.combat.cpp:300) — stepping out of a
    // hostile creature's reach gives it a free swing, and every adjacent one
    // takes it. The mirror of the `pc_adj` rule in `do_monster_turn`: that is
    // the PC's free swing when a *monster* leaves melee, this is the monster's
    // when a *PC* does. Neither was ported.
    //
    // Adjacent to where the PC **is** and not to where they are **going**, so
    // sidestepping along a creature's flank is free and backing out is not.
    // Asleep and paralysed creatures don't get one; friendly ones never do.
    for (const monst of town.monsters) {
      if (!monst.isAlive) continue;
      if (!monstAdjacent(monst, pc.combatPos)) continue;
      if (monstAdjacent(monst, destination)) continue;
      if (monst.isFriendly) continue;
      if ((monst.status[Status.ASLEEP] ?? 0) > 0) continue;
      if ((monst.status[Status.PARALYZED] ?? 0) > 0) continue;
      const was = this.univ.curPc;
      // `combat_posing_monster = current_working_monster = 100 + i`
      // (boe.combat.cpp:310), cleared straight after (:312) — which is what
      // makes `monster_attack`'s own `draw_terrain(2)` cost a die here.
      this.workingMonster = this.posingMonster = 100 + town.monsters.indexOf(monst);
      try {
        await monsterAttack(this, monst, pc);
      } finally {
        this.workingMonster = this.posingMonster = -1;
      }
      // `draw_terrain(0)` (boe.combat.cpp:313), after the clear — mode 0 has no
      // early-out, so the free-swing costs a redraw of its own.
      drawTerrain(this);
      // `if(s1 != univ.cur_pc) return true;` — the swing killed them and the
      // turn has already moved on, so the move itself is abandoned.
      //
      // **And this return still owes `combat_next_step`.** `kill_pc` parks
      // `cur_pc` on `first_active_pc()` — PC 0, whatever their action points —
      // and only `pick_next_pc` moves it off again. Without that call the
      // party is left holding a PC with no moves, every later step is refused
      // and the fight never ends: `VoDT_04-05-2025_14-17-38` sat there for
      // thirteen actions and then closed combat 250 draws early.
      if (was !== this.univ.curPc) {
        this.monsterActionsCombat();
        return true;
      }
    }

    // "move if still alive" — a back-shot can finish the mover outright.
    if (!pc.isAlive) return false;

    pc.combatPos = { ...destination };
    pc.direction = dir;
    takeAp(this.univ, 1);
    this.univ.addStringToBuf(`Moved: ${DIRECTION_NAMES[dir] ?? ''}`);
    this.moveSound(town.record.terrain[destination.x]![destination.y]!, pc.ap);
    this.updateExplored(destination);
    this.center = { ...destination };
    this.monsterActionsCombat();
    return true;
  }

  /**
   * `skipEntrySpecial` covers the two places the town's `spec_on_entry` must
   * not fire. The debug Enter Town key is one — `if(!debug_enter)
   * handle_town_specials(...)` (boe.town.cpp:356), which drops the party in
   * without waking the place up. **Scenario start is the other**, and the C++
   * spells it differently: `handle_town_specials` only *queues* the node
   * (boe.town.cpp:689), and `put_party_in_scen` then empties the queue behind
   * `start_town_mode` with its own comment — "preserve legacy behaviour of not
   * calling the enter town node at scenario start" (boe.party.cpp:216). Same
   * effect, and this port runs the chain rather than queueing it, so the only
   * place to say it is here.
   */
  startTownMode(townNum: number, entryDir: number, skipEntrySpecial = false): void {
    if (this.univ.scenario.towns[townNum] === undefined) {
      this.univ.addStringToBuf('The scenario tried to put you into a town that does not exist.');
      return;
    }

    // **`town_mods` — the town replacement** (boe.town.cpp:99), and the
    // check for a nonexistent town runs **twice**, once on the number asked
    // for and once on the number arrived at.
    //
    // A `<town-flag town="17" add-x="15" add-y="1">` says: entering town 17
    // with that Stuff Done Flag set enters `17 + PSD[15][1]` instead. It is how
    // a scenario shows the same place changed — A Small Rebellion's Stalker's
    // Fortress is towns **17 and 18**, identical terrain and different scripts,
    // and this port walked into 17 for the whole recording where the C++ was in
    // 18 from the moment the rebellion started. Nothing about that shows in the
    // draw stream until a door with a `Prevent Action` node on it in one town
    // and nothing on it in the other refuses a step, a hundred actions later.
    //
    // The horses and boats stabled in the old town number are re-homed to the
    // new one, or they would be stranded in a town nobody can reach.
    const formerTown = townNum;
    for (const mod of this.univ.scenario.townMods) {
      if (mod.spec < 0 || mod.spec >= 200 || townNum !== mod.spec) continue;
      if (!this.univ.party.sdLegit(mod.x, mod.y)) continue;
      townNum += this.univ.party.getSdf(mod.x, mod.y);
      for (const horse of this.univ.party.horses) {
        if (horse.exists && horse.whichTown === formerTown) horse.whichTown = townNum;
      }
      for (const boat of this.univ.party.boats) {
        if (boat.exists && boat.whichTown === formerTown) boat.whichTown = townNum;
      }
    }
    const record = this.univ.scenario.towns[townNum];
    if (!record) {
      this.univ.addStringToBuf('The scenario tried to put you into a town that does not exist.');
      return;
    }

    this.mode = GameMode.TOWN;
    this.univ.party.townNum = townNum;
    this.sound?.play(
      record.lightingType === Lighting.LIGHT_NORMAL ? Snd.ENTER_TOWN : Snd.ENTER_DUNGEON,
    );
    const town = new CurTown(record, this.univ);
    this.univ.town = town;
    // The town that was kept only for the leave-town chain is superseded now.
    this.univ.departedTown = null;

    // Doors the party unlocked on a previous visit stay unlocked.
    for (const where of record.doorUnlocked) {
      const ter = record.terrain[where.x]?.[where.y];
      if (ter === undefined) continue;
      const spec = this.univ.terrainType(ter);
      if (spec.special === TerSpec.UNLOCKABLE) record.terrain[where.x]![where.y] = spec.flag1;
    }

    // Restore whatever the party has already mapped of this town.
    for (let x = 0; x < record.maxDim; x++)
      for (let y = 0; y < record.maxDim; y++)
        if (record.maps[x]![y]!) town.makeExplored(x, y);

    // boe.town.cpp:156 — the live population knows which town it belongs to,
    // and `end_town_mode` files it away under that name. A restore below
    // overwrites both, since the C++ assigns the whole saved population.
    town.monstWhichTown = townNum;
    town.monstHostile = false;
    // **A town the party has been in lately is restored, not rebuilt**
    // (boe.town.cpp:156-247). Four slots' worth of memory: whoever the party
    // killed here stays dead, and the webs and barriers it left behind are
    // still standing. Without this every re-entry resurrects the town, which
    // is a divergence the draw stream only shows several hundred actions
    // later, when a creature that should not exist rolls its notice check.
    const saveSlot = this.univ.party.creatureSave.findIndex((p) => p.whichTown === townNum);
    let noThrash: Set<Creature>;
    if (saveSlot >= 0) {
      noThrash = this.restoreTownPopulation(town, this.univ.party.creatureSave[saveSlot]!);
      town.updateFields(this.univ.party.setup[saveSlot]!);
    } else {
      noThrash = this.populateTown(town);
    }
    const townToast = this.thrashTown(town, noThrash);
    this.clearDoorFields(town);
    this.placePresetItems(town, townToast);
    this.sweepTown(town);
    // boe.town.cpp:450, right after the sweeps: the markers of everything this
    // party has already finished here are gone before the town is drawn once.
    this.eraseTownSpecials();

    // "No hostile monsters present" (boe.town.cpp:473).
    this.univ.party.hostilesPresent = 0;

    // **Everyone forgets where they were going** (boe.town.cpp:498). Without
    // this, every creature keeps `cCreature`'s default target of (80,80) — off
    // the bottom-right corner of any town — and `rand_move`'s first branch
    // succeeds every single turn walking towards it. The townspeople then file
    // south-east in straight lines instead of milling about, and because that
    // branch returns before `rand_move` rolls anything, the town's whole
    // `get_ran` stream shifts too. It was the largest single cause of replay
    // drift: found 2026-08-03 by diffing draw streams against the C++.
    for (const monst of town.monsters) monst.targLoc = { x: 0, y: 0 };

    // "check horses"/"check boats" (boe.town.cpp:503): a vehicle the party's
    // own list has lost track of (an older save missing a vehicle the
    // scenario since gained) is restored from the scenario's template.
    const { party, scenario } = this.univ;
    for (let i = 0; i < party.boats.length; i++) {
      const template = scenario.boats[i];
      if (template && template.whichTown >= 0 && template.loc.x >= 0 && !party.boats[i]!.exists) {
        party.boats[i] = { ...template, exists: true };
      }
    }
    for (let i = 0; i < party.horses.length; i++) {
      const template = scenario.horses[i];
      if (template && template.whichTown >= 0 && template.loc.x >= 0 && !party.horses[i]!.exists) {
        party.horses[i] = { ...template, exists: true };
      }
    }

    // handle_town_specials (boe.town.cpp:659): the town's entry node fires once
    // we're inside — and a town the party has emptied fires a *different* one,
    // which is how a scenario says "the place is a ruin now".
    // `if(!debug_enter) handle_town_specials(...)` (boe.town.cpp:356) — the
    // debug Enter Town key drops the party in without waking the place up.
    const entryNode = townToast ? record.specOnEntryIfDead : record.specOnEntry;
    if (entryNode >= 0 && !skipEntrySpecial)
      void this.runSpecial(
        SpecCtx.ENTER_TOWN, SpecCtxType.TOWN, entryNode, this.univ.party.townLoc);

    // A staircase or an OUT_FORCE_TOWN node can pin the arrival square.
    const forced = this.forcedTownLoc;
    this.forcedTownLoc = null;
    const start =
      entryDir < 4 ? record.startLocs[entryDir]! : { x: -1, y: -1 };
    let where = forced ?? start;
    if (where.x < 0)
      where =
        record.startLocs.find((l) => l.x >= 0) ??
        loc(Math.floor(record.maxDim / 2), Math.floor(record.maxDim / 2));
    this.univ.party.townLoc = { ...where };
    this.center = { ...where };
    town.makeExplored(where.x, where.y);
    this.updateExplored(this.univ.party.townLoc);
    this.univ.addStringToBuf(`You enter ${record.name}.`);
    // start_town_mode's last line (boe.town.cpp:531).
    tryAutoSave('EnterTown');
  }


  /** light_radius (boe.locutils.cpp:458). */
  lightRadius(): number {
    const town = this.univ.town;
    if (!town || town.record.lightingType === Lighting.LIGHT_NORMAL) return 200;
    const extraLevels = [10, 20, 50, 75, 110, 140];
    let store = 1;
    for (const level of extraLevels) if (this.univ.party.lightLevel > level) store++;
    return store;
  }

  /** coord_to_ter (boe.locutils.cpp:209) — terrain at a point in either mode. */
  private coordToTer(x: number, y: number): number {
    const town = this.univ.town;
    if (town) return town.isOnMap(x, y) ? town.record.terrain[x]![y]! : 0;
    return this.univ.out.isOnMap(x, y) ? this.univ.out.at(x, y) : 0;
  }

  /** get_blockage (boe.locutils.cpp:441) — how much a tile obstructs sight. */
  private getBlockage(ter: number): number {
    const blockage = this.univ.terrainType(ter).blockage;
    if (
      blockage === TerObstruct.BLOCK_MOVE_AND_SIGHT ||
      blockage === TerObstruct.BLOCK_SIGHT
    )
      return SIGHT_BLOCKED;
    if (blockage === TerObstruct.BLOCK_MOVE_AND_SHOOT) return 1;
    return 0;
  }

  /** sight_obscurity (boe.locutils.cpp:179). */
  sightObscurity = (x: number, y: number): number => {
    let store = this.getBlockage(this.coordToTer(x, y));
    const town = this.univ.town;
    if (!town) return store;
    // `is_special` — the special_locs scan, not the field flag — and **town
    // mode only**: the C++ puts this one bump inside `if(is_town())` and the
    // field tests below inside `if(is_town() || is_combat())`, so a scripted
    // square stops obscuring sight the moment a fight starts on it.
    if (this.inTown && town.isSpecialSpot(x, y)) store++;
    // A web is half-transparent; a barrier blocks sight outright; a crate,
    // barrel or block is one step of cover.
    if (town.hasField(x, y, FieldType.FIELD_WEB)) store += 2;
    if (town.hasField(x, y, FieldType.BARRIER_FIRE)
      || town.hasField(x, y, FieldType.BARRIER_FORCE)) return SIGHT_BLOCKED;
    if (town.hasField(x, y, FieldType.OBJECT_CRATE)
      || town.hasField(x, y, FieldType.OBJECT_BARREL)
      || town.hasField(x, y, FieldType.OBJECT_BLOCK)) store++;
    return store;
  };

  /**
   * combat_obscurity (boe.locutils.cpp:204) — the stricter obscurity the
   * *placement* code uses: anything that blocks movement, and lava, count as
   * fully blocking whether or not you can see over them. `place_party` and
   * `find_clear_spot` draw their lines with this, which is what stops a PC
   * being dropped on the far side of a wall.
   */
  combatObscurity = (x: number, y: number): number => {
    const ter = this.coordToTer(x, y);
    if (blocksMove(this.univ.terrainType(ter))) return SIGHT_BLOCKED;
    // is_lava (boe.locutils.cpp:164) is hardcoded against the picture number
    // in the C++ too, with its own "TODO: Don't hardcode this!".
    if (this.univ.terrainType(ter).picture === 964) return SIGHT_BLOCKED;
    return this.sightObscurity(x, y);
  };

  /**
   * combat_pt_in_light (boe.locutils.cpp:486) — the combat twin of
   * `pt_in_light`: a square is lit if *any* living PC is within the light
   * radius of it, rather than the party as a whole. An outdoor arena
   * (`whichCombatType === 0`) is always lit.
   */
  combatPtInLight(to: Location): boolean {
    const town = this.univ.town;
    if (!town) return true;
    if (town.record.lightingType === Lighting.LIGHT_NORMAL || this.whichCombatType === 0)
      return true;
    if (!town.isOnMap(to.x, to.y)) return true;
    if (town.isLit(to.x, to.y)) return true;
    const rad = this.lightRadius();
    return this.univ.party.pcs.some((pc) => pc.isAlive && dist(pc.combatPos, to) <= rad);
  }

  /**
   * party_can_see (boe.locutils.cpp:519) — whether a space is visible at all.
   * Returns the C++'s 1-or-6, where 6 means "no"; in combat it returns *which*
   * PC can see it, which is why the caller only ever compares against 6.
   *
   * Three genuinely different branches, and the differences matter:
   * - Outdoors and in town the line is drawn from the party's own square.
   * - **In town the on-screen test is waived once the view has been scrolled
   *   away from the party** (`center != univ.party.town_loc`), which is what
   *   lets the pointing arrows show you something the party can see but that
   *   isn't in the 9x9 window.
   * - In combat there is no on-screen test at all, and the line is drawn from
   *   each PC in turn — so a scout standing forward reveals ground for
   *   everyone.
   */
  partyCanSee(where: Location): number {
    if (this.isOutdoors) {
      const from = this.univ.party.outLoc;
      return pointOnScreen(from, where) && this.canSeeLight(from, where) < SIGHT_BLOCKED
        ? 1 : 6;
    }
    // **Above the town *and* the combat branch** (boe.locutils.cpp:525): while
    // the fog is lifted, being on screen is the whole test — no light, no line
    // of sight, and in combat as well as in town.
    if (this.fogLifted) return pointOnScreen(this.univ.party.townLoc, where) ? 1 : 6;
    if (!isCombat(this.mode)) {
      const from = this.univ.party.townLoc;
      const onScreen = pointOnScreen(from, where) || !locsEqual(this.center, from);
      return onScreen && this.ptInLight(from, where)
        && this.canSeeLight(from, where) < SIGHT_BLOCKED ? 1 : 6;
    }
    // Combat: light first, since a dark square is invisible to everyone.
    if (this.whichCombatType !== 0 && !this.combatPtInLight(where)) return 6;
    for (let i = 0; i < this.univ.party.pcs.length; i++) {
      const pc = this.univ.party.pcs[i]!;
      if (!pc.isAlive) continue;
      if (canSee(pc.combatPos, where, this.sightObscurity) < SIGHT_BLOCKED) return i;
    }
    return 6;
  }

  /**
   * check_if_monst_seen (boe.graphutil.cpp:653) — fire a monster type's
   * `see_spec` the first time the party lays eyes on it, then give it a one in
   * ten chance of making its noise.
   *
   * **This draws from the game stream**, so it is not the cosmetic function it
   * looks like: `get_ran`'s call order is part of the spec, and a town turn
   * makes one of these draws for *every visible creature whose type has an
   * ambient sound*. Leaving it out shifted the whole town stream and was what
   * sent the wandering townspeople off in different directions from the C++'s.
   */
  private checkIfMonstSeen(monstNum: number, at: Location): void {
    const { party } = this.univ;
    if (monstNum < 10000 && !party.mSeen.has(monstNum)) {
      party.mSeen.add(monstNum);
      // play_see_monster_str (boe.graphutil.cpp:213) — no draw, just the queue.
      const seeSpec = this.univ.scenario.scenMonsters[monstNum]?.seeSpec ?? -1;
      if (seeSpec > -1 && this.specials) {
        this.specials.queueSpecial(SpecCtx.SEE_MONST, SpecCtxType.SCEN, seeSpec, at);
      }
    }
    const sound = monstNum >= 10000
      ? this.univ.party.summons[monstNum - 10000]?.ambientSound ?? -1
      : this.univ.scenario.scenMonsters[monstNum]?.ambientSound ?? -1;
    if (sound > 0 && this.univ.rng.getRan(1, 1, 100) < 10) this.sound?.play(sound);
  }

  /**
   * play_ambient_sound (boe.graphutil.cpp:668), the first thing
   * `handle_monster_actions` does after redrawing the map — so it runs *ahead
   * of* `increase_age` and the monsters, and its draws come first in the turn.
   *
   * Three branches, and only two of them draw: in town it is really a
   * "have you seen this before?" sweep over the visible creatures; outdoors it
   * is one roll for a one-in-ten chance of a bird or a drip; anywhere else
   * (combat, look mode) it returns having drawn nothing.
   */
  private playAmbientSound(): void {
    if (this.mode === GameMode.TOWN) {
      const town = this.univ.town;
      if (town === null) return;
      for (const m of town.monsters) {
        if (this.partyCanSeeMonst(m)) this.checkIfMonstSeen(m.number, m.curLoc);
      }
      return;
    }
    // Ambient sounds are outdoors only at the moment, says the C++.
    if (this.mode !== GameMode.OUTDOORS) return;
    if (this.univ.rng.getRan(1, 1, 100) > 10) return;
    const DRIP = [78, 79];
    const BIRD = [76, 77, 91];
    const sector = this.univ.out.sector;
    switch (sector.ambientSound) {
      case AmbientSound.DRIP:
        this.sound?.play(DRIP[this.univ.rng.getRan(1, 0, 1)]!);
        break;
      case AmbientSound.BIRD:
        this.sound?.play(BIRD[this.univ.rng.getRan(1, 0, 2)]!);
        break;
      case AmbientSound.CUSTOM:
        this.sound?.play(sector.outSound);
        break;
      case AmbientSound.NONE:
        break;
    }
  }

  /**
   * party_can_see_monst (boe.locutils.cpp:366) — a big creature is visible if
   * any one of the squares it stands on is.
   */
  partyCanSeeMonst(monst: Creature): boolean {
    for (let i = 0; i < monst.xWidth; i++)
      for (let j = 0; j < monst.yWidth; j++)
        if (this.partyCanSee({ x: monst.curLoc.x + i, y: monst.curLoc.y + j }) < 6) return true;
    return false;
  }

  /**
   * can_see_light (boe.locutils.cpp:173). The obscurity function is an
   * argument in the C++ too: most callers pass `sight_obscurity`, but the
   * placement code passes the stricter `combat_obscurity`.
   */
  canSeeLight(
    from: Location, to: Location,
    getObscurity: (x: number, y: number) => number = this.sightObscurity,
  ): number {
    // The C++ asks combat_pt_in_light in combat (any PC's own light reaches
    // the square) and pt_in_light in town (the party's does).
    if (isCombat(this.mode)) {
      if (!this.combatPtInLight(to)) return SIGHT_BLOCKED + 1;
    } else if (this.worldIsTown && !this.ptInLight(from, to)) return SIGHT_BLOCKED + 1;
    return canSee(from, to, getObscurity);
  }

  /** pt_in_light (boe.locutils.cpp:471). */
  ptInLight(from: Location, to: Location): boolean {
    const town = this.univ.town;
    if (!town || town.record.lightingType === Lighting.LIGHT_NORMAL) return true;
    if (!town.isOnMap(to.x, to.y)) return true;
    if (town.isLit(to.x, to.y)) return true;
    return dist(from, to) <= this.lightRadius();
  }

  /**
   * The *restoring* half of start_town_mode's creature setup
   * (boe.town.cpp:160-247) — the branch taken when this town is one of the
   * four the party still remembers.
   *
   * What survives is who is dead and what they are; what does not is where
   * they were standing, what they were doing and what was wrong with them.
   * Every creature goes back to its start square at full health with no
   * status and no target, and anything that wandered outside the town's
   * playable rectangle, or was a summons, is written off.
   */
  private restoreTownPopulation(town: CurTown, pop: Population): Set<Creature> {
    const { party } = this.univ;
    // `univ.town.monst = pop` copies the whole population, hostility included:
    // a town that had turned on the party is still hostile when it returns.
    town.monsters = pop.monsters.map(cloneCreature);
    town.monstHostile = pop.hostile;
    town.monstWhichTown = pop.whichTown;

    for (const monst of town.monsters) {
      if (this.locOffActiveArea(monst.curLoc)) monst.active = CreatureStatus.DEAD;
      if (monst.active === CreatureStatus.ALERTED) monst.active = CreatureStatus.IDLE;
      monst.curLoc = { ...monst.startLoc };
      monst.health = monst.maxHealth;
      monst.mp = monst.maxMp;
      monst.morale = monst.mMorale;
      monst.status.fill(0);
      if (monst.summonTime > 0) monst.active = CreatureStatus.DEAD;
      monst.target = 6;
      // The C++ clamps again after restoring, which is redundant now that the
      // two lines above assign the maxima — kept because it is what ships.
      if (monst.mp > monst.maxMp) monst.mp = monst.maxMp;
      if (monst.health > monst.maxHealth) monst.health = monst.maxHealth;
    }

    // A second pass, because travelling NPCs may have arrived (or left) while
    // the party was away. Same switch as `populateTown`'s, but this one is
    // deciding whether a *remembered* creature is still here.
    const noThrash = new Set<Creature>();
    for (const monst of town.monsters) {
      switch (monst.timeFlag) {
        case MonstTime.ALWAYS:
          break;
        case MonstTime.SOMETIMES_A:
        case MonstTime.SOMETIMES_B:
        case MonstTime.SOMETIMES_C:
          if ((party.calcDay() % 3) + 3 !== Number(monst.timeFlag)) {
            monst.active = CreatureStatus.DEAD;
          } else {
            monst.active = CreatureStatus.IDLE;
            monst.specEncCode = 0;
            monst.curLoc = { ...monst.startLoc };
            monst.health = monst.maxHealth;
          }
          break;
        case MonstTime.APPEAR_ON_DAY:
          if (party.dayReached(monst.monsterTime, monst.timeCode)) {
            monst.active = CreatureStatus.IDLE;
            monst.timeFlag = MonstTime.ALWAYS;
          }
          break;
        case MonstTime.DISAPPEAR_ON_DAY:
          if (party.dayReached(monst.monsterTime, monst.timeCode)) {
            monst.active = CreatureStatus.DEAD;
            monst.timeFlag = MonstTime.ALWAYS;
          }
          break;
        case MonstTime.APPEAR_WHEN_EVENT:
        case MonstTime.DISAPPEAR_WHEN_EVENT: {
          // Note the C++ compares against `key_times` directly rather than
          // going through `day_reached`, so easy mode's ten free days don't
          // apply on this path.
          const when = party.keyTimes.get(monst.timeCode);
          if (when === undefined) break; // the event hasn't happened yet
          if (party.calcDay() >= when) {
            monst.active = monst.timeFlag === MonstTime.APPEAR_WHEN_EVENT
              ? CreatureStatus.IDLE : CreatureStatus.DEAD;
            monst.timeFlag = MonstTime.ALWAYS;
          }
          break;
        }
        case MonstTime.APPEAR_AFTER_CHOP: {
          const record = town.record;
          const chopped = record.townChopTime > 0
            && party.dayReached(record.townChopTime, record.townChopKey);
          if (chopped || isCleanedOut(record)) {
            noThrash.add(monst);
            monst.timeFlag = MonstTime.ALWAYS;
          } else monst.active = CreatureStatus.DEAD;
          break;
        }
      }
    }
    return noThrash;
  }

  /**
   * "Thrash town?" (boe.town.cpp:325-353) — a town the party has emptied, or
   * that the scenario has had chopped down, loses whatever is still standing
   * in it. Returns whether it happened, because the entry special the town
   * fires depends on it.
   *
   * The two arms are not symmetrical, and the difference is deliberate:
   * - **Cleaned out** — the party has killed `max_num_monst` of the town's
   *   creatures — kills *everything* the chop rules didn't already spare,
   *   friendly townsfolk included.
   * - **Chopped** — the scenario's `town_chop_time` has come — first adds
   *   every living **hostile** to the spared set, so what the announcement
   *   actually clears out is the residents. The monsters stay.
   *
   * The last loop is the C++'s "flush excess doomguards and viscous goos": a
   * creature that splits itself leaves copies in slots past the town's own
   * preset list, and those copies must not survive into a new visit.
   */
  private thrashTown(town: CurTown, noThrash: Set<Creature>): boolean {
    const { party } = this.univ;
    const record = town.record;
    let townToast = false;

    if (isCleanedOut(record)) {
      townToast = true;
      this.univ.addStringToBuf('Area has been cleaned out.');
    }
    if (record.townChopTime > 0 && party.dayReached(record.townChopTime, record.townChopKey)) {
      this.univ.addStringToBuf('Area has been abandoned.');
      for (const monst of town.monsters)
        if (monst.isAlive && !monst.isFriendly) noThrash.add(monst);
      townToast = true;
    }
    if (townToast) {
      for (const monst of town.monsters)
        if (!noThrash.has(monst)) monst.active = CreatureStatus.DEAD;
    }

    for (const monst of town.monsters) {
      if (!monst.mon.abil[MonstAbil.SPLITS]!.active) continue;
      // The C++ indexes `town.monst[i]` against `town->creatures[i]` with the
      // same `i`, because its population is a sparse array whose index *is*
      // the preset slot. This port's list is compacted and carries the slot on
      // the creature, so ask the creature. A copy placed at runtime past the
      // end of the preset list has no preset to match and goes.
      const preset = record.creatures[monst.slot];
      if (preset === undefined || monst.number !== preset.number)
        monst.active = CreatureStatus.DEAD;
    }
    return townToast;
  }

  /**
   * The tail of start_town_mode's field setup (boe.town.cpp:355-369): a door
   * can't have a web, a crate, a barrel, a barrier or quickfire on it, so
   * whatever the presets or the party's own memory put there is swept off —
   * and while the loop is running it latches whether any quickfire survived,
   * and whether the town holds a conveyor belt (boe.town.cpp:141-155, which
   * clears `belt_present` and re-derives it from the terrain every entry).
   */
  private clearDoorFields(town: CurTown): void {
    const dim = town.record.maxDim;
    town.beltPresent = false;
    for (let x = 0; x < dim; x++)
      for (let y = 0; y < dim; y++) {
        const spec = this.univ.terrainType(town.record.terrain[x]![y]!).special;
        if (spec === TerSpec.CONVEYOR) town.beltPresent = true;
        if (spec === TerSpec.UNLOCKABLE || spec === TerSpec.CHANGE_WHEN_STEP_ON) {
          town.setField(x, y, FieldType.FIELD_WEB, false);
          town.setField(x, y, FieldType.OBJECT_CRATE, false);
          town.setField(x, y, FieldType.OBJECT_BARREL, false);
          town.setField(x, y, FieldType.BARRIER_FIRE, false);
          town.setField(x, y, FieldType.BARRIER_FORCE, false);
          town.setField(x, y, FieldType.FIELD_QUICKFIRE, false);
        }
        if (town.hasField(x, y, FieldType.FIELD_QUICKFIRE)) town.quickfirePresent = true;
      }
  }

  /**
   * The saving half of end_town_mode (boe.town.cpp:551-564). The town the
   * party is leaving goes into the slot it already occupies, or, failing
   * that, into the next slot round the ring — evicting whichever town has
   * been remembered longest.
   */
  private saveTownPopulation(): void {
    const { party } = this.univ;
    const town = this.univ.town;
    if (!town) return;
    // **The label comes from the population, not from the party.** They agree
    // whenever the party walked in; they do not after a save is loaded, and
    // the C++ files the town under whatever the population says. See
    // `CurTown.monstWhichTown`.
    const population: Population = {
      whichTown: town.monstWhichTown,
      hostile: town.monstHostile,
      monsters: town.monsters.map(cloneCreature),
    };
    const existing = party.creatureSave.findIndex((p) => p.whichTown === party.townNum);
    if (existing >= 0) {
      party.creatureSave[existing] = population;
      party.setup[existing] = town.saveSetup();
      return;
    }
    party.creatureSave[party.atWhichSaveSlot] = population;
    party.setup[party.atWhichSaveSlot] = town.saveSetup();
    party.atWhichSaveSlot = party.atWhichSaveSlot === 3 ? 0 : party.atWhichSaveSlot + 1;
  }

  /** The creature-loading half of start_town_mode (boe.town.cpp:250-310). */
  private populateTown(town: CurTown): Set<Creature> {
    const { party, scenario } = this.univ;
    const day = party.calcDay();
    const noThrash = new Set<Creature>();
    town.monsters = [];
    for (let i = 0; i < town.record.creatures.length; i++) {
      const preset = town.record.creatures[i]!;
      if (preset.number <= 0) continue;
      const template = scenario.scenMonsters[preset.number];
      if (!template) continue;
      // **The list is indexed by preset slot, gaps and all.** The C++ clears
      // the population and then calls `assign(i, …)` for each preset with a
      // monster in it (boe.town.cpp:254); `assign` resizes to `i + 1`, so the
      // empty presets before it become default-constructed creatures — which
      // are `DEAD` (creature.hpp:24) and stay out of the way.
      //
      // This port used to skip them and `push`, which compacted the list, and
      // that is not a detail: a creature target is encoded as `100 + index`,
      // `place_monster` takes the first dead *index*, and — the one that
      // showed up in the draw stream — `monst_pick_target_monst` rolls its
      // tie-break only when a candidate *equals* the best distance so far, so
      // **the number of draws it makes depends on the iteration order**. The
      // save format already wrote and read the C++'s shape (saveIo's `CREATURE
      // n` pages fill the gaps), so a reloaded game and a freshly entered one
      // disagreed with each other as well as with the C++.
      while (town.monsters.length < i) {
        const gap = new Creature();
        gap.slot = town.monsters.length;
        gap.active = CreatureStatus.DEAD;
        town.monsters.push(gap);
      }
      const monst = assignCreature(
        i, preset, template, this.univ.party.easyMode, this.univ.difficultyAdjust());

      // A creature gated behind an unset special encounter starts inactive.
      if (monst.specEncCode > 0) monst.active = CreatureStatus.DEAD;

      // The C++'s own order, and it uses the full `day_reached` — so the
      // creature's `time_code` names an *event* the day is measured against,
      // and easy mode's ten free days apply here too.
      switch (monst.timeFlag) {
        case MonstTime.ALWAYS:
          break;
        case MonstTime.APPEAR_ON_DAY:
          if (!party.dayReached(monst.monsterTime, monst.timeCode))
            monst.active = CreatureStatus.DEAD;
          break;
        case MonstTime.DISAPPEAR_ON_DAY:
          if (party.dayReached(monst.monsterTime, monst.timeCode))
            monst.active = CreatureStatus.DEAD;
          break;
        case MonstTime.SOMETIMES_A:
        case MonstTime.SOMETIMES_B:
        case MonstTime.SOMETIMES_C:
          monst.active =
            (day % 3) + 3 !== Number(monst.timeFlag) ? CreatureStatus.DEAD : CreatureStatus.IDLE;
          break;
        case MonstTime.APPEAR_WHEN_EVENT: {
          // Two ways to be absent, and the C++'s own TODO wonders whether the
          // second should really kill it: the event hasn't happened, or the
          // clock has been wound back behind it. Note this arm compares
          // `key_times` directly rather than going through `day_reached`.
          const when = party.keyTimes.get(monst.timeCode);
          if (when === undefined || party.calcDay() < when) monst.active = CreatureStatus.DEAD;
          break;
        }
        case MonstTime.DISAPPEAR_WHEN_EVENT: {
          const when = party.keyTimes.get(monst.timeCode);
          if (when !== undefined && party.calcDay() >= when) monst.active = CreatureStatus.DEAD;
          break;
        }
        case MonstTime.APPEAR_AFTER_CHOP: {
          // The C++ collects these into `no_thrash` instead of sparing them
          // outright, because the town-toast pass below it is what would
          // otherwise kill them. Without that pass the two are the same thing.
          const record = town.record;
          const chopped = record.townChopTime > 0
            && party.dayReached(record.townChopTime, record.townChopKey);
          if (chopped || isCleanedOut(record)) noThrash.add(monst);
          else monst.active = CreatureStatus.DEAD;
          break;
        }
      }

      // A creature that starts inside a force cage is held there
      // (boe.town.cpp:305). The fields are already down by now: `CurTown`'s
      // constructor lays the presets out before any of this runs.
      if (monst.isAlive && town.hasField(monst.curLoc.x, monst.curLoc.y, FieldType.BARRIER_CAGE))
        monst.status[Status.FORCECAGE] = 1000;

      town.monsters.push(monst);
    }
    return noThrash;
  }

  /**
   * The three sweeps start_town_mode runs over the town once it is populated,
   * **whichever way it was populated** (boe.town.cpp:318 and :435). They used
   * to live inside `populateTown`, where a restored town never saw them.
   *
   * Note the last one is not the same test as the creature's own
   * `spec_enc_code`: this is the SDF pair the scenario can set to retire a
   * character permanently, and it is checked on every entry.
   */
  private sweepTown(town: CurTown): void {
    const { party } = this.univ;
    // Large monsters placed somewhere they can't fit get dropped. Only large
    // ones — some small creatures are put where they can't be on purpose.
    for (const m of town.monsters)
      if (m.isAlive && (m.xWidth > 1 || m.yWidth > 1) && !this.monstCanBeThere(m))
        m.active = CreatureStatus.DEAD;

    for (const m of town.monsters)
      if (this.locOffActiveArea(m.curLoc)) m.active = CreatureStatus.DEAD;
    // Blanked in place rather than removed: the C++ sets `variety =
    // NO_ITEM` and keeps the slot, and a save file indexes items by slot.
    for (const item of town.items)
      if (this.locOffActiveArea(item.itemLoc)) item.variety = ItemType.NO_ITEM;

    for (const m of town.monsters)
      if (party.sdLegit(m.spec1, m.spec2) && party.getSdf(m.spec1, m.spec2) > 0)
        m.active = CreatureStatus.DEAD;
  }

  /**
   * erase_completed_specials (boe.town.cpp:1277) — every scripted square whose
   * SDF pair has been set to `SDF_COMPLETE` (250, the value a one-shot node
   * writes when it fires) loses its **special-spot marker**.
   *
   * Note what it does *not* do: the square keeps its entry in `special_locs`,
   * so `is_special` still finds the node and walking onto it still runs the
   * chain — which is the point, since the chain's own one-shot test is what
   * makes it a no-op. What goes away is the flag `is_spot` reads: the glyph on
   * the map, the "Special Encounter" line when you look, the extra square of
   * sight obscurity, and — the reason a replay notices — the **combat
   * blockage**, since `is_blocked` refuses to let anything stand on a marked
   * square during a fight.
   */
  private eraseCompletedSpecials(
    locs: SpecLoc[],
    specials: Map<number, SpecialNode>,
    isOnMap: (where: Location) => boolean,
    clearSpot: (where: Location) => void,
  ): void {
    const { party } = this.univ;
    for (let i = 0; i < locs.length; i++) {
      const at = locs[i]!;
      // The C++'s bounds test is `spec >= specials.size()`, over a vector with
      // gaps filled by default-constructed nodes; here the parsed nodes are a
      // sparse Map, so a node that isn't there is treated as out of range.
      const node = at.spec < 0 ? undefined : specials.get(at.spec);
      if (!node) continue;
      if (!party.sdLegit(node.sd1, node.sd2)) continue;
      if (party.getSdf(node.sd1, node.sd2) !== ONCE_DONE) continue;
      if (!isOnMap(at)) {
        // Kept, debug print and all: a scenario with a special pinned off the
        // edge of its own map gets repaired in place, once, out loud. (The
        // C++'s `beep()` is the system alert, which this port has no
        // equivalent of anywhere; the two messages are the whole of it here.)
        this.univ.addStringToBuf('Area corrupt. Problem fixed.');
        this.univ.addStringToBuf(`debug: ${at.x} ${at.y} ${i}`);
        at.spec = -1;
      }
      clearSpot(at);
    }
  }

  /**
   * erase_town_specials (boe.town.cpp:1230). Called from the tail of every
   * special chain and once more when a town is entered.
   *
   * The arena bails out: `which_combat_type == 0` is a fight with no town
   * under it, and its `univ.town` is scratch scenery whose markers nobody
   * should be editing.
   */
  eraseTownSpecials(): void {
    if (isCombat(this.mode) && this.whichCombatType === 0) return;
    if (!this.inTown && !isCombat(this.mode)) return;
    const town = this.univ.town;
    if (!town) return;
    this.eraseCompletedSpecials(
      town.record.specialLocs, town.record.specials,
      (where) => town.isOnMap(where.x, where.y),
      (where) => town.setField(where.x, where.y, FieldType.SPECIAL_SPOT, false));
  }

  /**
   * erase_out_specials (boe.town.cpp:1240) — the same pass over each of the
   * four sectors under the outdoor window, plus `erase_hidden_towns`, which is
   * what `SET_TOWN_VISIBILITY` has been waiting for: a town flagged unfindable
   * has its entrance square redrawn as the terrain's `flag1` (the plain ground
   * it is pretending to be), and one made findable again gets its entrance
   * back. The C++ does this here and nowhere else, so a scenario that hides a
   * town only sees it disappear once the chain that hid it finishes.
   */
  eraseOutSpecials(): void {
    const { party, scenario, out } = this.univ;
    for (let i = 0; i < 2; i++)
      for (let j = 0; j < 2; j++) {
        const sx = party.outdoorCorner.x + i;
        const sy = party.outdoorCorner.y + j;
        // quadrant_legal (boe.town.cpp:1615).
        if (sx < 0 || sy < 0 || sx >= scenario.outWidth || sy >= scenario.outHeight) continue;
        const sector = scenario.outdoors[sx]![sy]!;

        // erase_hidden_towns (boe.town.cpp:1256).
        for (const city of sector.cityLocs) {
          if (city.spec < 0 || city.spec >= scenario.towns.length) continue;
          if (city.x < 0 || city.y < 0 || city.x >= SECTOR_SIZE || city.y >= SECTOR_SIZE) continue;
          const area = sector.terrain[city.x]![city.y]!;
          if (this.univ.terrainType(area).special !== TerSpec.TOWN_ENTRANCE) continue;
          const canFind = scenario.towns[city.spec]!.canFind;
          out.set(SECTOR_SIZE * i + city.x, SECTOR_SIZE * j + city.y,
            canFind ? area : this.univ.terrainType(area).flag1);
        }

        this.eraseCompletedSpecials(
          sector.specialLocs, sector.specials,
          (where) => where.x >= 0 && where.y >= 0
            && where.x < SECTOR_SIZE && where.y < SECTOR_SIZE,
          (where) => { sector.specialSpot[where.x]![where.y] = false; });
      }
  }

  /**
   * The preset-item half of start_town_mode (boe.town.cpp:370). Items the
   * party has already taken stay gone unless the preset says "always there".
   *
   * **The stash goes down first.** A town named in the scenario's
   * `store_item_rects` starts from `univ.party.stored_items[town_number]`
   * rather than from an empty list (boe.town.cpp:384), and the presets are
   * appended after — so the order of `univ.town.items` is stash-then-presets,
   * which is the order the get-items screen builds its rows in and therefore
   * the order a recording's `itemN-key` names.
   */
  private placePresetItems(town: CurTown, townToast: boolean): void {
    const townNum = this.univ.party.townNum;
    town.items = this.univ.scenario.storeItemRects.has(townNum)
      ? (this.univ.party.storedItems.get(townNum) ?? []).map((it) => ({ ...it }))
      : [];
    const presets = town.record.presetItems;
    for (let i = 0; i < presets.length; i++) {
      const preset = presets[i]!;
      if (preset.code < 0) continue;
      const template = this.univ.scenario.scenItems[preset.code];
      if (!template) continue;
      // Don't put back a special item the party is already carrying, or a quest
      // it has already taken — the three tests in the C++'s source order.
      if (template.variety === ItemType.SPECIAL
        && this.univ.party.specItems.has(template.itemLevel)) continue;
      if (template.variety === ItemType.QUEST) {
        const job = this.univ.party.activeQuests.get(template.itemLevel);
        if (job && job.status !== QuestStatus.AVAILABLE) continue;
      }
      if (town.record.itemTaken[i] && !preset.alwaysThere) continue;

      const item: Item = { ...template, itemLoc: { ...preset.loc } };
      // **`preset.ability` is an `eEnchant`, not an `eItemAbil`**
      // (boe.town.cpp:415, and the field is declared `eEnchant ability` in
      // town.hpp). This port assigned it straight to `item.ability`, so a
      // preset marked "+3" laid down an item with `eItemAbil` 2 —
      // POISONED_WEAPON — on the floor. It is `enchant_weapon`, and only for
      // the two weapon varieties.
      if (preset.ability >= 0
        && (item.variety === ItemType.ONE_HANDED || item.variety === ItemType.TWO_HANDED)) {
        enchantWeapon(item, preset.ability as Enchant);
      }
      if (preset.charges > 0) {
        if (item.charges > 0) item.charges = preset.charges;
        else if (item.variety === ItemType.GOLD || item.variety === ItemType.FOOD)
          item.itemLevel = preset.charges;
      }
      // `if(town_toast) item.property = false; else item.property =
      // preset.property;` (boe.town.cpp:434) — **nothing in a town whose
      // population you have just wiped out belongs to anyone any more**, so a
      // massacre makes the shelves free to take.
      item.property = townToast ? false : preset.property;
      item.contained = preset.contained;
      // **`held` needs the crate to actually be there** (boe.town.cpp:440):
      // `if(item.contained && (is_barrel(x,y) || is_crate(x,y))) item.held =
      // true;`. The note this replaces said "without fields we can't tell" —
      // the fields have been in since M4, and a contained item on a square
      // whose crate a scenario has since removed is loose on the floor, not
      // still hidden.
      item.held = item.contained
        && (town.hasField(preset.loc.x, preset.loc.y, FieldType.OBJECT_BARREL)
          || town.hasField(preset.loc.x, preset.loc.y, FieldType.OBJECT_CRATE));
      item.isSpecial = i + 1;
      town.items.push(item);
    }

    // `for(auto& item : univ.town.items) if(loc_off_act_area(item.item_loc))
    // item.variety = NO_ITEM;` (boe.town.cpp:448) — the same sweep the
    // creatures get on the line above it. A town's active area is smaller than
    // its map, and anything a preset put in the border is not merely
    // unreachable, it is **deleted**, so it cannot be picked up by a
    // mass-get from just inside the edge.
    for (const item of town.items) {
      if (this.locOffActiveArea(item.itemLoc)) item.variety = ItemType.NO_ITEM;
    }
  }

  private monstCanBeThere(m: Creature): boolean {
    return this.monstCanBeAt(m, m.curLoc);
  }

  /**
   * monst_check_one_special_terrain (boe.monster.cpp:897) — may this creature
   * step onto this one square, and what does the square do to it on the way?
   *
   * `mode` is the C++'s: **1 in town, 2 in combat**. It decides two things —
   * whether a conveyor refuses the step, and whether a marked special spot is
   * off limits (it is, in town).
   *
   * **This draws, and that is the point.** `guts` — how enthusiastic the
   * creature is about walking into something nasty — is
   * `get_ran(1, 1, level / 2)` for anything that isn't mindless, on **every
   * attempted step**, whether or not there is anything nasty on the square.
   * Leaving the whole function out (it was marked for M5b) took that draw out of
   * the stream on every monster move, which is most of the draws a town turn
   * makes. Note the zero-width shortcut carries the weight here: a creature of
   * level 2 or 3 gives `get_ran(1,1,1)`, which returns without touching the
   * stream, so only level 4 and up actually draw.
   */
  private monstCheckOneSpecialTerrain(m: Creature, where: Location, mode: number): boolean {
    const town = this.univ.town;
    if (town === null) return false;
    const fromLoc = m.curLoc;
    const terNum = town.isOnMap(where.x, where.y)
      ? town.record.terrain[where.x]![where.y]! : 0;
    const ter = this.univ.terrainType(terNum);
    const terDir = ter.flag1 as Direction;
    let canEnter = true;
    let doLook = false;

    if (mode > 0 && ter.special === TerSpec.CONVEYOR) {
      if ((NO_MOVE_FROM_NORTH.has(terDir) && where.y > fromLoc.y)
        || (NO_MOVE_FROM_EAST.has(terDir) && where.x < fromLoc.x)
        || (NO_MOVE_FROM_SOUTH.has(terDir) && where.y < fromLoc.y)
        || (NO_MOVE_FROM_WEST.has(terDir) && where.x > fromLoc.x)) return false;
    }

    const mage = m.mon.mu > 0 || m.mon.cl > 0;
    let guts = m.mon.mindless ? 20 : this.univ.rng.getRan(1, 1, Math.trunc(m.mon.level / 2));
    guts += Math.trunc(m.health / 20);
    if (mage) guts = Math.trunc(guts / 2);
    if (m.attitude === Attitude.DOCILE) guts = Math.trunc(guts / 2);

    const has = (f: FieldType): boolean => town.hasField(where.x, where.y, f);
    if (has(FieldType.FIELD_ANTIMAGIC) && mage) return false;
    const radiate = m.mon.abil[MonstAbil.RADIATE];
    const haveRadiate = radiate?.active ?? false;
    const radiateType = radiate?.radiate?.type;
    /** The C++'s `!(have_radiate && which_radiate == X)` — its own radiation never scares it. */
    const notItsOwn = (f: FieldType): boolean => !(haveRadiate && radiateType === f);

    if (has(FieldType.WALL_FIRE) && notItsOwn(FieldType.WALL_FIRE) && guts < 3) return false;
    if (has(FieldType.WALL_FORCE) && notItsOwn(FieldType.WALL_FORCE) && guts < 4) return false;
    if (has(FieldType.WALL_ICE) && notItsOwn(FieldType.WALL_ICE) && guts < 5) return false;
    if (has(FieldType.CLOUD_SLEEP) && notItsOwn(FieldType.CLOUD_SLEEP) && guts < 8) return false;
    if (has(FieldType.WALL_BLADES) && notItsOwn(FieldType.WALL_BLADES) && guts < 8) return false;
    if (has(FieldType.FIELD_QUICKFIRE) && guts < 8) return false;
    if (has(FieldType.CLOUD_STINK) && notItsOwn(FieldType.CLOUD_STINK) && guts < 4) return false;
    if (has(FieldType.FIELD_WEB) && m.mon.race !== Race.BUG
      && notItsOwn(FieldType.FIELD_WEB) && guts < 3) return false;

    /** monster_placid (boe.monster.cpp:791). */
    const placid = m.attitude === Attitude.DOCILE
      || (m.attitude === Attitude.FRIENDLY && this.univ.party.hostilesPresent === 0);

    if (has(FieldType.BARRIER_FIRE)) {
      if (!m.isFriendly && this.univ.rng.getRan(1, 1, 100) < m.mon.mu * 10 + m.mon.cl * 4) {
        this.sound?.play(60);
        m.spellNote(SpellNote.BREAKS_BARRIER);
        town.setField(where.x, where.y, FieldType.BARRIER_FIRE, false);
      } else {
        if (guts < 6) return false;
        // Note the roll happens either way — `monster_placid` is checked second.
        if (this.univ.rng.getRan(1, 0, 10) < 8 || placid) canEnter = false;
      }
    }
    if (has(FieldType.BARRIER_FORCE)) {
      if (!m.isFriendly && this.univ.rng.getRan(1, 1, 100) < m.mon.mu * 10 + m.mon.cl * 4
        && !town.record.strongBarriers) {
        this.sound?.play(60);
        m.spellNote(SpellNote.BREAKS_BARRIER);
        town.setField(where.x, where.y, FieldType.BARRIER_FORCE, false);
      } else canEnter = false;
    }
    if (has(FieldType.BARRIER_CAGE)) canEnter = false;
    for (const thing of [FieldType.OBJECT_CRATE, FieldType.OBJECT_BARREL, FieldType.OBJECT_BLOCK]) {
      if (!has(thing)) continue;
      if (placid) canEnter = false;
      else this.pushThings(fromLoc, where);
    }
    // Monsters don't hop into bed when things are calm.
    if (placid && ter.special === TerSpec.BED) canEnter = false;
    if (mode === 1 && town.hasField(where.x, where.y, FieldType.SPECIAL_SPOT)) canEnter = false;
    if (terNum === 90) {
      // Terrain 90 is the protected "escape hatch"; a monster that reaches it
      // in a real fight leaves the map for good.
      if (isCombat(this.mode) && this.whichCombatType === 0) {
        m.active = CreatureStatus.DEAD;
        this.univ.addStringToBuf('Monster escaped! ');
      }
      return false;
    }

    switch (ter.special) {
      case TerSpec.CHANGE_WHEN_STEP_ON:
        canEnter = false;
        if (!placid) {
          town.record.terrain[where.x]![where.y] = ter.flag1;
          doLook = true;
          if (pointOnScreen(this.center, where)) this.sound?.play(ter.flag2);
        }
        break;
      case TerSpec.BLOCKED_TO_MONSTERS:
      case TerSpec.TOWN_ENTRANCE:
      case TerSpec.WATERFALL_CAVE:
      case TerSpec.WATERFALL_SURFACE:
        canEnter = false;
        break;
      case TerSpec.DAMAGING:
        // **Returns early, either way** — the rest of the function, `do_look`
        // included, is skipped for damaging ground.
        if (m.mon.resist[ter.flag3 as DamageType] === 0) return true;
        return m.mon.invuln;
      default:
        break;
    }

    if (doLook) {
      if (this.inTown) this.updateExplored(this.univ.party.townLoc);
      if (isCombat(this.mode)) {
        for (const pc of this.univ.party.pcs) {
          if (pc.isAlive) this.updateExplored(pc.combatPos);
        }
      }
    }
    return canEnter;
  }

  /**
   * monst_check_special_terrain (boe.monster.cpp:1074) — the same question for
   * every square a big creature would cover. `mode` is 1 in town, 2 in combat.
   *
   * Note it stops at the first refusal, so a two-square creature only rolls
   * `guts` twice when the first square let it through.
   */
  monstCheckSpecialTerrain(m: Creature, where: Location, mode: number): boolean {
    for (let x = where.x; x < where.x + m.xWidth; x++)
      for (let y = where.y; y < where.y + m.yWidth; y++)
        if (!this.monstCheckOneSpecialTerrain(m, loc(x, y), mode)) return false;
    return true;
  }

  /**
   * monst_can_be_there (boe.locutils.cpp) — could this creature stand with its
   * top-left corner on `where`? Every square it covers has to be on the map and
   * clear, and nothing else may already be standing there.
   */
  monstCanBeAt(m: Creature, where: Location): boolean {
    const town = this.univ.town;
    if (!town) return false;
    for (let i = 0; i < m.xWidth; i++)
      for (let j = 0; j < m.yWidth; j++) {
        const x = where.x + i;
        const y = where.y + j;
        const at = loc(x, y);
        if (this.locOffActiveArea(at)) return false;
        // is_blocked already covers terrain, the party, PCs, barriers and
        // cages; the only thing it gets wrong here is this creature itself.
        const other = town.monsterAt(at);
        if (other && other !== m) return false;
        if (!other && this.isBlocked(at)) return false;
        if (other === m && this.townIsBlocked(at)) return false;
      }
    return true;
  }

  /**
   * Everything end_town_mode does *before* it decides where the party comes
   * out (boe.town.cpp:551-592) — the half that runs whether it is walking off
   * the edge of the map or taking a staircase to another level, which is why
   * `change_level` goes through `end_town_mode` too (boe.specials.cpp:1414).
   *
   * The whole of it sits inside the C++'s `if(overall_mode == MODE_TOWN)`, so
   * a town left mid-fight is not remembered at all: its dead come back, and
   * its map goes unrecorded.
   */
  storeTownOnLeaving(): void {
    const town = this.univ.town;
    if (!town || this.mode !== GameMode.TOWN) return;
    const { party } = this.univ;

    this.saveTownPopulation();

    // The storage rectangle: everything real and non-special left inside it is
    // remembered (boe.town.cpp:578). `is_special == 0` is the whole filter —
    // a preset special item dropped in the stash is *not* kept, because
    // `start_town_mode` would place it again from the preset list.
    const rect = this.univ.scenario.storeItemRects.get(party.townNum);
    if (rect) {
      party.storedItems.set(party.townNum, town.items
        .filter((it) => it.variety !== ItemType.NO_ITEM && it.isSpecial === 0
          && it.itemLoc.x >= rect.left && it.itemLoc.x <= rect.right
          && it.itemLoc.y >= rect.top && it.itemLoc.y <= rect.bottom)
        .map((it) => ({ ...it })));
    }

    // Persist what the party mapped, so re-entering keeps it.
    for (let x = 0; x < town.record.maxDim; x++)
      for (let y = 0; y < town.record.maxDim; y++)
        if (town.isExplored(x, y)) town.record.maps[x]![y] = 1;

    // A party timer started by a TOWN_TIMER_START node dies with the town
    // (boe.town.cpp:590) — its node number indexes a list that's about to go
    // away. Scenario-level ones survive.
    party.partyEventTimers = party.partyEventTimers.filter(
      (t) => t.nodeType !== SpecCtxType.TOWN);
  }

  /**
   * end_town_mode (boe.town.cpp:536). Which boundary the party crossed picks
   * the outdoor exit; a town with no explicit exit for that side just steps
   * the party one tile further out.
   */
  /**
   * `end_town_mode(false, {0,0}, debug_leave = true)` (boe.town.cpp:546), the
   * arm the debug Leave Town key takes: the town is stored and the mode drops
   * to outdoors, but the boundary maths and the exit specials are **skipped**
   * — `if(!switching_level && !debug_leave)` guards the whole exit block — so
   * the party simply reappears wherever `out_loc` already says.
   */
  debugLeaveTown(): void {
    if (this.univ.town === null) return;
    this.univ.party.endSplit();
    this.storeTownOnLeaving();
    this.mode = GameMode.OUTDOORS;
    this.univ.departedTown = this.univ.town;
    this.univ.town = null;
    this.univ.party.townNum = TOWN_NUM_OUTDOORS;
    this.center = { ...this.univ.party.outLoc };
  }

  endTownMode(destination: Location): Location {
    const { party } = this.univ;
    const town = this.univ.town!;
    const rect = town.record.inTownRect;
    let toReturn = { ...party.outLoc };

    this.storeTownOnLeaving();

    // exits[] is indexed N, W, S, E (from the "nwse" dirs string).
    const applyExit = (idx: number, fallback: Location, nudge: Location): void => {
      const exit = town.record.exits[idx]!;
      toReturn = exit.x > 0 ? party.localToGlobal(exit) : fallback;
      party.outLoc = { x: toReturn.x + nudge.x, y: toReturn.y + nudge.y };
      // handle_leave_town_specials (boe.town.cpp:692): the exit this side of
      // the town uses. **Its location is `univ.party.out_loc`, not the square
      // the party walked off** — the C++ passes a `start_loc` it then ignores,
      // and reads the out_loc assigned on the line above. A town node that asks
      // where it is (or writes terrain there) was getting town coordinates.
      if (exit.spec >= 0)
        void this.runSpecial(SpecCtx.LEAVE_TOWN, SpecCtxType.TOWN, exit.spec, { ...party.outLoc });
    };

    if (destination.x <= rect.left)
      applyExit(1, loc(toReturn.x - 1, toReturn.y), loc(1, 0));
    else if (destination.x >= rect.right)
      applyExit(3, loc(toReturn.x + 1, toReturn.y), loc(-1, 0));
    else if (destination.y <= rect.top)
      applyExit(0, loc(toReturn.x, toReturn.y - 1), loc(0, 1));
    else if (destination.y >= rect.bottom)
      applyExit(2, loc(toReturn.x, toReturn.y + 1), loc(0, -1));

    this.mode = GameMode.OUTDOORS;
    // `end_town_mode`'s `erase_out_specials()` (boe.town.cpp:668), right after
    // the mode changes back.
    this.eraseOutSpecials();
    this.univ.addStringToBuf(`You leave ${town.record.name}.`);
    this.univ.departedTown = town;
    this.univ.town = null;
    party.townNum = TOWN_NUM_OUTDOORS;
    // applyExit has already put the party one step *inside* the exit square;
    // the caller then walks it out onto `toReturn`, which is what makes the
    // party appear at the town's gate rather than wherever it happened to be
    // standing on the world map (boe.town.cpp:608).
    party.outLoc = clampToWindow(party.outLoc);
    party.iwc = { x: party.outLoc.x > 47 ? 1 : 0, y: party.outLoc.y > 47 ? 1 : 0 };
    party.locInSec = party.globalToLocal(party.outLoc);
    this.center = { ...party.outLoc };
    this.updateExplored(party.outLoc);
    // handle_action's `if(left_town) try_auto_save("ExitTown")`
    // (boe.actions.cpp:813). Here the leaving is unconditional by this point.
    tryAutoSave('ExitTown');
    return clampToWindow(toReturn);
  }

  // ------------------------------------------------------------------ maps

  /**
   * update_explored (boe.locutils.cpp:230) — reveal what the party can see
   * from `where`: the 9x9 block around it, minus anything sight-blocked.
   */
  /**
   * loc_off_act_area — outside the town's playable rectangle. Note the
   * comparisons are strict, so the border row and column count as off it.
   */
  locOffActiveArea(where: Location): boolean {
    const rect = this.univ.town?.record.inTownRect;
    if (!rect) return false;
    return !(where.x > rect.left && where.x < rect.right
      && where.y > rect.top && where.y < rect.bottom);
  }

  updateExplored(where: Location): void {
    const { out } = this.univ;
    const town = this.univ.town;
    if (town) {
      town.makeExplored(where.x, where.y);
      for (let x = Math.max(0, where.x - 4); x < Math.min(town.record.maxDim, where.x + 5); x++)
        for (let y = Math.max(0, where.y - 4); y < Math.min(town.record.maxDim, where.y + 5); y++)
          if (
            !town.isExplored(x, y) &&
            this.canSeeLight(where, loc(x, y)) < SIGHT_BLOCKED &&
            this.ptInLight(where, loc(x, y))
          )
            town.makeExplored(x, y);
      return;
    }
    // Outdoors, 2 marks "stood on" and 1 "seen from a distance".
    out.explored[where.x]![where.y] = 2;
    for (let x = where.x - 4; x < where.x + 5; x++)
      for (let y = where.y - 4; y < where.y + 5; y++)
        if (out.isOnMap(x, y) && out.explored[x]![y] === 0)
          if (this.canSeeLight(where, loc(x, y)) < SIGHT_BLOCKED) out.explored[x]![y] = 1;
  }
}

/**
 * cTown::is_cleaned_out (town.cpp:191) — the party has killed as many of this
 * town's creatures as the scenario said it takes to empty it. A negative
 * `maxNumMonst` means the town can never be cleaned out.
 */
function isCleanedOut(record: Town): boolean {
  if (record.maxNumMonst < 0) return false;
  return record.monstersKilled >= record.maxNumMonst;
}

function clampToWindow(where: Location): Location {
  return loc(
    Math.max(0, Math.min(OUT_MAX_DIM - 1, where.x)),
    Math.max(0, Math.min(OUT_MAX_DIM - 1, where.y)),
  );
}

export { OUT_HALF_DIM, SECTOR_SIZE };
