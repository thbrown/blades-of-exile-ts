/**
 * A test panel for trying scenario scripts in the browser, opened with
 * `?debug=1` (e.g. `?scenario=exile3&debug=1`). Not part of the original:
 * a developer's tool, drawn beside the game in plain HTML, touching the game
 * only through the session's own entry points.
 *
 * - **Go**: into any town, or onto any outdoor square.
 * - **Spots here**: the special spots of the town or sector the party is in.
 *   *Step* puts the party beside one and walks onto it, so the node runs as
 *   it would in play (a refused step stays refused). *Run* runs the node
 *   without moving, for a spot a locked door or a wall stands in front of.
 * - **Talk**: everyone here who talks, and a button to start the
 *   conversation.
 * - **Flags**: read and set a stuff-done flag.
 * - **Party**: gold, healing, and debug mode (instant kills) and ghost mode
 *   (walk through walls), the engine's own switches.
 *
 * A converted scenario may put a `debug.json` beside its `scenario.xml`
 * (Exile 3's converter does): each spot's number in the source game, so the
 * list can be matched with the transcription, spots not transcribed yet, and
 * a party-record offset for flags written as `0x…`.
 */

import { Direction, type Location } from '../core/location';
import type { GameSession } from '../game/session';
import { SpecCtx, SpecCtxType } from '../game/specials/context';
import { MainStatus } from '../universe/skills';

interface DebugSpot { x: number; y: number; id: number; node: number }
interface DebugInfo {
  towns?: Record<string, DebugSpot[]>;
  zones?: Record<string, DebugSpot[]>;
  /** A flag written `0xNNN` is party-record byte NNN, flag 0 being at this offset. */
  flagOffset?: number;
}

const STEP_DIRS: [number, number, Direction][] = [
  [0, 1, Direction.N], [0, -1, Direction.S], [-1, 0, Direction.E], [1, 0, Direction.W],
  [-1, 1, Direction.NE], [1, 1, Direction.NW], [-1, -1, Direction.SE], [1, -1, Direction.SW],
];

const CSS = `
#debug-panel { position: fixed; top: 30px; box-sizing: border-box; right: 0; z-index: 50; width: 330px; max-height: calc(100vh - 40px);
  overflow: auto; background: rgba(20, 20, 24, 0.94); color: #ddd; font: 12px/1.4 system-ui, sans-serif;
  border: 1px solid #555; border-right: none; border-radius: 6px 0 0 6px; box-shadow: 0 2px 12px #000a; }
#debug-panel.collapsed { width: auto; }
#debug-panel.collapsed > :not(header) { display: none; }
#debug-panel header { display: flex; justify-content: space-between; align-items: center; padding: 4px 8px;
  background: #333; cursor: pointer; user-select: none; position: sticky; top: 0; }
#debug-panel section { padding: 6px 8px; border-top: 1px solid #444; }
#debug-panel h3 { margin: 0 0 4px; font-size: 11px; text-transform: uppercase; letter-spacing: .05em; color: #9ab; }
#debug-panel input, #debug-panel select, #debug-panel button { font: inherit; background: #222; color: #eee;
  border: 1px solid #555; border-radius: 3px; padding: 1px 4px; }
#debug-panel button { cursor: pointer; }
#debug-panel button:hover { background: #3a3a44; }
#debug-panel input[type=number] { width: 44px; }
#debug-panel .row { display: flex; gap: 4px; align-items: center; flex-wrap: wrap; margin: 2px 0; }
#debug-panel ul { list-style: none; margin: 0; padding: 0; max-height: 220px; overflow: auto; }
#debug-panel li { display: flex; gap: 4px; align-items: center; padding: 1px 0; }
#debug-panel li .what { flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
#debug-panel .missing { color: #e98; }
#debug-panel .note { color: #999; }
`;

