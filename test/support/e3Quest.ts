/**
 * A headless quest runner for the converted Exile 3: a `GameSession` with a
 * scripted dialog host and a handful of verbs a walkthrough is written in —
 * enter a town, step on a square, walk into a door, use one, talk to someone about a keyword,
 * cast at a square, kill what stands in the way — and a log of everything
 * the game said, so a failing step can print what happened.
 *
 * It proves the *logic* of a quest chain: travel is a teleport and a fight is
 * `killMonst`, so it says nothing about whether a real party can walk there
 * or win. `test/e3quests.test.ts` runs the main quests with it.
 */

import { readFileSync } from 'node:fs';
import { vi } from 'vitest';
import { GameRng } from '../../src/core/rng';
import type { Direction, Location } from '../../src/core/location';
import type { Scenario } from '../../src/data/scenario';
import { restoreScenarioState } from '../../src/data/scenarioState';
import { SpellPat } from '../../src/data/pattern';
import { DamageType } from '../../src/data/monster';
import { placeSpellPattern } from '../../src/game/spellPatterns';
import { SpecType } from '../../src/data/special';
import { Spell } from '../../src/data/spell';
import { TerSpec } from '../../src/data/terrain';
import { loadScenario } from '../../src/fileio/loadScenario';
import { FsSource } from '../../src/fileio/source';
import { buildOpcodeTable } from '../../src/fileio/specialParse';
import { killMonst } from '../../src/game/damage';
import { doRest } from '../../src/game/rest';
import { FORCED_ENTRY, GameSession } from '../../src/game/session';
import { GameMode } from '../../src/game/modes';
import type { ChoiceButton, SpecialHost } from '../../src/game/specials/context';
import { SpecCtx, SpecCtxType } from '../../src/game/specials/context';
import { castTownSpell, startTownTargeting } from '../../src/game/spellTarget';
import { TalkAction } from '../../src/game/talk';
import type { Creature } from '../../src/universe/creature';
import { PartyPreset } from '../../src/universe/player';
import { Universe } from '../../src/universe/universe';
import { partyFlag } from '../../tools/e3convert/script';

/** Buttons pressed when no answer is queued: the "go ahead" ones. */
const DEFAULT_YES = /^(Yes|Take|Climb|Pray|Get|Read|Pull|Push|Drink|Touch|Onward|Approach|Step In|Give|Pay|Buy|Enter|Go In|Open|Search|Help|OK|Accept|Use|Descend|Ascend)$/i;

const STEPS: [number, number][] = [[0, 1], [0, -1], [1, 0], [-1, 0], [1, 1], [-1, -1], [1, -1], [-1, 1]];

/** A creature by name or talk title, or by personality number. */
export type Who = string | RegExp | number;

export async function loadExile3(dir: string): Promise<Scenario> {
  const opcodes = buildOpcodeTable(
    readFileSync(new URL('../../public/data/strings/specials-opcodes.txt', import.meta.url), 'utf8'));
  return loadScenario(new FsSource(dir), opcodes);
}

export class QuestRunner {
  readonly session: GameSession;
  readonly univ: Universe;
  /** Everything shown, in order: messages, choices (with the button pressed), talk replies. */
  readonly log: string[] = [];
  /** Every panel shown (`if-panel`), as its layout with the live text filled in. */
  readonly panels: string[] = [];
  /** Answers to the next choices, as patterns on the button label or button indices; consumed in order. */
  private answers: (RegExp | number)[] = [];
  private numbers: number[] = [];
  private texts: string[] = [];
  /** Who the select-PC dialog picks. */
  pick = 0;

