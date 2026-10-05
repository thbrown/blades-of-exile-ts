/**
 * The click a dialog's control makes when it is pressed, by the mouse, its
 * key or a finger: 1997's `cd_press_button` (DLOGTOOL.CPP:1485) plays 37 for
 * a button and 34 for an LED. OBoE's `cControl::playClickSound` means the
 * same but tests `typeid(this) == typeid(cLed*)`, which `this`'s static type
 * never passes, so its LEDs play 37; this follows 1997.
 *
 * A hook, not an import of the sound player, so the dialogs stay headless:
 * `main.ts` sets it, tests leave it unset.
 */

let play: ((which: number) => void) | null = null;

export function setDialogClickSound(fn: ((which: number) => void) | null): void {
  play = fn;
}

export function dialogClick(led: boolean): void {
  play?.(led ? 34 : 37);
}
