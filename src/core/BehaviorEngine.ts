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

const MOOD_MAX = 100;
const MOOD_MIN = 0;
const IDLE_DECAY_PER_SEC = -0.02;
const SLEEP_REGEN_PER_SEC = 0.08;
const NUDGE_BURST_WINDOW_MS = 4200;
const FEED_REPEAT_WINDOW_MS = 90000;
const DRAG_REPEAT_WINDOW_MS = 45000;

// ── Time-of-day categories ──────────────────────────────────────

type TimeCategory = "morning" | "noon" | "afternoon" | "evening" | "night";

function getTimeCategory(now = new Date()): TimeCategory {
  const h = now.getHours();
  if (h >= 6 && h < 11) return "morning";
  if (h >= 11 && h < 14) return "noon";
  if (h >= 14 && h < 18) return "afternoon";
  if (h >= 18 && h < 22) return "evening";
  return "night";
}

export class BehaviorEngine {
  private lastNudgeAtMs = 0;
  private nudgeBurstCount = 0;
  private lastFeedAtMs = 0;
  private feedRepeatCount = 0;
  private dragStartedAtMs = 0;
  private recentDragCount = 0;
  private lastDragAtMs = 0;

  constructor(private bounds: Bounds) {}

  setBounds(bounds: Bounds): void {
    this.bounds = bounds;
  }

  update(pet: PetModel, deltaMs: number): void {
    pet.stateElapsedMs += deltaMs;

    // Passive mood changes during idle/sit/sleep
    if (pet.state === "sleep") {
      this.adjustMood(pet, SLEEP_REGEN_PER_SEC * (deltaMs / 1000));
    } else if (pet.state === "idle" || pet.state === "sit") {
      this.adjustMood(pet, IDLE_DECAY_PER_SEC * (deltaMs / 1000));
    }

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
    pet.nextDecisionMs = this.randomDecisionDelay(state, pet.mood);
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
    this.dragStartedAtMs = Date.now();
    this.setState(pet, "drag");
  }

  dragTo(pet: PetModel, position: Vec2): void {
    pet.position = {
      x: this.clamp(position.x, 46, this.bounds.width - 46),
      y: this.clamp(position.y, 0, this.bounds.floorY)
    };
  }

  releaseDrag(pet: PetModel): void {
    this.adjustMood(pet, this.getDragMoodDelta());
    this.setState(pet, "fall");
    pet.velocity = { x: 0, y: 180 };
  }

  nudgeInteraction(pet: PetModel): void {
    const reaction = this.getNudgeReaction(pet);
    if (reaction.ignored) {
      this.adjustMood(pet, reaction.delta);
      this.deferNextDecision(pet);
      return;
    }

    this.adjustMood(pet, reaction.delta);
    const next = this.canStretchFrom(pet.state) && Math.random() > 0.5 ? "stretch" : "groom";
    this.setState(pet, next);
  }

  feed(pet: PetModel): void {
    this.adjustMood(pet, this.getFeedMoodDelta(pet));
    this.setState(pet, "eat");
  }

  applyExternalMoodAdjustment(pet: PetModel, delta: number): void {
    this.adjustMood(pet, this.clamp(delta, -8, 8));
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
        this.setState(pet, "sleep_to_idle");
        return;
      }