  constructor(readonly scen: Scenario) {
    // A town's record is the scenario's own, and play writes on it (as the
    // C++'s does); the browser reloads the page for a new game, so a runner
    // sharing one parsed scenario puts it back first, as loading a save does.
    if (scen.pristine) restoreScenarioState(scen, scen.pristine);
    this.univ = new Universe(scen, new GameRng(), PartyPreset.DEFAULT);
    this.session = new GameSession(this.univ);
    this.session.attachSpecials(this.host());
    // A locked door walked into asks what to do (main.ts's
    // `locked-door-action`), in the order of E3's own dialog 993: Leave, Pick
    // Lock, Bash Door (labels 60, 59, 58). Unanswered, the party leaves.
    this.session.onLockedDoor = async (where) => {
      const i = this.choose(['This door is locked. What do you do?'], ['Leave', 'Pick Lock', 'Bash Door']);
      if (i === 1) this.session.pickLock(where, this.pick);
      else if (i === 2) await this.session.bashDoor(where, this.pick);
    };
    this.session.startNewGame();
  }

  get party() { return this.univ.party; }
  get town() { return this.univ.town!; }

  /**
   * The texts of the `n`-th panel shown (the last by default), in the order
   * of the dialog's controls: what a player reads on it.
   */
  panelTexts(n = this.panels.length - 1): string[] {
    return [...(this.panels[n] ?? '').matchAll(/<text[^>]*>([^<]*)<\/text>/g)].map((m) => m[1]!);
  }

  /** The last `n` lines of the log, for a failing step's message. */
  tail(n = 12): string { return this.log.slice(-n).join('\n'); }

  /** A choice, answered from the queue (`answer`), else its yes-like button, else its first. */
  private choose(strs: string[], labels: string[]): number {
    let i = -1;
    const want = this.answers.shift();
    if (typeof want === 'number') {
      // -1 is the last button, whatever their number.
      i = want < 0 ? labels.length - 1 : want;
      if (i >= labels.length) throw new Error(`no button ${i} among [${labels.join(', ')}] for: ${strs.join(' | ')}\n${this.tail()}`);
    } else if (want) {
      i = labels.findIndex((l) => want.test(l));
      if (i < 0) throw new Error(`no button matching ${want} among [${labels.join(', ')}] for: ${strs.join(' | ')}\n${this.tail()}`);
    } else {
      i = Math.max(0, labels.findIndex((l) => DEFAULT_YES.test(l)));
    }
    this.log.push(`[choice] ${strs.filter(Boolean).join(' | ')} [${labels.join('/')}] -> ${labels[i]}`);
    return i;
  }

  private host(): SpecialHost {
    const { session, univ } = this;
    return {
      message: async (s1, s2, title) => { this.log.push(`[msg${title ? ` ${title}` : ''}] ${[s1, s2].filter(Boolean).join(' | ')}`); },
      choice: async (strs, buttons: ChoiceButton[]) => this.choose(strs, buttons.map((b) => b.label)),
      story: async (title) => { this.log.push(`[story] ${title}`); },
      askText: async (prompt) => { const t = this.texts.shift() ?? ''; this.log.push(`[ask] ${prompt} -> ${t}`); return t; },
      askNum: async (min, _max, prompt) => { const n = this.numbers.shift() ?? min; this.log.push(`[num] ${prompt} -> ${n}`); return n; },
      // A panel's button comes from the same queue as a typed number; 0 leaves.
      panel: async (layout, caption) => {
        const n = this.numbers.shift() ?? 0;
        this.panels.push(layout);
        this.log.push(`[panel] ${caption} -> ${n}`);
        return n;
      },
      selectPc: async (_opts, title) => { this.log.push(`[pc] ${title} -> ${this.pick}`); return this.pick; },
      getNumOfItems: async (max) => max,
      startShop: (which, costAdj, name) => session.startShopMode(which, costAdj, name),
      startTalk: (monsterIndex, personality, monsterType, pic) =>
        session.startTalkMode(monsterIndex, personality, monsterType, pic),
      sound: () => {},
      rest: (length, hp, sp) => doRest(univ, length, hp, sp, session.isOutdoors, session),
      moveParty: (where) => {
        if (session.inTown) univ.party.townLoc = { ...where };
        else univ.party.outLoc = { ...where };
        session.center = { ...where };
        session.updateExplored(where);
      },
      forceTown: (town, entryDir, where) => {
        if (entryDir === 9) session.forceTownEntry(town, where);
        session.startTownMode(town, entryDir);
        session.center = { ...univ.party.townLoc };
      },
      changeLevel: (town, where) => {
        if (where.x >= 0 && where.y >= 0) session.forceTownEntry(town, where);
        session.storeTownOnLeaving();
        session.startTownMode(town, 9);
        session.center = { ...univ.party.townLoc };
      },
      endScenario: () => { this.log.push('[end]'); },
    };
  }

