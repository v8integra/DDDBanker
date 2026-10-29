/** Full-screen fade used for scene changes. Instant when reduced motion is on. */
export class Fade {
  private readonly el: HTMLElement;

  constructor(mount: HTMLElement) {
    this.el = document.createElement('div');
    this.el.className = 'fade';
    this.el.setAttribute('aria-hidden', 'true');
    mount.append(this.el);
  }

  to(opacity: 0 | 1, ms: number, reducedMotion: boolean): Promise<void> {
    const duration = reducedMotion ? 0 : ms;
    this.el.style.transitionDuration = `${duration}ms`;
    this.el.style.opacity = String(opacity);
    this.el.style.pointerEvents = opacity === 1 ? 'auto' : 'none';
    return new Promise((resolve) => setTimeout(resolve, duration));
  }
}
