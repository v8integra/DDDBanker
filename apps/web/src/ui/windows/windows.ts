import { ApiRequestError } from '../../api/client';
import { h, type DialogStack } from '../dialogs';
import { NO_ERRORS, errorsFromApi, hasErrors, type FormErrors } from './formErrors';
import type { MoneyCell } from './money';
import { Typewriter } from './typewriter';

export interface Choice<T extends string> {
  value: T;
  label: string;
  hint?: string;
}

export interface DialogueOptions<T extends string> {
  speaker: string;
  /** Small line under the name, e.g. the staff member's role. */
  role?: string;
  lines: string[];
  choices?: Choice<T>[];
}

export interface FieldDef {
  name: string;
  label: string;
  type: 'text' | 'email' | 'password' | 'money' | 'select' | 'date' | 'code' | 'textarea';
  /** Starting value. */
  value?: string;
  autocomplete?: string;
  hint?: string;
  options?: { value: string; label: string }[];
  maxLength?: number;
}

export type FormValues = Record<string, string>;

export interface FormOptions<R> {
  title: string;
  intro?: string[];
  /** Highlighted notice above the fields (the demo-bank disclaimer). */
  notice?: string;
  fields: FieldDef[];
  /** Small print under the fields. */
  footnote?: string;
  submitLabel: string;
  cancelLabel?: string;
  /** Client-side checks (shared Zod schemas). The server still has the final say. */
  validate?: (values: FormValues) => FormErrors;
  /** Send to the API. Throwing ApiRequestError shows its errors inline and keeps the form open. */
  submit: (values: FormValues) => Promise<R>;
}

export interface TableColumn {
  label: string;
  align?: 'start' | 'end';
}
export type TableCell = string | MoneyCell;

/**
 * Throw from a form's `submit` to stop quietly with the form still open,
 * e.g. when the person answers "No" on the confirmation that `submit` showed.
 */
export class FormCancelled extends Error {
  override name = 'FormCancelled';
}

let idCounter = 0;
const uid = (prefix: string) => `${prefix}-${++idCounter}`;
const isMoney = (cell: unknown): cell is MoneyCell =>
  typeof cell === 'object' && cell !== null && 'tone' in cell;

function moneyNode(cell: MoneyCell) {
  return h('span', { class: `money money--${cell.tone}`, 'aria-label': cell.label }, cell.text);
}

/**
 * The retro menu window system. Every window is a native modal <dialog> on
 * the shared DialogStack, so windows stack (menu → form → confirm → result),
 * focus stays in the top one, Escape (or Backspace) backs out one level, and
 * focus returns to where it was. Each method resolves when its window closes.
 */
export class Windows {
  constructor(
    private readonly dialogs: DialogStack,
    private readonly mount: HTMLElement,
    private readonly reducedMotion: () => boolean,
  ) {}

  /** NPC speech along the bottom of the screen, typed out, with optional choices. */
  dialogue<T extends string = 'ok'>(options: DialogueOptions<T>): Promise<T | null> {
    const choices = options.choices ?? [{ value: 'ok' as T, label: 'Okay' }];
    const titleId = uid('dialogue');
    const visible = options.lines.map(() => h('p', { 'aria-hidden': 'true' }));
    const spoken = h(
      'div',
      { class: 'visually-hidden' },
      ...options.lines.map((line) => h('p', {}, line)),
    );
    const text = h('div', { class: 'dialogue-box__text' }, spoken, ...visible);

    return this.present<T>((settle) => {
      const typer = new Typewriter(visible, options.lines, this.reducedMotion());
      const menu = this.optionButtons(choices, settle);
      const dialog = h(
        'dialog',
        { class: 'retro-window dialogue-box', 'aria-labelledby': titleId },
        h(
          'div',
          { class: 'dialogue-box__speaker' },
          h('h2', { id: titleId, class: 'retro-window__title' }, options.speaker),
          options.role ? h('span', { class: 'dialogue-box__role' }, options.role) : null,
        ),
        text,
        menu,
      );
      // First key or click while typing just finishes the text.
      dialog.addEventListener(
        'keydown',
        (e) => {
          if (typer.typing && !['Tab', 'Escape', 'ShiftLeft', 'ShiftRight'].includes(e.code)) {
            e.preventDefault();
            e.stopPropagation();
            typer.finish();
          }
        },
        true,
      );
      text.addEventListener('click', () => typer.finish());
      dialog.addEventListener('close', () => typer.finish());
      return dialog;
    });
  }