export async function installDebugPanel(
  session: GameSession, scenarioId: string, redraw: () => void,
): Promise<void> {
  const univ = session.univ;
  const scen = univ.scenario;
  let info: DebugInfo = {};
  try {
    const r = await fetch(`/scenarios/${scenarioId}/debug.json`);
    if (r.ok && (r.headers.get('content-type') ?? '').includes('json')) info = await r.json() as DebugInfo;
  } catch { /* no sidecar: the generic panel */ }

  const style = document.createElement('style');
  style.textContent = CSS;
  document.head.append(style);
  const panel = document.createElement('div');
  panel.id = 'debug-panel';
  // Typing into the panel must not reach the game's keyboard handlers.
  panel.addEventListener('keydown', (ev) => ev.stopPropagation());
  document.body.append(panel);

  const el = <K extends keyof HTMLElementTagNameMap>(tag: K, props: Partial<HTMLElementTagNameMap[K]> = {},
    ...kids: (Node | string)[]): HTMLElementTagNameMap[K] => {
    const e = Object.assign(document.createElement(tag), props);
    e.append(...kids);
    return e;
  };
  const num = (value: number, title = '') => el('input', { type: 'number', value: String(value), title });
  const button = (label: string, action: () => unknown, title = '') =>
    el('button', { textContent: label, title, onclick: () => { void run(action); } });
  const section = (title: string, ...kids: Node[]) => el('section', {}, el('h3', { textContent: title }), ...kids);

  const status = el('div', { className: 'note' });
  /** Runs a panel action once the game is idle, then redraws everything. */
  const run = async (action: () => unknown): Promise<void> => {
    status.textContent = '';
    try {
      await session.settled();
      await action();
    } catch (e) {
      status.textContent = String(e);
    }
    redraw();
    refresh();
  };

  // ---------------------------------------------------------------- where
  const where = el('div');
  const header = el('header', {}, el('strong', { textContent: 'Test panel' }), el('span', { textContent: '▾' }));
  /**
   * While open, the panel's width is the body's right padding, which the
   * page layout subtracts (`pageLayout.ts`), so the game shrinks beside it
   * rather than hiding under it.
   */
  const makeRoom = () => {
    document.body.style.paddingRight = panel.classList.contains('collapsed') ? '' : `${panel.offsetWidth}px`;
    window.dispatchEvent(new Event('resize'));
  };
  header.onclick = () => {
    panel.classList.toggle('collapsed');
    makeRoom();
  };

  // ------------------------------------------------------------------- go
  const townSel = el('select');
  scen.towns.forEach((t, i) => townSel.append(el('option', { value: String(i), textContent: `${i} ${t.name}` })));
  const tx = num(-1, 'x (-1: the entrance)');
  const ty = num(-1, 'y');
  const goTown = () => {
    const t = Number(townSel.value);
    if (!session.isOutdoors) session.debugLeaveTown();
    session.startTownMode(t, 0);
    const at = { x: Number(tx.value), y: Number(ty.value) };
    if (at.x >= 0 && at.y >= 0) placeInTown(at);
  };
  const sx = num(0, 'sector x'), sy = num(0, 'sector y'), ox = num(24, 'x'), oy = num(24, 'y');
  const goOut = () => {
    if (!session.isOutdoors) session.debugLeaveTown();
    session.positionParty(Number(sx.value), Number(sy.value), Number(ox.value), Number(oy.value));
  };
  const go = section('Go',
    el('div', { className: 'row' }, townSel, tx, ty, button('Enter', goTown)),
    el('div', { className: 'row' }, 'sector', sx, sy, 'at', ox, oy, button('Go outdoors', goOut)));

  // ---------------------------------------------------------------- spots
  const spotList = el('ul');
  const spots = section('Spots here', spotList);

  const placeInTown = (at: Location) => {
    univ.party.townLoc = { ...at };
    session.center = { ...at };
    session.updateExplored(at);
  };
  /** The sector the party stands in, and where in it. */
  const here = () => ({ sector: univ.party.sector, local: univ.party.locInSec });
  const step = async (spot: Location) => {
    for (const [dx, dy, dir] of STEP_DIRS) {
      const from = { x: spot.x + dx, y: spot.y + dy };
      if (from.x < 0 || from.y < 0) continue;
      if (session.isOutdoors) {
        if (from.x > 47 || from.y > 47) continue;
        const { sector } = here();
        session.positionParty(sector.x, sector.y, from.x, from.y);
      } else {
        const town = univ.town!;
        if (!town.isOnMap(from.x, from.y)) continue;
        placeInTown(from);
      }
      redraw();
      await session.move(dir);
      return;
    }
  };
  const runNode = async (spot: DebugSpot | { x: number; y: number; node: number }) => {
    if (session.isOutdoors) {
      await session.runSpecial(SpecCtx.OUT_MOVE, SpecCtxType.OUTDOOR, spot.node, { ...univ.party.outLoc });
    } else {
      await session.runSpecial(SpecCtx.TOWN_MOVE, SpecCtxType.TOWN, spot.node, { x: spot.x, y: spot.y });
    }
  };

  // ----------------------------------------------------------------- talk
  const talkList = el('ul');
  const talk = section('Talk', talkList);

  // ---------------------------------------------------------------- flags
  const fr = el('input', { size: 7, value: '0,0', title: 'row,col — or 0xNNN, a party-record offset, when the scenario says how' });
  const fv = num(0, 'value');
  const flagAt = (): [number, number] => {
    const text = fr.value.trim();
    if (/^0x[0-9a-f]+$/i.test(text) && info.flagOffset !== undefined) {
      const idx = parseInt(text, 16) - info.flagOffset;
      return [Math.floor(idx / 10), idx % 10];
    }
    const [r, c] = text.split(/[ ,]+/).map(Number);
    return [r ?? 0, c ?? 0];
  };
  const flagOut = el('span', { className: 'note' });
  const readFlag = () => {
    const [r, c] = flagAt();
    fv.value = String(univ.party.getSdf(r, c));
    flagOut.textContent = `(${r},${c})`;
  };
  const flags = section('Flags',
    el('div', { className: 'row' }, fr, button('Get', readFlag), fv,
      button('Set', () => { const [r, c] = flagAt(); univ.party.setSdf(r, c, Number(fv.value)); readFlag(); }), flagOut));

  // ---------------------------------------------------------------- party
  const debugBox = el('input', { type: 'checkbox', onchange: () => { univ.debugMode = debugBox.checked; } });
  const ghostBox = el('input', { type: 'checkbox', onchange: () => { univ.ghostMode = ghostBox.checked; } });
  const party = section('Party',
    el('div', { className: 'row' },
      button('+1000 gold', () => { univ.party.gold += 1000; }),
      button('+100 food', () => { univ.party.food += 100; }),
      button('Heal all', () => {
        for (const pc of univ.party.pcs) {
          if (pc.mainStatus !== MainStatus.ALIVE) continue;
          pc.curHealth = pc.maxHealth;
          pc.curSp = pc.maxSp;
          pc.status.fill(0);
        }
      })),
    el('div', { className: 'row' },
      el('label', {}, debugBox, ' debug mode (instant kills)'),
      el('label', {}, ghostBox, ' ghost (walls)')));

  panel.append(header, el('section', {}, where, status), go, spots, talk, flags, party);

  // --------------------------------------------------------------- refresh
  let shownPlace = '';
  function refresh(): void {
    debugBox.checked = univ.debugMode;
    ghostBox.checked = univ.ghostMode;
    const p = univ.party;
    const inTown = !session.isOutdoors && univ.town !== null;
    const h = here();
    where.textContent = inTown
      ? `${session.locationName()} — town ${p.townNum} at ${p.townLoc.x},${p.townLoc.y}`
      : `${session.locationName()} — sector ${h.sector.x},${h.sector.y} at ${h.local.x},${h.local.y}`;
    const place = inTown ? `t${p.townNum}` : `s${h.sector.x},${h.sector.y}`;
    if (place === shownPlace) return;
    shownPlace = place;

    // Spots: the record's own, with the source game's numbers where known.
    spotList.replaceChildren();
    let known: DebugSpot[] | undefined;
    let nodes: { x: number; y: number; node: number }[];
    if (inTown) {
      known = info.towns?.[p.townNum];
      nodes = univ.town!.record.specialLocs.map((l) => ({ x: l.x, y: l.y, node: l.spec }));
    } else {
      const sector = scen.outdoors[h.sector.x]?.[h.sector.y];
      known = info.zones?.[h.sector.y * scen.outWidth + h.sector.x];
      nodes = (sector?.specialLocs ?? []).map((l) => ({ x: l.x, y: l.y, node: l.spec }));
    }
    const rows = known ?? nodes.filter((n) => n.node >= 0).map((n) => ({ ...n, id: -1 }));
    for (const s of rows.slice().sort((a, b) => a.id - b.id || a.x - b.x || a.y - b.y)) {
      const label = `${s.id >= 0 ? `#${s.id} ` : ''}(${s.x},${s.y})${s.node >= 0 ? ` node ${s.node}` : ' not transcribed'}`;
      spotList.append(el('li', {},
        el('span', { className: `what${s.node < 0 ? ' missing' : ''}`, textContent: label }),
        button('Step', () => step(s), 'walk onto it from beside it'),
        ...(s.node >= 0 ? [button('Run', () => runNode(s), 'run its node without moving')] : [])));
    }
    if (rows.length === 0) spotList.append(el('li', { className: 'note', textContent: 'none' }));
    spots.hidden = false;

    // Talkers.
    talkList.replaceChildren();
    talk.hidden = !inTown;
    if (inTown) {
      univ.town!.monsters.forEach((m, i) => {
        if (!m.isAlive || m.personality < 0) return;
        const kind = scen.scenMonsters[m.number]?.name ?? `creature ${m.number}`;
        const person = scen.townTalk[Math.floor(m.personality / 10)]?.people[m.personality % 10];
        talkList.append(el('li', {},
          el('span', {
            className: 'what', title: `slot ${i}, personality ${m.personality}`,
            textContent: `${person?.title || kind} (${kind}, ${m.curLoc.x},${m.curLoc.y})`,
          }),
          button('Talk', async () => {
            placeInTown({ x: m.curLoc.x, y: m.curLoc.y + 1 });
            await session.talkTo(m.curLoc);
          })));
      });
      if (talkList.children.length === 0) talkList.append(el('li', { className: 'note', textContent: 'nobody' }));
    }
  }
  refresh();
  makeRoom();
  setInterval(refresh, 500);
}