  /** Queue button answers (patterns on the label, or a button's index) for the next choices. */
  answer(...labels: (string | RegExp | number)[]): this {
    this.answers.push(...labels.map((l) => (typeof l === 'string' ? new RegExp(`^${l}$`, 'i') : l)));
    return this;
  }
  number(...n: number[]): this { this.numbers.push(...n); return this; }
  text(...t: string[]): this { this.texts.push(...t); return this; }

  /** Waits for every chain and monster turn to finish. */
  async settle(): Promise<void> {
    await vi.waitFor(() => { if (this.session.specials!.busy) throw new Error('busy'); });
    await this.session.settled();
    await vi.waitFor(() => { if (this.session.specials!.busy) throw new Error('busy'); });
  }

  // ------------------------------------------------------------------ places

  /** Into `town` (from anywhere), by entrance `dir` or at a square. */
  async enter(town: number, at?: Location, dir = 0): Promise<void> {
    if (!this.session.isOutdoors) this.session.debugLeaveTown();
    if (at) this.session.forceTownEntry(town, at);
    this.session.startTownMode(town, at ? FORCED_ENTRY : dir);
    this.session.center = { ...this.party.townLoc };
    await this.settle();
    if (at) this.place(at);
  }

  /** Outdoors, in sector (sx, sy) at (x, y). */
  async outdoors(sx: number, sy: number, x: number, y: number): Promise<void> {
    if (!this.session.isOutdoors) this.session.debugLeaveTown();
    this.session.positionParty(sx, sy, x, y);
    await this.settle();
  }

  /** Outdoors at square (gx, gy) of the whole map, as the walkthroughs number them. */
  async outdoorsAt(gx: number, gy: number): Promise<void> {
    await this.outdoors(Math.floor(gx / 48), Math.floor(gy / 48), gx % 48, gy % 48);
  }

  /** Where the party is on the whole outdoor map. */
  get global(): Location {
    // By `outLoc`: BoE's `out_move_party` (a ferry) leaves `loc_in_sec` as it
    // was until the next step.
    const { outdoorCorner, outLoc } = this.party;
    return { x: outdoorCorner.x * 48 + outLoc.x, y: outdoorCorner.y * 48 + outLoc.y };
  }

  /** Stand on a town square, with no step taken. */
  place(at: Location): void {
    this.party.townLoc = { ...at };
    this.session.center = { ...at };
    this.session.updateExplored(at);
  }

  get townNum(): number { return this.party.townNum; }
  get at(): Location { return this.session.isOutdoors ? this.party.locInSec : this.party.townLoc; }

  // ------------------------------------------------------------------ verbs

  /** Step onto (x, y) from a square beside it, as the arrow keys would (twice through a door that opens). */
  async step(x: number, y: number): Promise<void> {
    const town = this.session.isOutdoors ? -1 : this.townNum;
    for (const [dx, dy] of STEPS) {
      const from = { x: x - dx, y: y - dy };
      if (this.session.isOutdoors) {
        if (from.x < 0 || from.y < 0 || from.x > 47 || from.y > 47) continue;
        const { sector } = this.party;
        this.session.positionParty(sector.x, sector.y, from.x, from.y);
      } else {
        if (!this.town.isOnMap(from.x, from.y) || this.session.townIsBlocked(from)) continue;
        this.place(from);
      }
      const ter = () => (this.session.isOutdoors ? -1 : this.town.record.terrain[x]![y]!);
      const before = ter();
      await this.session.moveTo({ x, y });
      await this.settle();
      // A door that opened as it was bumped gets a second step, as a player
      // would take: E3 runs a spot on a door only once the party walks in
      // (`town-spots` = `exile3`).
      if (!this.session.isOutdoors && this.townNum === town && (this.at.x !== x || this.at.y !== y) && ter() !== before) {
        await this.session.moveTo({ x, y });
        await this.settle();
      }
      return;
    }
    throw new Error(`no square to step onto (${x},${y}) from`);
  }