  /** A list of options in a window. Resolves with the chosen value, or null on back. */
  options<T extends string>(options: {
    title: string;
    text?: string[];
    choices: Choice<T>[];
  }): Promise<T | null> {
    return this.present<T>((settle) =>
      this.window(options.title, [
        ...(options.text ?? []).map((line) => h('p', { class: 'retro-text' }, line)),
        this.optionButtons(options.choices, settle),
      ]),
    );
  }

  /** "Are you sure?" Resolves true only for an explicit yes. */
  async confirm(options: {
    title: string;
    text: string[];
    confirmLabel: string;
    cancelLabel?: string;
    danger?: boolean;
  }) {
    const choice = await this.present<'yes' | 'no'>((settle) =>
      this.window(options.title, [
        ...options.text.map((line) => h('p', { class: 'retro-text' }, line)),
        this.optionButtons(
          [
            { value: 'yes', label: options.confirmLabel },
            { value: 'no', label: options.cancelLabel ?? 'No, go back' },
          ],
          settle,
          options.danger ? 1 : 0, // risky actions start on the safe answer
        ),
      ]),
    );
    return choice === 'yes';
  }

  /** Outcome of an action. Tone is shown with an icon and a word, not just color. */
  async result(options: {
    title: string;
    tone: 'success' | 'error' | 'info';
    lines: string[];
    extra?: Node;
  }) {
    const icon = { success: '✓', error: '⚠', info: 'ℹ' }[options.tone];
    const word = { success: 'Done', error: 'Problem', info: 'Note' }[options.tone];
    await this.present<'ok'>((settle) =>
      this.window(
        options.title,
        [
          h(
            'p',
            { class: `result-banner result-banner--${options.tone}` },
            h('span', { 'aria-hidden': 'true' }, icon),
            ` ${word}`,
          ),
          ...options.lines.map((line) => h('p', { class: 'retro-text' }, line)),
          options.extra ?? null,
          this.optionButtons([{ value: 'ok', label: 'Okay' }], settle),
        ],
        options.tone === 'error' ? 'alertdialog' : undefined,
      ),
    );
  }

  /** Read-only label/value pairs (an account summary, a policy). */
  async detail(options: { title: string; items: { label: string; value: string | MoneyCell }[] }) {
    await this.present<'ok'>((settle) =>
      this.window(options.title, [
        h(
          'dl',
          { class: 'detail-list' },
          ...options.items.flatMap(({ label, value }) => [
            h('dt', {}, label),
            h('dd', {}, isMoney(value) ? moneyNode(value) : value),
          ]),
        ),
        this.optionButtons([{ value: 'ok', label: 'Okay' }], settle),
      ]),
    );
  }

  /** A data table (accounts, transactions). Ends with `choices` (default: Okay) and resolves with the pick. */
  async table<T extends string = 'ok'>(options: {
    title: string;
    caption: string;
    columns: TableColumn[];
    rows: TableCell[][];
    empty?: string;
    note?: string;
    choices?: Choice<T>[];
  }): Promise<T | null> {
    return this.present<T>((settle) => {
      const align = (i: number) => (options.columns[i]?.align === 'end' ? 'cell--end' : '');
      const table = options.rows.length
        ? h(
            'div',
            { class: 'table-wrap', tabindex: '0', role: 'region', 'aria-label': options.caption },
            h(
              'table',
              { class: 'retro-table' },
              h('caption', { class: 'visually-hidden' }, options.caption),
              h(
                'thead',
                {},
                h(
                  'tr',
                  {},
                  ...options.columns.map((c, i) =>
                    h('th', { scope: 'col', class: align(i) }, c.label),
                  ),
                ),
              ),
              h(
                'tbody',
                {},
                ...options.rows.map((row) =>
                  h(
                    'tr',
                    {},
                    ...row.map((cell, i) =>
                      h(
                        i === 0 ? 'th' : 'td',
                        { ...(i === 0 ? { scope: 'row' } : {}), class: align(i) },
                        isMoney(cell) ? moneyNode(cell) : cell,
                      ),
                    ),
                  ),
                ),
              ),
            ),
          )
        : h('p', { class: 'retro-text' }, options.empty ?? 'Nothing to show yet.');
      return this.window(
        options.title,
        [
          table,
          options.note ? h('p', { class: 'retro-note' }, options.note) : null,
          this.optionButtons(options.choices ?? [{ value: 'ok' as T, label: 'Okay' }], settle),
        ],
        undefined,
        'retro-window--wide',
      );
    });
  }

