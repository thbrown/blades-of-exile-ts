/**
 * The menu bar — the browser-layer replacement for the original's OS menus,
 * lifted from the WASM build's `web/menu.js` + `web/shell.html`.
 *
 * It exists for a reason beyond discoverability: **the File shortcuts can't all
 * be keyboard shortcuts.** Ctrl+L and Cmd+L are reserved by Chrome and Firefox
 * for the address bar and cannot be intercepted by a page at all — a keydown
 * handler never even runs — so a load bound to them silently does nothing. The
 * menu sidesteps the whole question.
 *
 * Deliberately plain DOM: the game is one canvas plus this bar, and a framework
 * would be the only one in the project.
 */

export interface MenuItem {
  label: string;
  /** Shown right-aligned; purely a hint, the binding lives in the key handler. */
  shortcut?: string;
  action: () => void;
  /** Re-asked every time the menu opens, so items can grey themselves out. */
  enabled?: () => boolean;
}

/** A horizontal rule between groups of items. */
export const MENU_SEPARATOR = Symbol('separator');

export interface Menu {
  label: string;
  items: (MenuItem | typeof MENU_SEPARATOR)[];
  /**
   * Items built afresh each time the menu opens, after the fixed ones — the
   * spell menus list what the current PC can cast *now* (`adjust_spell_menus`),
   * and the Monsters menu what the party has met.
   */
  dynamic?: () => (MenuItem | typeof MENU_SEPARATOR)[];
}

export interface MenuBar {
  /** Re-evaluate every item's `enabled`. Called on open, and after an action. */
  refresh(): void;
  /** Whether a dropdown is showing — the input router treats it like a dialog. */
  readonly open: boolean;
}

export function installMenuBar(host: HTMLElement, menus: Menu[]): MenuBar {
  host.textContent = '';
  const entries: { root: HTMLElement; items: { el: HTMLElement; item: MenuItem }[] }[] = [];

  const closeAll = (): void => {
    for (const entry of entries) entry.root.classList.remove('open');
  };

  const refresh = (): void => {
    for (const entry of entries) {
      for (const { el, item } of entry.items) {
        const on = item.enabled?.() ?? true;
        el.classList.toggle('disabled', !on);
      }
    }
  };

  for (const menu of menus) {
    const root = document.createElement('div');
    root.className = 'menu-item';
    root.append(menu.label);
    const dropdown = document.createElement('ul');
    dropdown.className = 'dropdown';
    const items: { el: HTMLElement; item: MenuItem }[] = [];

    const addEntry = (entry: MenuItem | typeof MENU_SEPARATOR, dynamic: boolean): void => {
      const li = document.createElement('li');
      if (dynamic) li.dataset['dynamic'] = '1';
      if (entry === MENU_SEPARATOR) {
        li.className = 'separator';
        dropdown.append(li);
        return;
      }
      li.append(entry.label);
      if (entry.shortcut !== undefined) {
        const hint = document.createElement('span');
        hint.textContent = entry.shortcut;
        li.append(hint);
      }
      li.addEventListener('click', (ev) => {
        ev.stopPropagation();
        if (li.classList.contains('disabled')) return;
        closeAll();
        entry.action();
        refresh();
      });
      items.push({ el: li, item: entry });
      dropdown.append(li);
    };
    for (const entry of menu.items) addEntry(entry, false);

    /** Throw away the last opening's dynamic items and build this one's. */
    const rebuild = (): void => {
      if (!menu.dynamic) return;
      for (const li of [...dropdown.querySelectorAll('li[data-dynamic]')]) li.remove();
      for (let i = items.length - 1; i >= 0; i--) {
        if (items[i]!.el.dataset['dynamic']) items.splice(i, 1);
      }
      for (const entry of menu.dynamic()) addEntry(entry, true);
    };

    root.append(dropdown);
    root.addEventListener('click', (ev) => {
      ev.stopPropagation();
      const wasOpen = root.classList.contains('open');
      closeAll();
      if (!wasOpen) {
        rebuild();
        refresh();
        root.classList.add('open');
      }
    });
    // Once one menu is open, sliding across the bar switches between them, the
    // way a real menu bar behaves.
    root.addEventListener('mouseenter', () => {
      if (!entries.some((e) => e.root.classList.contains('open'))) return;
      closeAll();
      rebuild();
      refresh();
      root.classList.add('open');
    });

    host.append(root);
    entries.push({ root, items });
  }

  document.addEventListener('click', closeAll);
  // Capture phase, so Escape closes the menu before the game's key handler
  // sees it and cancels whatever the player was doing.
  window.addEventListener('keydown', (ev) => {
    if (ev.key !== 'Escape') return;
    if (!entries.some((e) => e.root.classList.contains('open'))) return;
    ev.stopPropagation();
    closeAll();
  }, true);

  refresh();
  return {
    refresh,
    get open() {
      return entries.some((e) => e.root.classList.contains('open'));
    },
  };
}

/**
 * A Full Screen toggle at the right-hand end of the bar. It fullscreens the
 * whole page rather than the canvas, so the menu bar stays usable, and the
 * stylesheet's `:fullscreen` rules grow the canvas to fill the screen. Not
 * shown at all where the browser can't do it (iPhone Safari, some iframes).
 */
export function installFullScreenButton(host: HTMLElement): void {
  if (!document.fullscreenEnabled) return;
  const button = document.createElement('div');
  button.className = 'menu-item menu-right';
  const label = (): void => {
    const full = document.fullscreenElement !== null;
    button.title = full ? 'Exit Full Screen' : 'Full Screen';
    button.setAttribute('aria-label', button.title);
    // Corners pointing out to enter, pointing in to leave.
    const path = full
      ? 'M6 2v4H2M10 2v4h4M6 14v-4H2M10 14v-4h4'
      : 'M2 6V2h4M14 6V2h-4M2 10v4h4M14 10v4h-4';
    button.innerHTML = `<svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor"
      stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="${path}"/></svg>`;
  };
  label();
  button.addEventListener('click', (ev) => {
    ev.stopPropagation();
    if (document.fullscreenElement === null) void document.documentElement.requestFullscreen().catch(() => {});
    else void document.exitFullscreen().catch(() => {});
  });
  // Esc and F11 leave full screen without the button's help.
  document.addEventListener('fullscreenchange', label);
  host.append(button);
}
