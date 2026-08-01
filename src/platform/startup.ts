/**
 * The startup screen — `MODE_STARTUP` (boe.consts.hpp:99) in browser clothing.
 *
 * The original draws a splash with five buttons (`draw_startup`,
 * boe.graphics.cpp:288) and reaches the scenario list through a second dialog.
 * This is the same two choices in one screen, because the web build has a
 * question the original doesn't: which scenario's *files* to fetch. Everything
 * downstream — the sheets, the strings, the Universe — needs that answer before
 * it can start, so it is asked first rather than last.
 *
 * Plain DOM and no canvas: this runs before the graphics sheets have loaded.
 * `?scenario=` skips it entirely, which is what a direct link and the headless
 * verifier use.
 */

export interface StartupScenario {
  id: string;
  title: string;
  /** The scenario's first teaser line, shown under its title. */
  blurb: string;
}

export interface StartupSave {
  /** The slot name in the save store. */
  slot: string;
  scenarioId: string;
  label: string;
}

export interface StartupChoice {
  scenarioId: string;
  /** Set when the player picked a saved game rather than a fresh start. */
  slot?: string;
}

function el(tag: string, className?: string, text?: string): HTMLElement {
  const node = document.createElement(tag);
  if (className !== undefined) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

/**
 * Put the screen up and resolve once something is chosen. The overlay removes
 * itself first, so the caller can get on with loading against a clean page.
 */
export function showStartupScreen(
  host: HTMLElement,
  scenarios: readonly StartupScenario[],
  saves: readonly StartupSave[],
): Promise<StartupChoice> {
  return new Promise((resolve) => {
    const root = el('div', 'startup');
    root.append(el('h1', undefined, 'Blades of Exile'));

    const choose = (choice: StartupChoice): void => {
      root.remove();
      resolve(choice);
    };

    if (saves.length > 0) {
      root.append(el('h2', undefined, 'Continue a saved game'));
      const list = el('div', 'startup-list');
      for (const save of saves) {
        const button = el('button', 'startup-choice');
        button.append(el('strong', undefined, save.slot));
        button.append(el('small', undefined, save.label));
        // A save names its own scenario, so picking one here is also how a
        // party in a scenario other than the default gets opened at all.
        button.addEventListener('click', () => {
          choose({ scenarioId: save.scenarioId, slot: save.slot });
        });
        list.append(button);
      }
      root.append(list);
    }

    root.append(el('h2', undefined, 'Start a new game'));
    const list = el('div', 'startup-list');
    for (const scen of scenarios) {
      const button = el('button', 'startup-choice');
      button.append(el('strong', undefined, scen.title));
      if (scen.blurb !== '') button.append(el('small', undefined, scen.blurb));
      button.addEventListener('click', () => { choose({ scenarioId: scen.id }); });
      list.append(button);
    }
    root.append(list);

    host.append(root);
    // So Enter or a stray keypress doesn't fall through to nothing, and the
    // screen is reachable by keyboard alone.
    (root.querySelector('button') as HTMLElement | null)?.focus();
  });
}