  /**
   * A form with real labeled inputs. Client checks run first; then `submit`
   * calls the API. Server errors show inline and the form stays open.
   * Resolves with the submit result, or null if the person backs out.
   */
  form<R>(options: FormOptions<R>): Promise<R | null> {
    return this.present<R>((settle) => {
      const formError = h('p', { class: 'form-error', role: 'alert', hidden: true });
      const inputs = new Map<string, HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>();
      const errorEls = new Map<string, HTMLElement>();

      const fieldNodes = options.fields.map((field, index) => {
        const id = uid(`field-${field.name}`);
        const hintId = `${id}-hint`;
        const errorId = `${id}-error`;
        const error = h('p', { class: 'field__error', id: errorId, hidden: true });
        errorEls.set(field.name, error);

        let control: HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement;
        if (field.type === 'textarea') {
          control = h('textarea', {
            id,
            name: field.name,
            rows: '4',
            ...(field.maxLength ? { maxlength: String(field.maxLength) } : {}),
          });
          if (field.value !== undefined) control.value = field.value;
        } else if (field.type === 'select') {
          control = h(
            'select',
            { id, name: field.name },
            ...(field.options ?? []).map((o) => h('option', { value: o.value }, o.label)),
          );
          if (field.value !== undefined) control.value = field.value;
        } else {
          control = h('input', {
            id,
            name: field.name,
            type: field.type === 'money' || field.type === 'code' ? 'text' : field.type,
            ...(field.type === 'money' ? { inputmode: 'decimal', placeholder: '0.00' } : {}),
            ...(field.type === 'code'
              ? { inputmode: 'numeric', maxlength: '6', placeholder: '000000' }
              : {}),
            ...(field.value !== undefined ? { value: field.value } : {}),
            ...(field.autocomplete ? { autocomplete: field.autocomplete } : {}),
            ...(field.maxLength ? { maxlength: String(field.maxLength) } : {}),
            spellcheck: 'false',
          });
        }
        control.setAttribute(
          'aria-describedby',
          [field.hint ? hintId : '', errorId].filter(Boolean).join(' '),
        );
        if (index === 0) control.autofocus = true;
        inputs.set(field.name, control);

        const reveal =
          field.type === 'password'
            ? h(
                'button',
                {
                  type: 'button',
                  class: 'field__reveal',
                  'aria-pressed': 'false',
                  'aria-label': `Show ${field.label.toLowerCase()}`,
                  onclick: (e) => {
                    const button = e.currentTarget as HTMLButtonElement;
                    const showing = (control as HTMLInputElement).type === 'text';
                    (control as HTMLInputElement).type = showing ? 'password' : 'text';
                    button.setAttribute('aria-pressed', String(!showing));
                    button.textContent = showing ? 'Show' : 'Hide';
                  },
                },
                'Show',
              )
            : null;

        return h(
          'div',
          { class: 'field' },
          h('label', { for: id }, field.label),
          field.hint ? h('p', { class: 'field__hint', id: hintId }, field.hint) : null,
          h('div', { class: 'field__control' }, control, reveal),
          error,
        );
      });

      const showErrors = (errors: FormErrors) => {
        let firstInvalid: HTMLElement | null = null;
        for (const field of options.fields) {
          const message = errors.fields[field.name];
          const input = inputs.get(field.name)!;
          const el = errorEls.get(field.name)!;
          el.hidden = !message;
          el.textContent = message ? `⚠ ${message}` : '';
          input.setAttribute('aria-invalid', String(Boolean(message)));
          if (message && !firstInvalid) firstInvalid = input;
        }
        formError.hidden = !errors.form;
        formError.textContent = errors.form ? `⚠ ${errors.form}` : '';
        if (firstInvalid) firstInvalid.focus();
      };

      const submitButton = h(
        'button',
        { type: 'submit', class: 'retro-option retro-option--primary' },
        options.submitLabel,
      );
      const form = h(
        'form',
        { class: 'retro-form', novalidate: true },
        ...(options.intro ?? []).map((line) => h('p', { class: 'retro-text' }, line)),
        options.notice
          ? h('p', { class: 'notice' }, h('span', { 'aria-hidden': 'true' }, '⚠ '), options.notice)
          : null,
        formError,
        ...fieldNodes,
        options.footnote ? h('p', { class: 'retro-note' }, options.footnote) : null,
        h(
          'div',
          { class: 'retro-actions' },
          h(
            'button',
            {
              type: 'button',
              class: 'retro-option retro-option--quiet',
              onclick: () => settle(null),
            },
            options.cancelLabel ?? 'Back',
          ),
          submitButton,
        ),
      );

      let sending = false;
      form.addEventListener('submit', (e) => {
        e.preventDefault();
        if (sending) return; // no double submits
        const values: FormValues = {};
        for (const [name, input] of inputs) values[name] = input.value;

        const clientErrors = options.validate?.(values) ?? NO_ERRORS;
        showErrors(clientErrors);
        if (hasErrors(clientErrors)) return;

        sending = true;
        submitButton.disabled = true;
        submitButton.textContent = 'One moment…';
        form.setAttribute('aria-busy', 'true');
        options.submit(values).then(
          (result) => settle(result),
          (err: unknown) => {
            sending = false;
            submitButton.disabled = false;
            submitButton.textContent = options.submitLabel;
            form.removeAttribute('aria-busy');
            if (err instanceof FormCancelled) return; // "No, go back" on the confirm: stay put
            showErrors(
              err instanceof ApiRequestError
                ? errorsFromApi(
                    err.body,
                    options.fields.map((f) => f.name),
                  )
                : errorsFromApi(null, []),
            );
          },
        );
      });

      return this.window(options.title, [form], undefined, 'retro-window--form');
    });
  }

