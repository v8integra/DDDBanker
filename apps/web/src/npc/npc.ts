import { headingOf, turnToward, wrapAngle } from '../camera/orbit';
import { Character, type CharacterLook } from '../player/character';

const TURN_SPEED = 9; // rad/s
const WAVE_COOLDOWN_S = 20;

/** Bank staff: stands at a post, turns to face whoever they're helping. */
export class Npc {
  readonly character: Character;
  private heading: number;
  private targetHeading: number;
  private sinceWave = Infinity;

  constructor(
    look: CharacterLook,
    readonly position: { x: number; y: number; z: number },
    private readonly restingHeading: number,
  ) {
    this.character = new Character(look);
    this.character.root.position.set(position.x, position.y, position.z);
    this.heading = this.targetHeading = restingHeading;
    this.character.root.rotation.y = restingHeading;
  }

  faceToward(x: number, z: number) {
    this.targetHeading = headingOf(x - this.position.x, z - this.position.z);
  }

  /** Wave hello, unless they waved recently. */
  greet() {
    if (this.sinceWave < WAVE_COOLDOWN_S) return;
    this.sinceWave = 0;
    this.character.wave();
  }

  resetFacing() {
    this.targetHeading = this.restingHeading;
  }

  /** True once the NPC has finished turning. */
  get settled() {
    return Math.abs(wrapAngle(this.targetHeading - this.heading)) < 0.02;
  }

  update(dt: number, reducedMotion: boolean) {
    this.sinceWave += dt;
    this.heading = reducedMotion
      ? this.targetHeading
      : turnToward(this.heading, this.targetHeading, TURN_SPEED * dt);
    this.character.root.rotation.y = this.heading;
    this.character.animate(dt, 0, reducedMotion);
  }
}
