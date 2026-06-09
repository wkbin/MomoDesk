import { invoke } from "@tauri-apps/api/core";
import { LogicalSize, getCurrentWindow } from "@tauri-apps/api/window";
import { BehaviorEngine } from "../core/BehaviorEngine";
import { CanvasPetRenderer } from "../renderer/CanvasPetRenderer";
import { PointerController } from "../interaction/PointerController";
import type { PetModel, PetPersistState, PetState, Settings } from "../types/pet";

const INITIAL_SIZE = 220;
const SAVE_INTERVAL_MS = 5000;
const TAURI_AVAILABLE = "__TAURI_INTERNALS__" in window;

const DEFAULT_SETTINGS: Settings = {
  autostart: false,
  soundEnabled: true,
  activeLevel: "normal",
  scale: 1,
  alwaysOnTop: true,
  skinId: "default"
};
const RESTORABLE_STATES = new Set<PetState>([
  "idle",
  "walk",
  "sit",
  "sleep",
  "stretch",
  "groom",
  "eat",
  "drag",
  "fall"
]);

export class MomoDeskApp {
  private readonly renderer: CanvasPetRenderer;
  private readonly behavior: BehaviorEngine;
  private readonly pointer: PointerController;
  private readonly pet: PetModel;
  private settings: Settings = DEFAULT_SETTINGS;
  private lastFrame = performance.now();
  private lastSavedState: PetState;
  private saveTimerId = 0;
  private rafId = 0;

  constructor(private readonly canvas: HTMLCanvasElement) {
    const floorY = INITIAL_SIZE * 0.74;
    const defaultPos = { x: INITIAL_SIZE / 2, y: floorY };

    this.pet = {
      state: "idle",
      facing: "right",
      position: { ...defaultPos },
      velocity: { x: 0, y: 0 },
      target: { ...defaultPos },
      stateElapsedMs: 0,
      nextDecisionMs: 1200
    };
    this.lastSavedState = this.pet.state;

    this.renderer = new CanvasPetRenderer(canvas);
    this.behavior = new BehaviorEngine({
      width: INITIAL_SIZE,
      height: INITIAL_SIZE,
      floorY
    });
    this.pointer = new PointerController(canvas, this.pet, this.behavior);
  }

  async start(): Promise<void> {
    await this.loadPersistedState();
    await this.applySettings();

    window.addEventListener("resize", () => this.resize());
    this.attachTrayEvents();
    this.pointer.attach();
    this.canvas.addEventListener("pointerup", this.onPointerPersist);
    this.saveTimerId = window.setInterval(() => {
      void this.savePetState();
    }, SAVE_INTERVAL_MS);
    this.loop(this.lastFrame);
  }

  stop(): void {
    window.cancelAnimationFrame(this.rafId);
    window.clearInterval(this.saveTimerId);
    this.canvas.removeEventListener("pointerup", this.onPointerPersist);
    this.pointer.detach();
    void this.savePetState();
  }

  private async loadPersistedState(): Promise<void> {
    this.settings = await this.loadSettings();
    const state = await this.loadPetState();

    if (!state) {
      return;
    }

    this.resize();
    this.behavior.restorePosition(this.pet, state.position);
    this.behavior.setState(this.pet, this.toRestorableState(state.lastState));
    this.lastSavedState = this.pet.state;
  }

  private async loadSettings(): Promise<Settings> {
    if (!TAURI_AVAILABLE) {
      return DEFAULT_SETTINGS;
    }

    return this.tryTauri(() => invoke<Settings>("load_settings"), DEFAULT_SETTINGS);
  }

  private async loadPetState(): Promise<PetPersistState | null> {
    if (!TAURI_AVAILABLE) {
      return null;
    }

    return this.tryTauri(() => invoke<PetPersistState | null>("load_pet_state"), null);
  }

  private async applySettings(): Promise<void> {
    this.resize();

    if (!TAURI_AVAILABLE) {
      return;
    }

    const window = getCurrentWindow();
    await this.tryTauri(() => window.setAlwaysOnTop(this.settings.alwaysOnTop));
    await this.tryTauri(() =>
      window.setSize(new LogicalSize(this.getScaledSize(), this.getScaledSize()))
    );
  }

  private async savePetState(): Promise<void> {
    if (!TAURI_AVAILABLE) {
      return;
    }

    const state: PetPersistState = {
      position: this.behavior.getPosition(this.pet),
      lastState: this.pet.state,
      lastActiveAt: new Date().toISOString()
    };

    await this.tryTauri(() => invoke("save_pet_state", { state }));
  }

  private attachTrayEvents(): void {
    if (!TAURI_AVAILABLE) {
      return;
    }

    const window = getCurrentWindow();
    void window.listen("tray-recall", () => {
      this.behavior.restorePosition(this.pet, {
        x: INITIAL_SIZE / 2,
        y: INITIAL_SIZE * 0.74
      });
      this.behavior.setState(this.pet, "idle");
      void this.savePetState();
    });

    void window.listen("tray-feed", () => {
      this.behavior.feed(this.pet);
      void this.savePetState();
    });

    void window.listen("tray-sleep", () => {
      this.behavior.sleep(this.pet);
      void this.savePetState();
    });
  }

  private resize(): void {
    this.renderer.resize(INITIAL_SIZE, INITIAL_SIZE, this.getScaledSize(), this.getScaledSize());
    this.behavior.setBounds({
      width: INITIAL_SIZE,
      height: INITIAL_SIZE,
      floorY: INITIAL_SIZE * 0.74
    });
  }

  private loop = (now: number): void => {
    const deltaMs = Math.min(now - this.lastFrame, 64);
    this.lastFrame = now;

    this.behavior.update(this.pet, deltaMs);
    this.renderer.render(this.pet, now);
    this.saveOnStateChange();

    this.rafId = window.requestAnimationFrame(this.loop);
  };

  private saveOnStateChange(): void {
    if (this.pet.state === this.lastSavedState) {
      return;
    }

    this.lastSavedState = this.pet.state;
    void this.savePetState();
  }

  private onPointerPersist = (): void => {
    void this.savePetState();
  };

  private toRestorableState(state: PetState): PetState {
    if (!RESTORABLE_STATES.has(state)) {
      return "idle";
    }

    return state === "drag" ? "fall" : state;
  }

  private getScaledSize(): number {
    return Math.max(80, Math.round(INITIAL_SIZE * this.settings.scale));
  }

  private async tryTauri<T>(operation: () => Promise<T>, fallback?: T): Promise<T> {
    try {
      return await operation();
    } catch (error) {
      console.warn("Tauri operation failed", error);
      if (fallback !== undefined) {
        return fallback;
      }

      throw error;
    }
  }
}
