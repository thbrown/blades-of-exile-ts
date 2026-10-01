/**
 * The AFFECT opcode group — affect_spec (boe.specials.cpp:2726). These act on
 * the party or on one chosen member.
 *
 * Two conventions run through the whole group:
 *  - **ex1b is the sign.** 0 means give/heal/add, anything else means
 *    take/harm/subtract.
 *  - **The target is the whole party unless SELECT_TARGET picked someone.**
 *    `ctx.curTarget` holds that choice; null means everyone.
 */

import { SpecType } from '../../data/special';
import { SKILL_MAX } from '../../data/shop';
import { MAX_FOOD, MAX_GOLD } from '../../universe/party';
import { Enchant, enchantWeapon } from '../../data/enchant';
import { GiveEquip, GiveStatus, giveItem, takeItem } from '../../universe/inventory';
import { NUM_INVEN_SLOTS, Player } from '../../universe/player';
import { ItemType } from '../../data/item';
import { MainStatus, PartyStatus, Skill, Status, Trait } from '../../universe/skills';
import { Creature } from '../../universe/creature';
import { isCombat } from '../modes';
import { recordMonst } from '../soulCrystal';
import { Universe } from '../../universe/universe';
import { drainPc, poisonWeapon } from '../itemUse';
import { newPc } from '../createPc';
import { DamageType } from '../../data/monster';
import { Race } from '../../universe/skills';
import { awardXp, hitParty } from '../damage';
import { damageTarget } from '../combat';
import { SpecialCtx, TARGET_PARTY, defaultTarget } from './context';
import { SELECT_PC_CANCEL, SelectPcMode, runSelectPc } from '../selectPc';
import { reportUnsupported } from './general';
import { handleMessage } from './vm';
import { showError } from '../showError';

/**
 * The creature a `pc_num` of 100 or more names — `univ.town.monst[i - 100]`,
 * which is how the AFFECT opcodes that act on a monster reach one. Returns
 * null for a PC target, which is the `if(pc_num < 100) break;` those opcodes
 * open with.
 */
function monsterAt(univ: Universe, target: number): Creature | null {
  if (target < 100) return null;
  return univ.town?.monsters[target - 100] ?? null;
}

function clamp(lo: number, hi: number, v: number): number {
  return Math.max(lo, Math.min(hi, v));
}

