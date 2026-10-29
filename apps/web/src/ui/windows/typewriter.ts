/** Characters per second for NPC lines. Brisk enough to never feel like waiting. */
export const TYPE_SPEED = 55;
/** Brief pause after sentence-ending punctuation, measured in "characters". */
const PAUSE_AFTER = { '.': 6, '!': 6, '?': 6, ',': 2 } as Record<string, number>;

/**
 * How many characters of `text` are visible `elapsedMs` after starting.
 * Pure, so the pacing (including pauses at punctuation) is testable.
 */
export function visibleChars(text: string, elapsedMs: number, cps = TYPE_SPEED) {
  let budget = (elapsedMs / 1000) * cps;
  for (let i = 0; i < text.length; i++) {
    const cost = 1 + (PAUSE_AFTER[text[i - 1] ?? ''] ?? 0);
    if (budget < cost) return i;
    budget -= cost;
  }
  return text.length;
}

/**
 * Types several paragraphs into elements one after another. Sighted users
 * see the animation; screen readers get the full text at once (the animated
 * copy is aria-hidden). Any key or click calls `finish()` to skip ahead.
 */
export class Typewriter {
  private start = 0;
  private raf = 0;
  private finished = false;
  readonly done: Promise<void>;
  private resolveDone!: () => void;

  constructor(
    private readonly targets: HTMLElement[],
    private readonly paragraphs: string[],
    reducedMotion: boolean,
  ) {
    this.done = new Promise((resolve) => (this.resolveDone = resolve));
    if (reducedMotion || paragraphs.join('').length === 0) {
      this.finish();
      return;
    }
    for (const t of targets) t.textContent = '';
    this.start = performance.now();
    this.raf = requestAnimationFrame(this.step);
  }

  get typing() {
    return !this.finished;
  }

  finish() {
    if (this.finished) return;
    this.finished = true;
    cancelAnimationFrame(this.raf);
    this.paragraphs.forEach((text, i) => {
      const target = this.targets[i];
      if (target) target.textContent = text;
    });
    this.resolveDone();
  }

  private readonly step = (now: number) => {
    let elapsed = now - this.start;
    for (let i = 0; i < this.paragraphs.length; i++) {
      const text = this.paragraphs[i]!;
      const shown = visibleChars(text, elapsed);
      this.targets[i]!.textContent = text.slice(0, shown);
      if (shown < text.length) {
        this.raf = requestAnimationFrame(this.step);
        return;
      }
      // Time spent on this paragraph, plus a short beat before the next.
      elapsed -= durationOf(text) + 180;
      if (elapsed < 0) {
        for (let j = i + 1; j < this.paragraphs.length; j++) this.targets[j]!.textContent = '';
        this.raf = requestAnimationFrame(this.step);
        return;
      }
    }
    this.finish();
  };
}

/** Milliseconds to type `text` fully. */
export function durationOf(text: string, cps = TYPE_SPEED) {
  let units = 0;
  for (let i = 0; i < text.length; i++) units += 1 + (PAUSE_AFTER[text[i - 1] ?? ''] ?? 0);
  return (units / cps) * 1000;
}
