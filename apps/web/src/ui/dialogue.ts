import { h, type DialogStack } from './dialogs';

export interface DialogueChoice<T extends string> {
  value: T;
  label: string;
}

export interface DialogueOptions<T extends string> {
  speaker: string;
  /** Small line under the name, e.g. the staff member's role. */
  role?: string;
  lines: string[];
  choices?: DialogueChoice<T>[];
}

/**
 * NPC dialogue box along the bottom of the screen, in the retro window
 * style. Modal, so focus stays inside and the game pauses. Resolves with the
 * chosen value, or null if closed with Escape or the close button.
 * (Phase 4 adds typewriter text and full menu windows on top of this.)
 */
export function showDialogue<T extends string = 'ok'>(
  dialogs: DialogStack,
  mount: HTMLElement,
  options: DialogueOptions<T>,
): Promise<T | null> {
  const choices = options.choices ?? [{ value: 'ok' as T, label: 'Okay' }];
  const titleId = `dialogue-${Math.random().toString(36).slice(2)}`;

  return new Promise((resolve) => {
    let result: T | null = null;
    const buttons = choices.map((choice, i) =>
      h(
        'button',
        {
          type: 'button',
          class: 'retro-option',
          ...(i === 0 ? { autofocus: true } : {}),
          onclick: () => {
            result = choice.value;
            dialog.close();
          },
        },
        choice.label,
      ),
    );
    const dialog = h(
      'dialog',
      { class: 'retro-window dialogue-box', 'aria-labelledby': titleId },
      h(
        'div',
        { class: 'dialogue-box__speaker' },
        h('h2', { id: titleId, class: 'retro-window__title' }, options.speaker),
        options.role ? h('span', { class: 'dialogue-box__role' }, options.role) : null,
      ),
      h('div', { class: 'dialogue-box__text' }, ...options.lines.map((line) => h('p', {}, line))),
      h(
        'div',
        { class: 'retro-menu dialogue-box__choices', role: 'group', 'aria-label': 'Responses' },
        ...buttons,
      ),
    );
    dialog.addEventListener('close', () => {
      dialog.remove();
      resolve(result);
    });
    mount.append(dialog);
    dialogs.open(dialog);
  });
}