  // ---------- building blocks ----------

  private window(title: string, body: (Node | null)[], role?: 'alertdialog', extraClass = '') {
    const titleId = uid('window');
    return h(
      'dialog',
      {
        class: `retro-window ${extraClass}`.trim(),
        'aria-labelledby': titleId,
        ...(role ? { role } : {}),
      },
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

  private optionButtons<T extends string>(
    choices: Choice<T>[],
    settle: (value: T | null) => void,
    focusIndex = 0,
  ) {
    return h(
      'div',
      { class: 'retro-menu', role: 'group', 'aria-label': 'Options' },
      ...choices.map((choice, i) =>
        h(
          'button',
          {
            type: 'button',
            class: 'retro-option',
            ...(i === focusIndex ? { autofocus: true } : {}),
            onclick: () => settle(choice.value),
          },
          choice.label,
          choice.hint ? h('span', { class: 'retro-option__hint' }, choice.hint) : null,
        ),
      ),
    );
  }

  /** Open a window and resolve with whatever `settle` receives (null if closed another way). */
  private present<T>(
    build: (settle: (value: T | null) => void) => HTMLDialogElement,
  ): Promise<T | null> {
    return new Promise((resolve) => {
      let result: T | null = null;
      let dialog: HTMLDialogElement | null = null;
      const settle = (value: T | null) => {
        result = value;
        dialog?.close();
      };
      dialog = build(settle);
      dialog.addEventListener('close', () => {
        dialog!.remove();
        resolve(result);
      });
      this.mount.append(dialog);
      this.dialogs.open(dialog);
    });
  }
}
