import type * as THREE from 'three';
import type { Interactable } from '../interaction/interactables';
import { h } from './dialogs';

/**
 * Floating "E  Talk to the teller" label over whatever the player can use.
 * It's a button, so mouse and touch users can tap it too; it isn't in the
 * tab order (E / Enter is the keyboard path), and changes are announced.
 */
export class InteractPrompt {
  readonly el: HTMLButtonElement;
  private readonly label: HTMLElement;
  private current: Interactable | null = null;

  constructor(
    private readonly announce: (message: string) => void,
    onActivate: () => void,
  ) {
    this.label = h('span', {});
    this.el = h(
      'button',
      {
        type: 'button',
        class: 'interact-prompt',
        tabindex: '-1',
        hidden: true,
        onclick: onActivate,
      },
      h('kbd', {}, 'E'),
      this.label,
    );
  }

  get target() {
    return this.current;
  }

  update(
    target: Interactable | null,
    camera: THREE.Camera,
    canvas: HTMLCanvasElement,
    projected: THREE.Vector3,
  ) {
    if (target !== this.current) {
      this.current = target;
      this.el.hidden = !target;
      if (target) {
        this.label.textContent = target.prompt;
        this.announce(`${target.prompt}: press E.`);
      }
    }
    if (!target) return;

    projected.set(target.anchor.x, target.anchor.y, target.anchor.z).project(camera);
    const behind = projected.z > 1;
    const x = ((projected.x + 1) / 2) * canvas.clientWidth;
    const y = ((1 - projected.y) / 2) * canvas.clientHeight;
    this.el.style.transform = `translate(${Math.round(x)}px, ${Math.round(y)}px) translate(-50%, -100%)`;
    this.el.style.visibility = behind ? 'hidden' : 'visible';
  }
}