  /**
   * Walk from where the party stands onto the square beside it, (x, y), as
   * the arrow keys would; a door or false wall that changes as it's walked
   * into gets a second step, as a player would take.
   */
  async walk(x: number, y: number): Promise<void> {
    const ter = () => (this.session.isOutdoors ? -1 : this.town.record.terrain[x]![y]!);
    const before = ter();
    await this.session.moveTo({ x, y });
    await this.settle();
    if ((this.at.x !== x || this.at.y !== y) && ter() !== before) {
      await this.session.moveTo({ x, y });
      await this.settle();
    }
  }

  /** Arrow-key steps from where the party stands; whether each went through. */
  async go(...dirs: Direction[]): Promise<boolean[]> {
    const moved: boolean[] = [];
    for (const d of dirs) {
      moved.push(await this.session.move(d));
      await this.settle();
    }
    return moved;
  }

  /** Use special item `k` from the special-items page. */
  async useSpecItem(k: number): Promise<void> {
    await this.session.useSpecItem(k);
    await this.settle();
  }

  /** Stand still for `n` turns (Space, `handle_pause`). */
  async pause(n = 1): Promise<void> {
    for (let i = 0; i < n; i++) {
      await this.session.pause();
      await this.settle();
    }
  }

  /** Use the square (x, y) from beside it (the U key). */
  async use(x: number, y: number): Promise<void> {
    for (const [dx, dy] of STEPS) {
      const from = { x: x - dx, y: y - dy };
      if (!this.town.isOnMap(from.x, from.y) || this.session.townIsBlocked(from)) continue;
      this.place(from);
      await this.session.handleUseSpace({ x, y });
      await this.settle();
      return;
    }
    throw new Error(`no square to use (${x},${y}) from`);
  }

  /** Look at (x, y) from beside it: how a bookshelf or a crate is searched (`adj_town_look`). */
  async look(x: number, y: number): Promise<void> {
    for (const [dx, dy] of STEPS) {
      const from = { x: x - dx, y: y - dy };
      if (!this.town.isOnMap(from.x, from.y) || this.session.townIsBlocked(from)) continue;
      this.place(from);
      await this.session.adjTownLook({ x, y });
      await this.settle();
      return;
    }
    throw new Error(`no square to look at (${x},${y}) from`);
  }

  /** Run the special on (x, y) as if stepped on, without moving there. */
  async trigger(x: number, y: number): Promise<void> {
    const spot = this.town.record.specialLocs.find((s) => s.x === x && s.y === y);
    if (!spot) throw new Error(`no special at (${x},${y})`);
    await this.session.runSpecial(SpecCtx.TOWN_MOVE, SpecCtxType.TOWN, spot.spec, { x, y });
    await this.settle();
  }

  /** A spell (or, with `Spell.NONE`, an exploding missile) landing on (x, y). */
  async castAt(x: number, y: number, spell = Spell.FIREBALL): Promise<void> {
    // As a real cast: the square hears the spell as it's cast, and then a
    // fire spell's blast lands on it (`placeSpellPattern`), where Exile III's
    // pools and slime maker listen (`FIRE_BLAST`).
    const fire = spell === Spell.FIREBALL || spell === Spell.FIRESTORM || spell === Spell.FLAMESTRIKE;
    if (await this.session.castSpellOnSpace({ x, y }, spell) && fire) {
      await placeSpellPattern(this.session, SpellPat.SQUARE, { x, y }, { damage: { type: DamageType.FIRE, dice: 1 }, whoHit: 0 });
    }
    await this.settle();
  }

