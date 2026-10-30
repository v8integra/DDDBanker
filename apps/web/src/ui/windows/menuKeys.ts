import { sounds } from '../../audio/sounds';

const UP = new Set(['ArrowUp', 'KeyW']);
const DOWN = new Set(['ArrowDown', 'KeyS']);

function isTextEntry(el: Element | null) {
  return (
    el instanceof HTMLElement &&
    (el.isContentEditable || ['INPUT', 'SELECT', 'TEXTAREA'].includes(el.tagName))
  );
}

/**
 * RPG-style menu keys for every window: arrows or W/S move between options
 * (wrapping), Home/End jump, Enter/Space press (native buttons), and
 * Backspace backs out of the top window, like Escape. Text fields keep
 * their keys.
 */
export function installMenuKeys(root: Document = document) {
  root.addEventListener('keydown', (e) => {
    const target = e.target as Element | null;
    if (!target || isTextEntry(target) || e.ctrlKey || e.metaKey || e.altKey) return;
    const dialog = target.closest('dialog[open]');
    if (!dialog) return;

    if (e.code === 'Backspace') {
      e.preventDefault();
      (dialog as HTMLDialogElement).close();
      return;
    }

    const menu = target.closest('.retro-menu');
    if (!menu || !target.matches('.retro-option')) return;
    const options = [...menu.querySelectorAll<HTMLButtonElement>('.retro-option:not(:disabled)')];
    const index = options.indexOf(target as HTMLButtonElement);
    if (index === -1) return;

    let next = -1;
    if (UP.has(e.code)) next = (index - 1 + options.length) % options.length;
    else if (DOWN.has(e.code)) next = (index + 1) % options.length;
    else if (e.code === 'Home') next = 0;
    else if (e.code === 'End') next = options.length - 1;
    if (next === -1) return;
    e.preventDefault();
    if (next !== index) sounds.play('move');
    options[next]!.focus();
  });
}
