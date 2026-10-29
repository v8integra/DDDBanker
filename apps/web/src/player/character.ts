import * as THREE from 'three';
import { toon } from '../engine/materials';

const SKIN_DARK = '#2b2233';
const CHEEK = '#ff9bb0';

export const SKIN_TONES = ['#ffe0c2', '#f1c27d', '#d9a066', '#a86b3c', '#7a4a2a'];

export interface CharacterLook {
  color: string;
  skin?: string;
  /** cap = the player's look; tie and bow dress up bank staff. */
  outfit?: 'cap' | 'tie' | 'bow';
  /** Accent for ties and bows. */
  accent?: string;
  name?: string;
}

/**
 * A chunky little bean of a person built from primitives, animated
 * procedurally (no rig): feet step, arms swing, body bobs.
 * Origin is at the feet; faces +Z. Used for the player and the bank's staff.
 */
export class Character {
  readonly root = new THREE.Group();
  private readonly body = new THREE.Group();
  private readonly feet: THREE.Mesh[] = [];
  private readonly arms: THREE.Mesh[] = [];
  private readonly colored: THREE.Mesh[] = [];
  private phase = 0;
  private amplitude = 0;
  private idleTime = 0;

  constructor({
    color,
    skin = SKIN_TONES[0]!,
    outfit = 'cap',
    accent = '#e8b04a',
    name = 'player',
  }: CharacterLook) {
    this.root.name = name;
    this.root.add(this.body);

    const torso = new THREE.Mesh(new THREE.CapsuleGeometry(0.34, 0.42, 6, 14), toon(color));
    torso.position.y = 0.72;
    this.colored.push(torso);

    const head = new THREE.Mesh(new THREE.SphereGeometry(0.33, 18, 14), toon(skin));
    head.position.y = 1.32;

    const eyeGeometry = new THREE.SphereGeometry(0.055, 10, 8);
    const cheekGeometry = new THREE.SphereGeometry(0.06, 8, 6);
    for (const side of [-1, 1]) {
      const eye = new THREE.Mesh(eyeGeometry, toon(SKIN_DARK));
      eye.position.set(side * 0.12, 1.36, 0.29);
      eye.scale.set(1, 1.25, 0.6);
      const cheek = new THREE.Mesh(cheekGeometry, toon(CHEEK));
      cheek.position.set(side * 0.2, 1.25, 0.25);
      cheek.scale.set(1, 0.6, 0.4);
      this.body.add(eye, cheek);
    }

    if (outfit === 'cap') {
      const cap = new THREE.Mesh(
        new THREE.SphereGeometry(0.345, 18, 10, 0, Math.PI * 2, 0, Math.PI / 2.4),
        toon(color),
      );
      cap.position.y = 1.36;
      const brim = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.22, 0.04, 14), toon(color));
      brim.position.set(0, 1.5, 0.24);
      brim.rotation.x = 0.25;
      this.colored.push(cap, brim);
      this.body.add(cap, brim);
    } else if (outfit === 'tie') {
      const knot = new THREE.Mesh(new THREE.SphereGeometry(0.05, 8, 6), toon(accent));
      knot.position.set(0, 1.02, 0.31);
      const tie = new THREE.Mesh(new THREE.ConeGeometry(0.075, 0.32, 4), toon(accent));
      tie.position.set(0, 0.84, 0.33);
      tie.rotation.set(-0.18, Math.PI / 4, Math.PI);
      const hair = new THREE.Mesh(
        new THREE.SphereGeometry(0.345, 18, 10, 0, Math.PI * 2, 0, Math.PI / 3),
        toon('#4a3426'),
      );
      hair.position.y = 1.34;
      this.body.add(knot, tie, hair);
    } else {
      for (const side of [-1, 1]) {
        const loop = new THREE.Mesh(new THREE.ConeGeometry(0.09, 0.16, 6), toon(accent));
        loop.position.set(side * 0.09, 1.66, -0.02);
        loop.rotation.z = (side * Math.PI) / 2;
        this.body.add(loop);
      }
      const hair = new THREE.Mesh(
        new THREE.SphereGeometry(0.35, 18, 10, 0, Math.PI * 2, 0, Math.PI / 2.6),
        toon('#6b3e26'),
      );
      hair.position.y = 1.35;
      this.body.add(hair);
    }

    const armGeometry = new THREE.CapsuleGeometry(0.08, 0.28, 4, 8).translate(0, -0.18, 0); // pivot at the shoulder
    for (const side of [-1, 1]) {
      const arm = new THREE.Mesh(armGeometry, toon(color));
      arm.position.set(side * 0.4, 0.95, 0);
      arm.rotation.z = side * 0.18;
      this.arms.push(arm);
      this.colored.push(arm);
    }

    const footGeometry = new THREE.SphereGeometry(0.12, 10, 8);
    for (const side of [-1, 1]) {
      const foot = new THREE.Mesh(footGeometry, toon(SKIN_DARK));
      foot.position.set(side * 0.15, 0.08, 0.04);
      foot.scale.set(1, 0.65, 1.4);
      this.feet.push(foot);
    }

    this.body.add(torso, head, ...this.arms, ...this.feet);
    this.root.traverse((o) => {
      if (o instanceof THREE.Mesh) o.castShadow = true;
    });
  }

  setColor(color: string) {
    for (const mesh of this.colored) mesh.material = toon(color);
  }

  /** `speed01` is current speed as a fraction of run speed. */
  animate(dt: number, speed01: number, reducedMotion: boolean) {
    const moving = speed01 > 0.02;
    this.phase += dt * (6 + speed01 * 7);
    this.idleTime = moving ? 0 : this.idleTime + dt;
    // Ease stride size toward the current speed so stopping settles smoothly.
    const targetAmplitude = reducedMotion ? 0 : Math.min(1, speed01 * 1.6);
    this.amplitude += (targetAmplitude - this.amplitude) * (1 - Math.exp(-dt * 10));

    const swing = Math.sin(this.phase) * this.amplitude;
    this.feet[0]!.position.z = 0.04 + swing * 0.18;
    this.feet[1]!.position.z = 0.04 - swing * 0.18;
    this.feet[0]!.position.y = 0.08 + Math.max(0, swing) * 0.06;
    this.feet[1]!.position.y = 0.08 + Math.max(0, -swing) * 0.06;
    this.arms[0]!.rotation.x = -swing * 0.7;
    this.arms[1]!.rotation.x = swing * 0.7;

    if (reducedMotion) {
      this.body.position.y = 0;
      this.body.rotation.x = 0;
      return;
    }
    const bob = Math.abs(swing) * 0.06;
    const breathe = moving ? 0 : Math.sin(this.idleTime * 2.2) * 0.012;
    this.body.position.y = bob + breathe;
    this.body.rotation.x = speed01 * 0.08; // lean into the walk
  }
}