  /**
   * Cast a town spell at (x, y) through the real targeting (`cast_town_spell`),
   * as a freebie from PC `pc`, so nobody has to know it or have the points,
   * at the PC's own level.
   */
  async spell(spell: Spell, x: number, y: number, pc = 0, pattern = SpellPat.SINGLE): Promise<void> {
    startTownTargeting(this.session, spell, pc, true, pattern, this.party.pcs[pc]!.level);
    await castTownSpell(this.session, { x, y });
    await this.settle();
  }

  /**
   * Living creatures in town whose name (or talk title) matches, or, given a
   * number, whose personality is that one (for towns where everyone shares a
   * name, like the spiders' caves).
   */
  creatures(name: Who): Creature[] {
    if (typeof name === 'number') return this.town.monsters.filter((m) => m.isAlive && m.personality === name);
    const re = typeof name === 'string' ? new RegExp(name, 'i') : name;
    return this.town.monsters.filter((m) => m.isAlive && (re.test(m.getName()) || re.test(this.title(m))));
  }

  private title(m: Creature): string {
    if (m.personality < 0) return '';
    return this.scen.townTalk[Math.floor(m.personality / 10)]?.people[m.personality % 10]?.title ?? '';
  }

  /** Kill every living creature that matches, as the party (death specials run). */
  async kill(name: Who): Promise<number> {
    const them = this.creatures(name);
    for (const m of them) killMonst(this.univ, m, 0, undefined, this.session);
    await this.settle();
    return them.length;
  }

  /** Kill everything hostile in town. */
  async clearHostiles(): Promise<void> {
    for (const m of this.town.monsters) if (m.isAlive && !m.isFriendly) killMonst(this.univ, m, 0, undefined, this.session);
    await this.settle();
  }

  /**
   * Talk to the creature whose name or title matches, asking about each
   * keyword in turn; returns the replies. The party is put beside them.
   */
  async talk(name: Who, ...keywords: string[]): Promise<string[]> {
    const who = this.creatures(name)[0];
    if (!who) throw new Error(`nobody called ${name} in town ${this.townNum}`);
    // Beside them, or across a counter: talk only needs sight.
    const across = STEPS.map(([dx, dy]) => ({ x: who.curLoc.x + 2 * dx, y: who.curLoc.y + 2 * dy }));
    const spot = [...STEPS.map(([dx, dy]) => ({ x: who.curLoc.x + dx, y: who.curLoc.y + dy })), ...across]
      .find((p) => this.town.isOnMap(p.x, p.y) && !this.session.townIsBlocked(p)
        && this.session.canSeeLight(p, who.curLoc) < 4);
    if (!spot) throw new Error(`no square beside ${name}`);
    this.place(spot);
    if (!(await this.session.talkTo(who.curLoc)) || !this.session.talk) {
      throw new Error(`${name} won't talk: ${this.univ.transcript.slice(-3).join(' / ')}`);
    }
    await this.settle();
    const replies: string[] = [];
    for (const word of keywords) {
      if (!this.session.talk) break;
      this.text(word);
      await this.session.chooseTalkNode(TalkAction.ASK);
      await this.settle();
      const t = this.session.talk as GameSession['talk'];
      const reply = t ? [t.str1, t.str2].filter(Boolean).join(' ') : '(conversation ended)';
      this.log.push(`[talk ${word}] ${reply}`);
      replies.push(reply);
    }
    if (this.session.talk) this.session.endTalkMode();
    return replies;
  }

