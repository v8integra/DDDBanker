import * as THREE from 'three';
import type RAPIER from '@dimforge/rapier3d-compat';
import { cameraRelativeMove, headingOf, turnToward } from '../camera/orbit';
import type { FrameInput } from '../engine/input';
import type { Physics } from '../engine/physics';
import { player as tuning } from '../theme';
import type { Character } from './character';
import { StuckDetector, steerToward, type Point2 } from './steering';

const FOOT_OFFSET = tuning.halfHeight + tuning.radius; // capsule center -> feet
const SKIN = 0.02; // controller offset: gap kept between capsule and walls

/** The player: a Rapier kinematic capsule driving the Character's visuals. */
export class Player {
  readonly collider: RAPIER.Collider;
  private onArrive: (() => void) | null = null;
  private readonly body: RAPIER.RigidBody;
  private readonly controller: RAPIER.KinematicCharacterController;
  private readonly velocity = new THREE.Vector2(); // x, z (m/s)
  private verticalSpeed = 0;
  private heading: number;
  private walkTarget: Point2 | null = null;
  private readonly stuck = new StuckDetector();
  private actualSpeed = 0;

  /** Feet position, updated after each physics step. */
  readonly position = new THREE.Vector3();

  /**
   * One Player per physics world (each scene has its own). The Character
   * (visuals) is shared and moves between scenes with the player.
   */
  constructor(
    private readonly physics: Physics,
    readonly character: Character,
    spawn: { x: number; y: number; z: number; facing: number },
  ) {
    const { rapier, world } = physics;
    this.body = world.createRigidBody(
      rapier.RigidBodyDesc.kinematicPositionBased().setTranslation(
        spawn.x,
        spawn.y + FOOT_OFFSET + SKIN,
        spawn.z,
      ),
    );
    this.collider = world.createCollider(
      rapier.ColliderDesc.capsule(tuning.halfHeight, tuning.radius),
      this.body,
    );

    this.controller = world.createCharacterController(SKIN);
    this.controller.enableAutostep(0.32, 0.15, false); // curbs and steps
    this.controller.enableSnapToGround(0.3);
    this.controller.setMaxSlopeClimbAngle((45 * Math.PI) / 180);
    this.controller.setApplyImpulsesToDynamicBodies(false);

    this.heading = spawn.facing;
    this.syncVisuals();
  }

  /**
   * Start walking to a ground point (click-to-move). `onArrive` runs only if
   * the walk completes (not if it's cancelled or blocked). Null cancels.
   */
  setWalkTarget(target: Point2 | null, onArrive?: () => void) {
    this.walkTarget = target;
    this.onArrive = target ? (onArrive ?? null) : null;
    this.stuck.reset();
  }

  /** Turn to face a point right away (e.g. the NPC you're talking to). */
  faceToward(x: number, z: number) {
    this.heading = headingOf(x - this.position.x, z - this.position.z);
    this.character.root.rotation.y = this.heading;
  }

  get hasWalkTarget() {
    return this.walkTarget !== null;
  }

  /** Instantly move (debug teleports, scene transitions). */
  teleport(x: number, y: number, z: number, facing = this.heading) {
    this.body.setTranslation({ x, y: y + FOOT_OFFSET + SKIN, z }, true);
    this.velocity.set(0, 0);
    this.verticalSpeed = 0;
    this.heading = facing;
    this.setWalkTarget(null);
    this.syncVisuals();
  }

  /** Compute this frame's movement. Call before Physics.step(). */
  update(dt: number, input: FrameInput, cameraYaw: number) {
    const speed = input.run ? tuning.runSpeed : tuning.walkSpeed;
    let desired: Point2 = { x: 0, z: 0 };

    if (input.manualMove) {
      this.setWalkTarget(null);
      const dir = cameraRelativeMove(input.move, cameraYaw);
      desired = { x: dir.x * speed, z: dir.z * speed };
    } else if (this.walkTarget) {
      const steer = steerToward({ x: this.position.x, z: this.position.z }, this.walkTarget, speed);
      const distance = Math.hypot(
        this.walkTarget.x - this.position.x,
        this.walkTarget.z - this.position.z,
      );
      if (!steer) {
        const arrive = this.onArrive;
        this.setWalkTarget(null);
        arrive?.();
      } else if (this.stuck.update(distance, dt)) {
        this.setWalkTarget(null);
      } else {
        desired = steer;
      }
    }

    // Quick but not instant acceleration feels responsive without jitter.
    const blend = 1 - Math.exp(-dt * 14);
    this.velocity.x += (desired.x - this.velocity.x) * blend;
    this.velocity.y += (desired.z - this.velocity.y) * blend;

    const grounded = this.controller.computedGrounded();
    this.verticalSpeed = grounded ? -1 : this.verticalSpeed + tuning.gravity * dt;

    this.controller.computeColliderMovement(this.collider, {
      x: this.velocity.x * dt,
      y: this.verticalSpeed * dt,
      z: this.velocity.y * dt,
    });
    const moved = this.controller.computedMovement();
    const current = this.body.translation();
    this.body.setNextKinematicTranslation({
      x: current.x + moved.x,
      y: current.y + moved.y,
      z: current.z + moved.z,
    });

    this.actualSpeed = dt > 0 ? Math.hypot(moved.x, moved.z) / dt : 0;
    if (Math.hypot(desired.x, desired.z) > 0.1) {
      this.heading = turnToward(
        this.heading,
        headingOf(desired.x, desired.z),
        tuning.turnSpeed * dt,
      );
    }
  }

  /** Copy physics state to the visuals. Call after Physics.step(). */
  afterStep(dt: number, reducedMotion: boolean) {
    this.syncVisuals();
    this.character.animate(dt, Math.min(1, this.actualSpeed / tuning.runSpeed), reducedMotion);
  }

  private syncVisuals() {
    const t = this.body.translation();
    this.position.set(t.x, t.y - FOOT_OFFSET - SKIN, t.z);
    this.character.root.position.copy(this.position);
    this.character.root.rotation.y = this.heading;
  }

  get facing() {
    return this.heading;
  }

  dispose() {
    this.physics.world.removeCharacterController(this.controller);
    this.physics.world.removeRigidBody(this.body);
  }
}
