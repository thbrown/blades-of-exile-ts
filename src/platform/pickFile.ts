/**
 * Ask for a file from the local disk. Resolves null if the picker is dismissed
 * — which, since browsers fire no event for that, is detected by the window
 * regaining focus with nothing chosen. An empty `accept` lets any file through.
 */
export function pickLocalFile(accept: string): Promise<{ fileName: string; data: Uint8Array } | null> {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    if (accept !== '') input.accept = accept;
    let settled = false;
    const finish = (value: { fileName: string; data: Uint8Array } | null): void => {
      if (settled) return;
      settled = true;
      resolve(value);
    };
    input.onchange = () => {
      const file = input.files?.[0];
      if (file === undefined) {
        finish(null);
        return;
      }
      void file.arrayBuffer().then((buf) => {
        finish({ fileName: file.name, data: new Uint8Array(buf) });
      });
    };
    window.addEventListener('focus', () => {
      // Give the change event a moment to arrive first.
      setTimeout(() => { finish(null); }, 500);
    }, { once: true });
    input.click();
  });
}