export async function affectSpec(univ: Universe, ctx: SpecialCtx): Promise<void> {
  const spec = ctx.curSpec;
  const { party } = univ;
  let checkMess = true;
  ctx.nextSpec = spec.jumpto;

  /**
   * Everyone the node applies to. `SELECT_TARGET`'s pick if there was one,
   * otherwise `current_pc_picked_in_spec_enc`'s default — which is the **active
   * PC in combat**, not the party.
   */
  const target = ctx.curTarget
    ?? defaultTarget(univ, ctx.session, ctx.whichMode, ctx.specLoc);
  const targets = (): Player[] => {
    if (target >= 0 && target < 6) {
      const pc = party.pcs[target];
      return pc ? [pc] : [];
    }
    return party.pcs;
  };
  /**
   * **`if(pc_num >= 100) break;`** — nine of the AFFECT opcodes open with it
   * (boe.specials.cpp:2937, :2947, :3088, :3122, :3139, :3193, :3203, :3255
   * and `GIVE_ITEM` at :3352): a special whose target is a **monster** does
   * nothing at all, rather than falling back to the whole party.
   *
   * `targets()` alone cannot express that, because `pc_num == 6` and
   * `pc_num >= 100` both fail its `< 6` test and the C++ treats them
   * oppositely — 6 is everyone, 100-plus is nobody. Leaving it out ran
   * `AFFECT_XP` over all six PCs where the C++ ran it over none, and
   * `award_xp` draws.
   */
  const monsterTarget = target >= 100;
  /** ex1b picks the direction: 0 up, anything else down. */
  const signed = (amount: number): number => amount * (spec.ex1b !== 0 ? -1 : 1);

  switch (spec.type) {
    case SpecType.SELECT_TARGET: {
      checkMess = false;
      // ex1a picks the mode (boe.specials.cpp:2742): 0 any PC, 1 a living one,
      // 2 the whole party, 3 a dead one, 4 one with room in their pack. The
      // party arm asks nothing, and **`i` stays 0 there** — which is why it
      // doesn't take the cancel branch below.
      let who = 0;
      if (spec.ex1a === 2) ctx.curTarget = null;
      else if (spec.ex1a >= 10 && spec.ex1a < 16) {
        // An blades-of-exile-ts extension, not in OBoE: 10–15 pick PC 0–5 without
        // asking. The C++ has no arm for them (they ask nobody and change
        // nothing), so no BoE scenario can mean anything else by them. Exile 3
        // needs it for scripts that change each PC by its own skills, which
        // no party-wide node can express (tools/e3convert, `SpecBuilder.eachPc`).
        ctx.curTarget = spec.ex1a - 10;
      } else {
        const modes: Record<number, SelectPcMode> = {
          0: SelectPcMode.ANY,
          1: SelectPcMode.ONLY_LIVING,
          3: SelectPcMode.ONLY_DEAD,
          4: SelectPcMode.ONLY_LIVING_WITH_ITEM_SLOT,
        };
        const mode = modes[spec.ex1a];
        // An ex1a the C++ has no arm for asks nobody and leaves the target as
        // it was, `i` still 0.
        if (mode !== undefined) {
          who = await runSelectPc(ctx.session.univ, mode, '',
            (options, title, highlight) => ctx.host.selectPc(options, title, highlight));
          // *Divergence, and deliberate*: the C++ tests `i != 6` and then
          // indexes `univ.party[i]`, so an 8 — nobody could be offered — reads
          // one past the end of the party. This treats it as "no one chosen".
          if (who !== SELECT_PC_CANCEL) ctx.curTarget = who < 6 ? who : null;
        }
      }
      // Cancelling jumps to ex1b — note 8 ("nobody could be offered") does not,
      // because the test is `== 6` and not `>= 6`.
      if (who === SELECT_PC_CANCEL) ctx.nextSpec = spec.ex1b;
      break;
    }

    case SpecType.DAMAGE: {
      // ex1a d ex1b + ex2a, of damage type ex2b. **`ex2c` is a sound type and
      // is passed negated** (boe.specials.cpp:2862), which is how the C++ asks
      // for an asynchronous sound; 0 or less means the default.
      const amount = univ.rng.getRan(spec.ex1a, 1, spec.ex1b) + spec.ex2a;
      const damType = spec.ex2b as DamageType;
      const sndType = spec.ex2c <= 0 ? 0 : -spec.ex2c;
      // **`pc_num == 6` exactly**, not `>= 6` (boe.specials.cpp:2889): the
      // party is 6 and a creature is 100 + its slot, and only the party gets
      // `hit_party`.
      if (target !== TARGET_PARTY) {
        const pc = party.pcs[target];
        if (pc) {
          await damageTarget(
            univ, pc, amount, damType, 6, Race.UNKNOWN, true, ctx.session, sndType);
        }
      } else {
        await hitParty(univ, amount, damType, sndType);
      }
      break;
    }

    case SpecType.AFFECT_HP:
      for (const pc of targets()) pc.heal(signed(spec.ex1a));
      break;

    case SpecType.AFFECT_HP_PERCENT:
      // Exile III's `cur_health / 2` for all six PCs, whatever their state
      // (DIVERGENCES.md #22). Set directly: `heal` stops at the maximum.
      if (monsterTarget) break;
      for (const pc of targets()) pc.curHealth = Math.trunc((pc.curHealth * spec.ex1a) / 100);
      break;

    case SpecType.AFFECT_TAKE_MAGIC_ITEMS: {
      // Exile III's Great Circle (DIVERGENCES.md #22): the living PCs' packs,
      // last slot first so the compaction skips nothing, curses or not; then,
      // with ex1a 1, whatever lies in the town.
      if (monsterTarget) break;
      for (const pc of targets()) {
        if (pc.mainStatus !== MainStatus.ALIVE) continue;
        for (let slot = NUM_INVEN_SLOTS - 1; slot >= 0; slot--) {
          const item = pc.items[slot];
          if (!item || item.variety === ItemType.NO_ITEM || !item.magic) continue;
          pc.equip[slot] = false;
          takeItem(pc, slot);
        }
      }
      if (spec.ex1a === 1) {
        for (const item of univ.town?.items ?? [])
          if (item.variety !== ItemType.NO_ITEM && item.magic) item.variety = ItemType.NO_ITEM;
      }
      ctx.redraw = true;
      break;
    }

    case SpecType.AFFECT_SP:
      for (const pc of targets()) {
        if (spec.ex1b === 0) pc.restoreSp(spec.ex1a);
        else pc.curSp = Math.max(0, pc.curSp - spec.ex1a);
      }
      break;

    case SpecType.AFFECT_XP:
      if (monsterTarget) break;
      // boe.specials.cpp:2936. **Three arms, and the middle one is
      // `award_xp`, not an addition** — which is the whole point: `award_xp`
      // scales the amount by the PC's level bracket, may lose a point to a
      // `get_ran(1,1,100)` roll past level 7, and then **levels the PC up as
      // far as it takes them**, rolling `get_ran(1,2,6)` for health at each
      // step. This port added the number to `experience` and drew nothing, so
      // a scenario handing out experience left the two engines several draws
      // and one level apart. `true` is the `force` flag: a scenario may hand
      // out more than the 200 the sanity check refuses.
      for (const pc of targets()) {
        const i = univ.party.pcs.indexOf(pc);
        if (spec.ex1a < 0) pc.experience = pc.level * pc.getTnl();
        else if (spec.ex1b === 0) awardXp(univ, i, spec.ex1a, true);
        else drainPc(pc, spec.ex1a);
      }
      break;

    case SpecType.AFFECT_SKILL_PTS:
      if (monsterTarget) break;
      for (const pc of targets())
        pc.skillPts = clamp(0, 100, pc.skillPts + signed(spec.ex1a));
      break;

    case SpecType.AFFECT_STAT: {
      if (monsterTarget) break;
      if (spec.ex2a < 0 || spec.ex2a > 20) {
        univ.addStringToBuf('Skill is out of range.');
        break;
      }
      const skill = spec.ex2a as Skill;
      for (const pc of targets()) {
        // pic is a per-PC percentage chance that it lands.
        if (univ.rng.getRan(1, 1, 100) >= spec.pic) continue;
        const adj = signed(spec.ex1a);
        if (skill === Skill.MAX_HP) pc.maxHealth = clamp(6, 250, pc.maxHealth + adj);
        else if (skill === Skill.MAX_SP) pc.maxSp = clamp(0, 150, pc.maxSp + adj);
        else pc.skills[skill] = clamp(0, SKILL_MAX[skill] ?? 20, (pc.skills[skill] ?? 0) + adj);
      }
      break;
    }

    case SpecType.AFFECT_LEVEL:
      if (monsterTarget) break;
      for (const pc of targets()) pc.level = Math.max(1, pc.level + signed(spec.ex1a));
      break;

    case SpecType.AFFECT_DEADNESS:
      for (const pc of targets()) {
        if (spec.ex1b === 0) {
          // Restoring: anything short of "absent" comes back alive.
          if (pc.mainStatus > MainStatus.ABSENT && pc.mainStatus < MainStatus.SPLIT)
            pc.mainStatus = MainStatus.ALIVE;
        } else {
          const KILL: Record<number, MainStatus> = {
            0: MainStatus.DEAD, 1: MainStatus.DUST, 2: MainStatus.STONE,
            3: MainStatus.FLED, 5: MainStatus.ABSENT,
          };
          const to = KILL[spec.ex1a];
          if (to !== undefined) pc.mainStatus = to;
        }
      }
      ctx.redraw = true;
      break;

    case SpecType.AFFECT_STATUS: {
      if (monsterTarget) break;
      // affect_spec's AFFECT_STATUS (boe.specials.cpp:2981) routes each
      // status through its own iLiving method rather than nudging the raw
      // number — that's what prints "X poisoned."/"X diseased." and rolls
      // frailty/protection/save-vs-level, so a generic add-and-clamp landed
      // the status with no visible effect at all.
      // The status type lives in ex1c, not ex2a — a slip in the first pass
      // at this fix, and exactly why "you feel ill" still did nothing after
      // it: ex2a is -1 on a real node (unused), so the range guard below
      // caught it and bailed before ever reaching the switch.
      if (spec.ex1c < 0 || spec.ex1c > 15) break;
      const status = spec.ex1c as Status;
      const give = spec.ex1b === 0;
      const amount = spec.ex1a;
      for (const pc of targets()) {
        if (pc.mainStatus !== MainStatus.ALIVE) continue;
        switch (status) {
          case Status.POISON:
            if (give) pc.cure(amount); else pc.poison(amount, univ.rng);
            break;
          case Status.HASTE_SLOW:
            pc.slow(give ? -amount : amount);
            break;
          case Status.INVULNERABLE:
            pc.applyStatus(Status.INVULNERABLE, give ? amount : -amount);
            break;
          case Status.MAGIC_RESISTANCE:
            pc.applyStatus(Status.MAGIC_RESISTANCE, give ? amount : -amount);
            break;
          case Status.WEBS:
            if (give) pc.applyStatus(Status.WEBS, -amount); else pc.web(amount);
            break;
          case Status.DISEASE:
            if (give) pc.applyStatus(Status.DISEASE, -amount); else pc.disease(amount, univ.rng);
            break;
          case Status.INVISIBLE:
            pc.applyStatus(Status.INVISIBLE, give ? amount : -amount);
            break;
          case Status.BLESS_CURSE:
            pc.curse(give ? -amount : amount);
            break;
          case Status.DUMB:
            if (give) pc.applyStatus(Status.DUMB, -amount); else pc.dumbfound(amount, univ.rng);
            break;
          case Status.ASLEEP:
            if (give) pc.applyStatus(Status.ASLEEP, -amount);
            else pc.sleep(Status.ASLEEP, amount, 10, univ.rng);
            break;
          case Status.PARALYZED:
            if (give) pc.applyStatus(Status.PARALYZED, -amount);
            else pc.sleep(Status.PARALYZED, amount, 10, univ.rng);
            break;
          case Status.POISONED_WEAPON: {
            const pcNum = party.pcs.indexOf(pc);
            if (give) pc.applyStatus(Status.POISONED_WEAPON, -amount);
            else poisonWeapon(univ, pcNum, amount, true);
            break;
          }
          case Status.MARTYRS_SHIELD:
            pc.applyStatus(Status.MARTYRS_SHIELD, give ? amount : -amount);
            break;
          case Status.ACID:
            if (give) pc.applyStatus(Status.ACID, -amount); else pc.acid(amount);
            break;
          case Status.FORCECAGE:
            // `if(is_out()) break;` (boe.specials.cpp:880) — the **mode**, not
            // `party.town_num`. In an outdoor arena fight the mode is COMBAT
            // and the town number is 200, so the C++ still cages you and
            // `isInTown()` would not have.
            if (!ctx.session.isOutdoors) {
              if (give) pc.applyStatus(Status.FORCECAGE, -amount);
              else pc.sleep(Status.FORCECAGE, amount, 10, univ.rng);
            }
            break;
          // MAIN and CHARM aren't valid targets here (kept, matching the C++).
          case Status.MAIN:
          case Status.CHARM:
            break;
        }
      }
      ctx.redraw = true;
      break;
    }

    /**
     * `AFFECT_TRAITS` (boe.specials.cpp:3254) — **`traits[ex1a] = !ex1b`**, so
     * a zero `ex1b` *gives* the trait and anything else takes it away. The
     * same inversion `AFFECT_MAGE_SPELL` below uses, and the same one a reader
     * gets backwards.
     */
    case SpecType.AFFECT_TRAITS: {
      if (monsterTarget) break;
      if (spec.ex1a < 0 || spec.ex1a > 16) {
        showError(univ, 'Trait is out of range (0 - 16).');
        break;
      }
      for (const pc of targets()) pc.traits[spec.ex1a as Trait] = !spec.ex1b;
      break;
    }

    /**
     * `AFFECT_AP` (:3264) — action points, **in combat only**, and floored at
     * zero rather than allowed negative.
     *
     * Note it does not go through `targets()`: the C++ tests `pc_num == 6` for
     * the whole party and otherwise uses `pc` directly, so a target of 100 or
     * more — a monster — reaches `pc.ap` on something that is not a PC. This
     * port reads the same shape but keeps a creature out of it, since `ap`
     * here belongs to `Player`.
     */
    case SpecType.AFFECT_AP: {
      if (!isCombat(ctx.session.mode)) break;
      if (monsterTarget) break;
      for (const pc of targets()) {
        pc.ap += spec.ex1b ? spec.ex1a : -spec.ex1a;
        if (pc.ap < 0) pc.ap = 0;
      }
      break;
    }

    /**
     * `AFFECT_MORALE` (:3155) — **`pc.scare(...)`, and `cPlayer::scare` does
     * nothing** (pc.cpp:118). So aimed at a PC this node is a no-op, and it is
     * only a node at all because the same `pc` reference can be a creature.
     * Note there is no `pc_num` guard on it either way.
     *
     * `ex1b != 0` *raises* morale here, which is the opposite of `signed`'s
     * convention everywhere else in this switch.
     */
    case SpecType.AFFECT_MORALE: {
      const monst = monsterAt(univ, target);
      if (monst) monst.scare(spec.ex1a * (spec.ex1b !== 0 ? 1 : -1));
      break;
    }

    /**
     * `AFFECT_PARTY_STATUS` (:3242) — **and it is written wrong in the C++.**
     * It reads the current value out of `status[ex2a]`, adds or subtracts, and
     * then always writes the result back to **`status[STEALTH]`**. So a node
     * that means to grant Flight reads Flight's counter and stores it as
     * Stealth, and Flight never changes.
     *
     * Kept, because a scenario that ships with this node has been tested
     * against the behaviour and not the intent. The boat and horse refusals
     * above it print their line and then fall through to do the wrong thing
     * anyway, which is the C++'s `else if` chain ending without a `break`.
     */
    case SpecType.AFFECT_PARTY_STATUS: {
      if (spec.ex2a < 0 || spec.ex2a > 3) break;
      if (spec.ex1b === 0 && spec.ex2a === 1) {
        if (party.inBoat >= 0) univ.addStringToBuf("  Can't fly when on a boat.");
        else if (party.inHorse >= 0) univ.addStringToBuf("  Can't fly when on a horse.");
      }
      const was = party.partyStatus[spec.ex2a as PartyStatus] ?? 0;
      const now = clamp(0, 250, spec.ex1b === 0 ? was + spec.ex1a : was - spec.ex1a);
      party.partyStatus[PartyStatus.STEALTH] = now;
      break;
    }

    /**
     * `AFFECT_SOUL_CRYSTAL` (:3233) — a **monster-targeted** node. `ex1a == 0`
     * records the creature into a crystal (`ex1b` forces it over a full set);
     * anything else frees every crystal holding that creature's species.
     */
    case SpecType.AFFECT_SOUL_CRYSTAL: {
      const monst = monsterAt(univ, target);
      if (!monst) break;
      if (spec.ex1a === 0) recordMonst(univ, monst, spec.ex1b !== 0);
      else {
        party.imprisonedMonst = party.imprisonedMonst.map(
          (n) => (n === monst.number ? 0 : n));
      }
      break;
    }

    /** `AFFECT_MONST_TARG` (:3346) — who a creature is going for. */
    case SpecType.AFFECT_MONST_TARG: {
      const monst = monsterAt(univ, target);
      // The C++ carries its own "TODO: Verify this actually works! It's
      // possible the monster ignores this and just recalculates its target
      // each turn." — `monst_pick_target` does exactly that whenever the
      // creature has no reason to keep the one it has.
      if (monst) monst.target = spec.ex1a;
      break;
    }

    /**
     * `AFFECT_MONST_ATT` (:3158) — shift one of a creature's three attacks.
     * `ex1b` is dice and `ex1c` sides; `ex2a` non-zero subtracts instead.
     */
    case SpecType.AFFECT_MONST_ATT: {
      const monst = monsterAt(univ, target);
      if (!monst) break;
      if (spec.ex1a < 0 || spec.ex1a > 2) {
        univ.addStringToBuf('Invalid monster attack (0-2).');
        break;
      }
      const attack = monst.mon.attacks[spec.ex1a];
      if (!attack) break;
      const sign = spec.ex2a === 0 ? 1 : -1;
      attack.dice += sign * spec.ex1b;
      attack.sides += sign * spec.ex1c;
      break;
    }

    /**
     * `AFFECT_MONST_STAT` (:3172) — one of seven numbers on a creature, by
     * index. **`ex1b > 0` negates**, and the C++ does it by reusing `pc_num`
     * as scratch ("Blah, let's hackily reuse pc_num...").
     *
     * Stat 0 is `m_health`, the creature's *maximum*, not its current — so a
     * node that "heals" this way raises the ceiling and leaves the wound.
     */
    case SpecType.AFFECT_MONST_STAT: {
      const monst = monsterAt(univ, target);
      if (!monst) break;
      if (spec.ex2a < 0 || spec.ex2a > 7) {
        univ.addStringToBuf('Invalid monster stat (0-7).');
        break;
      }
      const by = spec.ex1b > 0 ? -spec.ex1a : spec.ex1a;
      switch (spec.ex2a) {
        case 0: monst.maxHealth += by; break;
        case 1: monst.maxMp += by; break;
        case 2: monst.mon.armor += by; break;
        case 3: monst.mon.skill += by; break;
        case 4: monst.mon.speed += by; break;
        case 5: monst.mon.mu += by; break;
        case 6: monst.mon.cl += by; break;
        // 7 passes the range check and has no arm. The C++'s switch is the
        // same shape; kept.
        default: break;
      }
      break;
    }

    case SpecType.AFFECT_MAGE_SPELL:
    case SpecType.AFFECT_PRIEST_SPELL: {
      if (monsterTarget) break;
      if (spec.ex1a < 0 || spec.ex1a > 61) {
        univ.addStringToBuf('Spell is out of range (0 - 61).');
        break;
      }
      for (const pc of targets()) {
        const book = spec.type === SpecType.AFFECT_MAGE_SPELL ? pc.mageSpells : pc.priestSpells;
        book[spec.ex1a] = !spec.ex1b;
      }
      break;
    }

    case SpecType.AFFECT_ALCHEMY:
      if (spec.ex1a < 0 || spec.ex1a > 19) univ.addStringToBuf('Alchemy is out of range.');
      else party.alchemy[spec.ex1a] = !spec.ex1b;
      break;

    case SpecType.AFFECT_GOLD:
      if (spec.ex1b === 0) {
        party.gold = Math.min(MAX_GOLD, party.gold + spec.ex1a);
        univ.addStringToBuf(`  You get ${spec.ex1a} gold.`);
      } else party.gold = Math.max(0, party.gold - spec.ex1a);
      break;

    case SpecType.AFFECT_FOOD:
      if (spec.ex1b === 0) {
        party.food = Math.min(MAX_FOOD, party.food + spec.ex1a);
        univ.addStringToBuf(`  You get ${spec.ex1a} food.`);
      } else party.food = Math.max(0, party.food - spec.ex1a);
      break;

    case SpecType.GIVE_ITEM: {
      // `if(pc_num >= 100) break;` (boe.specials.cpp:3352) — a node aimed at a
      // creature gives nothing.
      if (monsterTarget) break;
      const template = univ.scenario.scenItems[spec.ex1a];
      if (!template) break;
      const item = { ...template };
      // **The node's six extras are six edits to the item**, and this port made
      // none of them: it handed over the scenario's copy unchanged.
      //
      // `ex1b` is an `eEnchant`, so a node can hand out a +2 sword without the
      // scenario carrying one. The range test is the C++'s and is **one short**
      // — `<= 6` stops at BLESSED and can never reach PLUS_FOUR, which is 7
      // because the table grew by appending. Kept.
      if (spec.ex1b >= 0 && spec.ex1b <= 6) enchantWeapon(item, spec.ex1b as Enchant);
      if (item.charges > 0 && spec.ex1c >= 0) item.charges = spec.ex1c;
      // `ex2a`: 0 unidentified, 1 identified, 2 identified *and* revealed.
      if (spec.ex2a === 1 || spec.ex2a === 2) item.ident = true;
      else if (spec.ex2a === 0) item.ident = false;
      if (spec.ex2a === 2) item.concealed = false;
      // `ex2b`: cursed and unsellable move together.
      if (spec.ex2b === 1) item.cursed = item.unsellable = true;
      else if (spec.ex2b === 0) item.cursed = item.unsellable = false;
      // `ex2c` picks how hard `give_item` tries to *wear* what it hands over.
      // A negative one leaves `equip_type` at 0 — don't equip at all — which
      // is the only value every other caller in the game uses.
      let equipType = GiveEquip.NONE;
      if (spec.ex2c === 0) equipType = GiveEquip.SOFT;
      else if (spec.ex2c === 1) equipType = GiveEquip.TRY;
      else if (spec.ex2c >= 2) equipType = GiveEquip.FORCE;

      // **Every targeted PC gets one**, not the first with room: `pc_num == 6`
      // means all six, and the C++ loops over the whole party. `GIVE_ALLOW_OVERLOAD`
      // rides along, so weight never refuses it — and `GIVE_DO_PRINT` does
      // *not*, so the "  Thissa gets a Bronze Sword." line a shop prints is
      // silent here. The node's own message is what the player sees.
      let success = true;
      for (const pc of targets()) {
        const result = giveItem(pc, party, { ...item }, false, true, equipType);
        if (result.status !== GiveStatus.OK) success = false;
      }
      // `if(!success) ctx.next_spec = spec.pic;` — the node's picture field is
      // a *jump* here, taken when anyone's pack was full.
      if (!success) ctx.nextSpec = spec.pic;
      ctx.redraw = true;
      break;
    }

    case SpecType.AFFECT_NAME:
      // The node names the PC after one of the scenario's strings.
      for (const pc of targets()) {
        const name = univ.getStr(ctx.curSpecType, spec.m1);
        if (name) pc.name = name;
      }
      break;

    /**
     * `CREATE_NEW_PC` (boe.specials.cpp:3292) — a whole character out of the
     * node's own numbers: no dialogs, no `finish_create`, so no racial
     * adjustments and none of the two start items `create_pc` hands out.
     *
     * `ex1a`/`ex1b` are health and spell points (both current *and* maximum),
     * `ex1c` the race, `ex2a`/`ex2b`/`ex2c` strength, dexterity and
     * intelligence, `pic` the portrait and `m3` the name string. Everything
     * else is `new_pc`'s blank: level 1, 65 skill points, the thirty basic
     * spells on both lists.
     *
     * **`pictype` is a jump, not a picture** — the field standing in for a
     * number the way `GIVE_ITEM`'s `pic` does — taken when the party is full.
     */
    case SpecType.CREATE_NEW_PC: {
      if (spec.ex1c < 0 || spec.ex1c > 19) {
        univ.addStringToBuf('Race out of range (0 - 19).');
        break;
      }
      const spot = party.freeSpace();
      if (spot === 6) {
        univ.addStringToBuf('No room for new PC.');
        ctx.nextSpec = spec.pictype;
        checkMess = false;
        break;
      }
      const name = univ.getStr(ctx.curSpecType, spec.m3);
      const pc = newPc(univ, spot);
      pc.name = name ?? '';
      pc.whichGraphic = spec.pic;
      pc.curHealth = pc.maxHealth = spec.ex1a;
      pc.curSp = pc.maxSp = spec.ex1b;
      pc.race = spec.ex1c as Race;
      pc.skills[Skill.STRENGTH] = spec.ex2a;
      pc.skills[Skill.DEXTERITY] = spec.ex2b;
      pc.skills[Skill.INTELLIGENCE] = spec.ex2c;
      ctx.curTarget = spot;
      // **The SDF gets `unique_id - 1000`, not the id itself** — the ids start
      // at 1000 (`nextPcId`), and an SDF cell is a byte, so this is what an
      // `UNSTORE_PC` later reads back and adds the 1000 to.
      if (party.sdLegit(spec.sd1, spec.sd2))
        party.setSdf(spec.sd1, spec.sd2, pc.uniqueId - 1000);
      break;
    }

    /**
     * `STORE_PC` (boe.specials.cpp:3318) — take a character out of the party
     * and keep them, with their items and levels, until an `UNSTORE_PC` asks
     * for them back.
     *
     * **The slot is not emptied.** It gets a blank `new_pc`, and `new_pc` ends
     * by setting `ALIVE` (party.cpp:354) — so a stored character leaves a
     * nameless level-1 stranger with 6 health standing in the party, and
     * `freeSpace` will *not* reuse the slot, because it only counts `ABSENT`.
     * A full party therefore cannot unstore anyone it just stored; the round
     * trip needs a slot that was never filled. Kept, bug and all: a scenario
     * shipping this node was tested against the behaviour.
     *
     * **`ex1a == 1` records and does not store**: the UID goes into the SDF
     * and the PC stays where they are. That is how a scenario notes *which*
     * character it is about to act on before deciding.
     *
     * A monster or whole-party target does nothing at all — the C++'s
     * `dynamic_cast<cPlayer*>` simply fails.
     */
    case SpecType.STORE_PC: {
      if (target < 0 || target >= 6) break;
      const pc = party.pcs[target];
      if (!pc) break;
      if (party.sdLegit(spec.sd1, spec.sd2))
        party.setSdf(spec.sd1, spec.sd2, pc.uniqueId - 1000);
      if (spec.ex1a === 1) break;
      // `main_status += SPLIT` — the stored PC is "left behind" in the same
      // sense a split party's stragglers are, which is what `pc_present` and
      // the party-death check read.
      pc.mainStatus += MainStatus.SPLIT;
      // `remove_pc` nulls the PC's back-pointer before moving them out
      // (party.cpp:345), which is what keeps `getLoc` from resolving a
      // location for somebody who is not in the party any more.
      pc.party = null;
      univ.storedPcs.set(pc.uniqueId, pc);
      newPc(univ, target);
      break;
    }

    /**
     * `UNSTORE_PC` (boe.specials.cpp:3328) — the other half. `ex1a` names the
     * PC by `uniqueId`, and **a value under 1000 has 1000 added to it**, so a
     * node can pass either the raw id or the `id - 1000` that `STORE_PC` wrote
     * into the SDF. `ex1b` is the jump taken when the party is full.
     */
    case SpecType.UNSTORE_PC: {
      const uid = spec.ex1a < 1000 ? spec.ex1a + 1000 : spec.ex1a;
      const stored = univ.storedPcs.get(uid);
      if (!stored) {
        univ.addStringToBuf('Scenario tried to unstore a nonexistent PC!');
        break;
      }
      const spot = party.freeSpace();
      if (spot === 6) {
        univ.addStringToBuf('No room for PC.');
        ctx.nextSpec = spec.ex1b;
        checkMess = false;
        break;
      }
      // `replace_pc` — the stored PC goes back into the party object, which is
      // what `getLoc` needs to fall back to the party's square.
      stored.party = party;
      party.pcs[spot] = stored;
      ctx.curTarget = spot;
      stored.mainStatus -= MainStatus.SPLIT;
      univ.storedPcs.delete(uid);
      break;
    }

    default:
      // Nothing is left in this category as of 2026-09-06: the whole AFFECT
      // range is ported. The sweep that says so walks `CATEGORY_RANGES` in
      // `context.ts` and subtracts every `SpecType.NAME` any file mentions —
      // **and note its blind spot**: a range's own endpoints are written there
      // as `SpecType.NAME`, so `UNSTORE_PC` looked ported for months on the
      // strength of being the end of the AFFECT range and nothing else.
      reportUnsupported(univ, spec.type);
      break;
  }

  if (checkMess) await handleMessage(univ, ctx);
}
