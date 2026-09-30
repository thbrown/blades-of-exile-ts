/**
 * A full-screen sheet over the game for the panels a finger can't work at a
 * phone's scale — the inventory and the party list. Tapping either panel on
 * the canvas opens its sheet (with touch controls on), laid out as rows with
 * big buttons, and closes back to the game.
 *
 * It is only a face, like the other touch strips: `SheetView` is built from
 * the game's state by the host (`touchSheetViews.ts`), and a button hands its
 * row and action ids back to the host, which does exactly what a click on the
 * panel does.
 */

import type { Rect } from '../core/location';

export interface SheetIcon {
  sheet: CanvasImageSource & { width: number; height: number };
  rect: Rect;
  /** A key that changes when the picture does, for the rebuild check. */
  key: string;
}

export interface SheetAction {
  id: string;
  label: string;
  primary?: boolean;
}

export interface SheetRow {
  id: string;
  title: string;
  /** Classes for the title: `equipped weapon` and so on. */
  tone?: string;
  detail?: string;
  icon?: SheetIcon | null;
  on?: boolean;
  actions: SheetAction[];
}

export interface SheetTab {
  id: string;
  label: string;
  on: boolean;
}

export interface SheetView {
  title: string;
  subtitle?: string;
  tabs: SheetTab[];
  rows: SheetRow[];
  empty: string;
}

export interface TouchSheetHost {
  /** The open sheet's contents, or null when none should show. */
  view(): SheetView | null;
  tab(id: string): void;
  act(row: string, action: string): void;
  close(): void;
}

export class TouchSheet {
  private readonly root: HTMLElement;
  private shown = '';

  constructor(private readonly host: TouchSheetHost) {
    this.root = document.createElement('div');
    this.root.id = 'touch-sheet';
    this.root.hidden = true;
    // A tap here is the sheet's; the canvas under it mustn't take it as well.
    this.root.addEventListener('pointerdown', (ev) => ev.stopPropagation());
    document.body.append(this.root);
  }

  sync(on: boolean): void {
    const view = on ? this.host.view() : null;
    this.root.hidden = view === null;
    if (view === null) {
      this.shown = '';
      return;
    }
    const key = JSON.stringify(view, (k, v: unknown) => (k === 'sheet' ? undefined : v));
    if (key === this.shown) return;
    const list = this.root.querySelector('.sheet-rows');
    const scroll = list?.scrollTop ?? 0;
    const sameTabs = this.shown !== '' && this.tabsKey(view) === this.lastTabs;
    this.shown = key;
    this.build(view);
    // A button that changed only its row (Equip, say) leaves the list where it was.
    if (sameTabs) this.root.querySelector('.sheet-rows')!.scrollTop = scroll;
  }

  private lastTabs = '';
  private tabsKey(view: SheetView): string {
    return `${view.title}|${view.tabs.map((t) => `${t.id}${t.on ? '*' : ''}`).join(',')}`;
  }

  private build(view: SheetView): void {
    this.lastTabs = this.tabsKey(view);
    const el = <K extends keyof HTMLElementTagNameMap>(tag: K, cls = '', text = ''): HTMLElementTagNameMap[K] => {
      const e = document.createElement(tag);
      if (cls) e.className = cls;
      if (text) e.textContent = text;
      return e;
    };
    const button = (cls: string, text: string, onTap: () => void): HTMLButtonElement => {
      const b = el('button', cls, text);
      b.type = 'button';
      b.tabIndex = -1;
      b.addEventListener('click', onTap);
      return b;
    };

    const head = el('div', 'sheet-head');
    const titles = el('div', 'sheet-titles');
    titles.append(el('div', 'sheet-title', view.title));
    if (view.subtitle) titles.append(el('div', 'sheet-subtitle', view.subtitle));
    const close = button('sheet-close', '✕', () => this.host.close());
    close.title = 'Close';
    close.setAttribute('aria-label', 'Close');
    head.append(titles, close);

    const tabs = el('div', 'sheet-tabs');
    for (const tab of view.tabs) {
      tabs.append(button(`sheet-tab${tab.on ? ' on' : ''}`, tab.label, () => this.host.tab(tab.id)));
    }

    const rows = el('div', 'sheet-rows');
    if (view.rows.length === 0) rows.append(el('div', 'sheet-empty', view.empty));
    for (const row of view.rows) {
      const r = el('div', `sheet-row${row.on ? ' on' : ''}`);
      if (row.icon !== undefined) {
        const c = el('canvas', 'sheet-icon');
        if (row.icon) {
          const { rect, sheet } = row.icon;
          c.width = rect.width;
          c.height = rect.height;
          c.getContext('2d')?.drawImage(sheet, rect.left, rect.top, rect.width, rect.height,
            0, 0, rect.width, rect.height);
        }
        r.append(c);
      }
      const text = el('div', 'sheet-text');
      text.append(el('div', `sheet-name ${row.tone ?? ''}`, row.title));
      if (row.detail) text.append(el('div', 'sheet-detail', row.detail));
      const actions = el('div', 'sheet-actions');
      for (const a of row.actions) {
        actions.append(button(`sheet-act${a.primary ? ' primary' : ''}`, a.label,
          () => this.host.act(row.id, a.id)));
      }
      r.append(text, actions);
      rows.append(r);
    }

    const card = el('div', 'sheet-card');
    card.append(head);
    if (view.tabs.length > 0) card.append(tabs);
    card.append(rows);
    this.root.replaceChildren(card);
  }
}
