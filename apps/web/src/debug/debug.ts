import * as THREE from 'three';
import type { Physics } from '../engine/physics';

export const DEBUG = new URLSearchParams(location.search).has('debug');

/**
 * ?debug helpers: FPS + position readout and wireframes of every physics
 * collider, so collision problems can be seen and described.
 */
export class DebugOverlay {
  private readonly panel: HTMLElement;
  private readonly lines: THREE.LineSegments;
  private frames = 0;
  private elapsed = 0;
  private fps = 0;
  showColliders = true;

  constructor(
    scene: THREE.Scene,
    private readonly physics: Physics,
  ) {
    this.panel = document.createElement('div');
    this.panel.className = 'debug-panel';
    this.panel.setAttribute('aria-hidden', 'true');
    document.body.append(this.panel);

    this.lines = new THREE.LineSegments(
      new THREE.BufferGeometry(),
      new THREE.LineBasicMaterial({
        vertexColors: true,
        depthTest: false,
        transparent: true,
        opacity: 0.8,
      }),
    );
    this.lines.renderOrder = 999;
    this.lines.frustumCulled = false;
    scene.add(this.lines);

    window.addEventListener('keydown', (e) => {
      if (e.code === 'F3') {
        e.preventDefault();
        this.showColliders = !this.showColliders;
      }
    });
  }

  update(dt: number, info: Record<string, string | number>, renderer: THREE.WebGLRenderer) {
    this.frames++;
    this.elapsed += dt;
    if (this.elapsed >= 0.5) {
      this.fps = Math.round(this.frames / this.elapsed);
      this.frames = 0;
      this.elapsed = 0;
    }

    this.lines.visible = this.showColliders;
    if (this.showColliders) {
      const { vertices, colors } = this.physics.world.debugRender();
      const geometry = this.lines.geometry;
      geometry.setAttribute('position', new THREE.BufferAttribute(vertices, 3));
      geometry.setAttribute('color', new THREE.BufferAttribute(colors, 4));
    }

    const lines = [
      `fps ${this.fps}  draw calls ${renderer.info.render.calls}  tris ${renderer.info.render.triangles}`,
      ...Object.entries(info).map(([k, v]) => `${k} ${v}`),
      'F3 toggles collider wireframes',
    ];
    this.panel.textContent = lines.join('\n');
  }
}
