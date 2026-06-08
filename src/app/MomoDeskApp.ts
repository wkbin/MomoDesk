import { BehaviorEngine } from "../core/BehaviorEngine";
import { CanvasPetRenderer } from "../renderer/CanvasPetRenderer";
import { PointerController } from "../interaction/PointerController";
import type { PetModel } from "../types/pet";

const INITIAL_SIZE = 220;

export class MomoDeskApp {
  private readonly renderer: CanvasPetRenderer;
  private readonly behavior: BehaviorEngine;
  private readonly pointer: PointerController;
  private readonly pet: PetModel;
  private lastFrame = performance.now();
  private rafId = 0;

  constructor(private readonly canvas: HTMLCanvasElement) {
    this.pet = {
      state: "idle",
      facing: "right",
      position: { x: INITIAL_SIZE / 2, y: INITIAL_SIZE * 0.72 },
      velocity: { x: 0, y: 0 },
      target: { x: INITIAL_SIZE / 2, y: INITIAL_SIZE * 0.72 },
      stateElapsedMs: 0,
      nextDecisionMs: 1200
    };

    this.renderer = new CanvasPetRenderer(canvas);
    this.behavior = new BehaviorEngine({
      width: INITIAL_SIZE,
      height: INITIAL_SIZE,
      floorY: INITIAL_SIZE * 0.74
    });
    this.pointer = new PointerController(canvas, this.pet, this.behavior);
  }

  start(): void {
    this.resize();
    window.addEventListener("resize", () => this.resize());
    this.pointer.attach();
    this.loop(this.lastFrame);
  }

  private resize(): void {
    this.renderer.resize(INITIAL_SIZE, INITIAL_SIZE);
  }

  private loop = (now: number): void => {
    const deltaMs = Math.min(now - this.lastFrame, 64);
    this.lastFrame = now;

    this.behavior.update(this.pet, deltaMs);
    this.renderer.render(this.pet, now);

    this.rafId = window.requestAnimationFrame(this.loop);
  };

  stop(): void {
    window.cancelAnimationFrame(this.rafId);
    this.pointer.detach();
  }
}