      this.deferNextDecision(pet);
      return;
    }

    if (pet.state === "sit") {
      // After sitting a while, either go to sleep or stand up
      if (Math.random() < 0.45) {
        this.setState(pet, "sleep");
      } else {
        this.setState(pet, "idle");
      }
      return;
    }

    if (pet.state !== "idle") {
      this.setState(pet, "idle");
      return;
    }

    this.chooseIdleAction(pet);
  }

  /** Pick the next idle action using mood-modulated weights. */
  private chooseIdleAction(pet: PetModel): void {
    const moodFactor = (pet.mood - 50) / 50; // -1 to +1
    const tod = getTimeCategory();

    // Time-of-day multipliers (applied after mood-based weights)
    const todMultiplier: Record<TimeCategory, { walk: number; sleep: number; stretch: number; follow: number }> = {
      morning:   { walk: 1.4, sleep: 0.4, stretch: 2.0, follow: 1.2 },
      noon:      { walk: 0.5, sleep: 2.4, stretch: 0.6, follow: 0.6 },
      afternoon: { walk: 1.0, sleep: 1.2, stretch: 1.0, follow: 1.0 },
      evening:   { walk: 1.8, sleep: 0.3, stretch: 1.2, follow: 1.6 },
      night:     { walk: 0.2, sleep: 3.2, stretch: 0.3, follow: 0.1 },
    };
    const tm = todMultiplier[tod];

    // Base weights at neutral mood (sum = 100)
    const deferWeight  = 40;
    const walkWeight   = Math.max(0, (16 + moodFactor * 12) * tm.walk);
    const sitWeight    = 10;
    const followWeight = Math.max(0, (8 + moodFactor * 8) * tm.follow);
    const groomWeight  = Math.max(0, 12 + Math.max(0, moodFactor) * 8);
    const stretchWeight = Math.max(0, (12 + Math.max(0, moodFactor) * 8) * tm.stretch);
    const sleepWeight  = Math.max(0, (10 + Math.max(0, -moodFactor) * 15) * tm.sleep);

    const total = deferWeight + walkWeight + sitWeight + followWeight + groomWeight + stretchWeight + sleepWeight;
    const roll = Math.random() * total;

    let acc = deferWeight;
    if (roll < acc) { this.deferNextDecision(pet); return; }
    acc += walkWeight;
    if (roll < acc) { this.startWalking(pet); return; }
    acc += sitWeight;
    if (roll < acc) { this.setState(pet, "sit"); return; }
    acc += followWeight;
    if (roll < acc) {
      // Signal to the desktop layer: next walk should head toward the cursor
      pet.followMouse = true;
      this.startWalking(pet);
      return;
    }
    acc += groomWeight;
    if (roll < acc) { this.setState(pet, "groom"); return; }
    acc += stretchWeight;
    if (roll < acc && this.canStretchFrom(pet.state)) { this.setState(pet, "stretch"); return; }

    this.setState(pet, "sleep");
  }

  private updateWalk(pet: PetModel, deltaMs: number): void {
    const dx = pet.target.x - pet.position.x;
    const distance = Math.abs(dx);

    if (distance < 2) {
      pet.position.x = pet.target.x;
      // Sometimes sit after walking instead of going straight to idle
      this.setState(pet, Math.random() < 0.25 ? "sit" : "idle");
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

    if (pet.state === "sleep_to_idle") {
      return pet.stateElapsedMs > 5100;
    }

    return false;
  }

  private isOneShotState(state: PetState): boolean {
    return state === "stretch" || state === "groom" || state === "eat" || state === "sleep_to_idle";
  }

  private randomDecisionDelay(state: PetState, mood: number): number {
    const moodFactor = (mood - 50) / 50; // -1 (sad) to +1 (happy)
    // High mood → shorter delays (more active); low mood → longer delays (lethargic)
    const speedMultiplier = 1 - moodFactor * 0.4; // 1.4 (sad) to 0.6 (happy)

    // Time-of-day speed modifier: evening = faster, night = slower
    const todSpeed: Record<TimeCategory, number> = {
      morning: 1.0,
      noon: 1.5,
      afternoon: 1.0,
      evening: 0.65,
      night: 2.5,
    };
    const tod = getTimeCategory();
    const todMultiplier = todSpeed[tod];

    if (state === "idle") {
      return Math.round(this.randomBetween(9000, 22000) * speedMultiplier * todMultiplier);
    }

    if (state === "sit") {
      return Math.round(this.randomBetween(12000, 26000) * speedMultiplier * todMultiplier);
    }

    if (state === "sleep") {
      return Math.round(this.randomBetween(9000, 18000) * speedMultiplier * todMultiplier);
    }

    return Math.round(this.randomBetween(1200, 2400) * speedMultiplier);
  }

  private deferNextDecision(pet: PetModel): void {
    pet.nextDecisionMs = this.randomDecisionDelay(pet.state, pet.mood);
  }

  private randomBetween(min: number, max: number): number {
    return min + Math.random() * (max - min);
  }

  private getNudgeReaction(pet: PetModel): { delta: number; ignored: boolean } {
    const now = Date.now();
    const repeated = now - this.lastNudgeAtMs < NUDGE_BURST_WINDOW_MS;
    this.nudgeBurstCount = repeated ? this.nudgeBurstCount + 1 : 1;
    this.lastNudgeAtMs = now;

    if (pet.mood < 15 && Math.random() < 0.4) {
      return { delta: this.randomBetween(-0.8, 0.4), ignored: true };
    }

    if (pet.state === "sleep") {
      return {
        delta: this.randomBetween(-3.5, -1.2) - Math.max(0, this.nudgeBurstCount - 1) * 0.8,
        ignored: Math.random() < 0.35
      };
    }

    const burstPenalty = Math.max(0, this.nudgeBurstCount - 2) * 1.8;
    const calmBonus = pet.state === "sit" || pet.state === "idle" ? 1 : 0;
    const moodSaturation = pet.mood > 80 ? 1.2 : 0;
    const delta = this.randomBetween(1.2, 4.4) + calmBonus - burstPenalty - moodSaturation;
    return { delta, ignored: false };
  }

  private getFeedMoodDelta(pet: PetModel): number {
    const now = Date.now();
    const repeated = now - this.lastFeedAtMs < FEED_REPEAT_WINDOW_MS;
    this.feedRepeatCount = repeated ? this.feedRepeatCount + 1 : 1;
    this.lastFeedAtMs = now;

    if (pet.state === "sleep") {
      return this.randomBetween(0.5, 4);
    }

    const repeatPenalty = Math.max(0, this.feedRepeatCount - 1) * 6;
    const lowMoodBonus = pet.mood < 35 ? 3 : 0;
    const highMoodPenalty = pet.mood > 82 ? 4 : 0;
    return this.randomBetween(10, 18) + lowMoodBonus - highMoodPenalty - repeatPenalty;
  }

  private getDragMoodDelta(): number {
    const now = Date.now();
    const durationMs = this.dragStartedAtMs > 0 ? now - this.dragStartedAtMs : 0;
    const repeated = now - this.lastDragAtMs < DRAG_REPEAT_WINDOW_MS;
    this.recentDragCount = repeated ? this.recentDragCount + 1 : 1;
    this.lastDragAtMs = now;
    this.dragStartedAtMs = 0;

    const durationPenalty = durationMs < 700
      ? this.randomBetween(-1.2, -0.2)
      : durationMs < 2500
        ? this.randomBetween(-3.5, -1.4)
        : this.randomBetween(-6.5, -3.2);
    const repeatPenalty = Math.max(0, this.recentDragCount - 1) * -1.3;
    return durationPenalty + repeatPenalty;
  }

  private adjustMood(pet: PetModel, delta: number): void {
    pet.mood = this.clamp(pet.mood + delta, MOOD_MIN, MOOD_MAX);
  }

  private canStretchFrom(state: PetState): boolean {
    // Sleep-to-stretch will get its own generated transition later.
    return state === "idle";
  }

  private clamp(value: number, min: number, max: number): number {
    return Math.max(min, Math.min(max, value));
  }
}