  /**
   * The outdoor fight with a group standing beside the party (one a special
   * just placed, say): met as a step would meet it (or already begun, when
   * the step's own turn met it), every hostile in the arena killed, and
   * combat ended, so the group's win script runs. Returns false if the
   * meeting was called off or the group ran.
   */
  async fightOutdoors(): Promise<boolean> {
    if (this.session.mode !== GameMode.COMBAT) {
      const fought = await this.session.checkOutdoorEncounter();
      await this.settle();
      if (!fought) return false;
    }
    for (const m of this.univ.town!.monsters) if (m.isAlive && !m.isFriendly) killMonst(this.univ, m, 0, undefined, this.session);
    await this.settle();
    if (!this.session.endCombat()) throw new Error(`combat won't end: ${this.univ.transcript.slice(-3).join(' / ')}`);
    await this.settle();
    return true;
  }

  /**
   * Whether the party could walk from `from` to `to` in this town, through
   * doors (opened by a step or picked) and E3's ways through (spot 50: a
   * secret passage, a ford), but not walls, portcullises or water; `boat`
   * lets it cross water a boat can. Other special spots don't count, so a
   * stair or a blocking message in the way doesn't stop the path, unless
   * `avoidSpots` is set: then a path keeps off every spot but `to` (a
   * tower of teleporters, where stepping on one would take the party away).
   */
  canReach(from: Location, to: Location, opts: { boat?: boolean; avoidSpots?: boolean } = {}): boolean {
    return this.pathLength(from, to, opts) >= 0;
  }

  /** Steps on the shortest such path from `from` to `to` (as `canReach` walks), or -1. */
  pathLength(from: Location, to: Location, opts: { boat?: boolean; avoidSpots?: boolean } = {}): number {
    const town = this.town;
    const spots = new Set(opts.avoidSpots ? town.record.specialLocs.map((l) => `${l.x},${l.y}`) : []);
    // The converter's spot 50: a CANT_ENTER that lets the party by (ex1a 0)
    // and forces the step (ex2a 1) onto a square that would block it.
    const waysThrough = new Set(town.record.specialLocs.filter((l) => {
      const n = town.record.specials.get(l.spec);
      return n?.type === SpecType.CANT_ENTER && n.ex1a === 0 && n.ex2a === 1;
    }).map((l) => `${l.x},${l.y}`));
    const passable = (x: number, y: number): boolean => {
      if (!town.isOnMap(x, y)) return false;
      if (x === to.x && y === to.y) return true;
      if (waysThrough.has(`${x},${y}`)) return true;
      if (spots.has(`${x},${y}`)) return false;
      const ter = this.univ.terrainType(town.record.terrain[x]![y]!);
      if (opts.boat && ter.boatOver) return true;
      if (ter.special === TerSpec.CHANGE_WHEN_STEP_ON || ter.special === TerSpec.UNLOCKABLE) return true;
      return !this.session.townIsBlocked({ x, y });
    };
    const dist = new Map([[`${from.x},${from.y}`, 0]]);
    const queue = [from];
    while (queue.length) {
      const p = queue.shift()!;
      const d = dist.get(`${p.x},${p.y}`)!;
      if (p.x === to.x && p.y === to.y) return d;
      for (const [dx, dy] of STEPS) {
        const n = { x: p.x + dx, y: p.y + dy };
        const k = `${n.x},${n.y}`;
        if (dist.has(k) || !passable(n.x, n.y)) continue;
        dist.set(k, d + 1);
        queue.push(n);
      }
    }
    return -1;
  }

  // ------------------------------------------------------------------ state

  /** An E3 party-record byte, by offset (`0xc85`). */
  flag(offset: number): number { return this.party.getSdf(...partyFlag(offset)); }
  setFlag(offset: number, v: number): void { this.party.setSdf(...partyFlag(offset), v); }
  hasSpecItem(k: number): boolean { return this.party.specItems.has(k); }
  /** Whether anyone carries an item whose name matches. */
  hasItem(name: string | RegExp): boolean {
    const re = typeof name === 'string' ? new RegExp(name, 'i') : name;
    return this.party.pcs.some((pc) => pc.items.some((it) => it.variety !== 0 && (re.test(it.fullName) || re.test(it.name))));
  }
}
