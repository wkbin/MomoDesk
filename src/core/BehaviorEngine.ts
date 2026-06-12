import type { PetModel, PetState, Vec2 } from "../types/pet";

interface Bounds {
  width: number;
  height: number;
  floorY: number;
}

const WALK_SPEED = 34;
const GRAVITY = 1500;
const LANDING_DAMPING = 0.35;
const STRETCH_DURATION_MS = 5100;
const GROOM_DURATION_MS = 5100;
const EAT_DURATION_MS = 10050;
const MIN_SLEEP_DURATION_MS = 45000;

export class BehaviorEngine {
  constructor(private bounds: Bounds) {}

  setBounds(bounds: Bounds): void {
    this.bounds = bounds;
  }

  update(pet: PetModel, deltaMs: number): void {
    pet.stateElapsedMs += deltaMs;

    switch (pet.state) {
      case "walk":
        this.updateWalk(pet, deltaMs);
        break;
      case "fall":
        this.updateFall(pet, deltaMs);
        break;
      case "drag":
        break;
      default:
        this.updatePassiveState(pet, deltaMs);
        break;
    }
  }

  setState(pet: PetModel, state: PetState): void {
    if (pet.state === state) {
      return;
    }

    pet.state = state;
    pet.stateElapsedMs = 0;
    pet.nextDecisionMs = this.randomDecisionDelay(state);
    pet.velocity = { x: 0, y: 0 };
  }

  restorePosition(pet: PetModel, position: Vec2): void {
    const x = this.clamp(position.x, 46, this.bounds.width - 46);
    const y = this.clamp(position.y, 0, this.bounds.floorY);
    pet.position = { x, y };
    pet.target = { x, y: this.bounds.floorY };
    pet.velocity = { x: 0, y: 0 };
  }

  getPosition(pet: PetModel): Vec2 {
    return { ...pet.position };
  }

  beginDrag(pet: PetModel): void {
    this.setState(pet, "drag");
  }

  dragTo(pet: PetModel, position: Vec2): void {
    pet.position = {
      x: this.clamp(position.x, 46, this.bounds.width - 46),
      y: this.clamp(position.y, 0, this.bounds.floorY)
    };
  }

  releaseDrag(pet: PetModel): void {
    pet.velocity = { x: 0, y: 180 };
    this.setState(pet, "fall");
  }

  nudgeInteraction(pet: PetModel): void {
    const next = this.canStretchFrom(pet.state) && Math.random() > 0.5 ? "stretch" : "groom";
    this.setState(pet, next);
  }

  feed(pet: PetModel): void {
    this.setState(pet, "eat");
  }

  sleep(pet: PetModel): void {
    this.restorePosition(pet, {
      x: pet.position.x,
      y: this.bounds.floorY
    });
    this.setState(pet, "sleep");
  }

  private updatePassiveState(pet: PetModel, deltaMs: number): void {
    pet.nextDecisionMs -= deltaMs;

    if (this.isOneShotDone(pet)) {
      this.setState(pet, "idle");
      return;
    }

    if (this.isOneShotState(pet.state)) {
      return;
    }

    if (pet.nextDecisionMs > 0) {
      return;
    }

    if (pet.state === "sleep") {
      if (pet.stateElapsedMs > MIN_SLEEP_DURATION_MS && Math.random() < 0.28) {
        this.setState(pet, "idle");
        return;
      }

      this.deferNextDecision(pet);
      return;
    }

    if (pet.state !== "idle" && pet.state !== "sit") {
      this.setState(pet, "idle");
      return;
    }

    const roll = Math.random();

    if (roll < 0.48) {
      this.deferNextDecision(pet);
      return;
    }

    if (roll < 0.64) {
      this.startWalking(pet);
      return;
    }

    if (roll < 0.78) {
      this.setState(pet, "groom");
      return;
    }

    if (roll < 0.9 && this.canStretchFrom(pet.state)) {
      this.setState(pet, "stretch");
      return;
    }

    this.setState(pet, "sleep");
  }

  private updateWalk(pet: PetModel, deltaMs: number): void {
    const dx = pet.target.x - pet.position.x;
    const distance = Math.abs(dx);

    if (distance < 2) {
      pet.position.x = pet.target.x;
      this.setState(pet, "idle");
      return;
    }

    const direction = Math.sign(dx);
    pet.facing = direction < 0 ? "left" : "right";
    pet.position.x += direction * WALK_SPEED * (deltaMs / 1000);
    pet.position.x = this.clamp(pet.position.x, 46, this.bounds.width - 46);
  }

  private updateFall(pet: PetModel, deltaMs: number): void {
    const dt = deltaMs / 1000;
    pet.velocity.y += GRAVITY * dt;
    pet.position.y += pet.velocity.y * dt;

    if (pet.position.y >= this.bounds.floorY) {
      pet.position.y = this.bounds.floorY;
      pet.velocity.y *= -LANDING_DAMPING;

      if (Math.abs(pet.velocity.y) < 85) {
        this.setState(pet, "idle");
      }
    }
  }

  private startWalking(pet: PetModel): void {
    const margin = 48;
    const x = this.randomBetween(margin, this.bounds.width - margin);
    pet.target = { x, y: this.bounds.floorY };
    this.setState(pet, "walk");
  }

  private isOneShotDone(pet: PetModel): boolean {
    if (pet.state === "stretch") {
      return pet.stateElapsedMs > STRETCH_DURATION_MS;
    }

    if (pet.state === "groom") {
      return pet.stateElapsedMs > GROOM_DURATION_MS;
    }

    if (pet.state === "eat") {
      return pet.stateElapsedMs > EAT_DURATION_MS;
    }

    return false;
  }

  private isOneShotState(state: PetState): boolean {
    return state === "stretch" || state === "groom" || state === "eat";
  }

  private randomDecisionDelay(state: PetState): number {
    if (state === "idle") {
      return this.randomBetween(9000, 22000);
    }

    if (state === "sit") {
      return this.randomBetween(12000, 26000);
    }

    if (state === "sleep") {
      return this.randomBetween(9000, 18000);
    }

    return this.randomBetween(1200, 2400);
  }

  private deferNextDecision(pet: PetModel): void {
    pet.nextDecisionMs = this.randomDecisionDelay(pet.state);
  }

  private randomBetween(min: number, max: number): number {
    return min + Math.random() * (max - min);
  }

  private canStretchFrom(state: PetState): boolean {
    // Sleep-to-stretch will get its own generated transition later.
    return state === "idle";
  }

  private clamp(value: number, min: number, max: number): number {
    return Math.max(min, Math.min(max, value));
  }
}
