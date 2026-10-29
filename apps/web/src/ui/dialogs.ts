/**
 * Stack of open modal <dialog>s. Native modal dialogs give us focus
 * containment, Escape-to-close, and an inert background for free; this adds
 * stacking, focus return, and a "something is open" signal so the game pauses.
 */
export class DialogStack {
  private readonly stack: { dialog: HTMLDialogElement; returnFocus: Element | null }[] = [];
  onChange: ((anyOpen: boolean) => void) | null = null;

  get anyOpen() {
    return this.stack.length > 0;
  }

  open(dialog: HTMLDialogElement) {
    if (this.stack.some((entry) => entry.dialog === dialog)) return;
    this.stack.push({ dialog, returnFocus: document.activeElement });
    dialog.addEventListener('close', () => this.handleClosed(dialog), { once: true });
    dialog.showModal();
    this.onChange?.(true);
  }

  /** Close the top dialog (or a specific one). */
  close(dialog = this.stack.at(-1)?.dialog) {
    dialog?.close();
  }

  closeAll() {
    for (const { dialog } of [...this.stack].reverse()) dialog.close();
  }

  private handleClosed(dialog: HTMLDialogElement) {
    const index = this.stack.findIndex((entry) => entry.dialog === dialog);
    if (index === -1) return;
    const [entry] = this.stack.splice(index, 1);
    if (entry?.returnFocus instanceof HTMLElement && entry.returnFocus.isConnected) {
      entry.returnFocus.focus({ preventScroll: true });
    }
    this.onChange?.(this.anyOpen);
  }
}

/** Small DOM helper: create an element with attributes and children. */
export function h<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attrs: Record<string, string | boolean | ((e: Event) => void)> = {},
  ...children: (Node | string | null)[]
): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs)) {
    if (typeof value === 'function')
      el.addEventListener(key.replace(/^on/, '').toLowerCase(), value);
    else if (value === true) el.setAttribute(key, '');
    else if (value !== false) el.setAttribute(key, value);
  }
  for (const child of children) if (child !== null) el.append(child);
  return el;
}

/** A retro menu window as a modal dialog, with a title and a close button. */
export function retroDialog(id: string, title: string, ...body: Node[]) {
  const titleId = `${id}-title`;
  return h(
    'dialog',
    { id, class: 'retro-window', 'aria-labelledby': titleId },
    h(
      'div',
      { class: 'retro-window__header' },
      h('h2', { id: titleId, class: 'retro-window__title' }, title),
      h(
        'button',
        {
          type: 'button',
          class: 'retro-close',
          'aria-label': `Close ${title}`,
          onclick: (e) => (e.target as HTMLElement).closest('dialog')?.close(),
        },
        '✕',
      ),
    ),
    h('div', { class: 'retro-window__body' }, ...body),
  );
}
