import { invoke } from "@tauri-apps/api/core";
import { PhysicalPosition, LogicalSize, currentMonitor, getCurrentWindow } from "@tauri-apps/api/window";
import { BehaviorEngine } from "../core/BehaviorEngine";
import { PetPackageLoader } from "../pet-package/PetPackageLoader";
import { CanvasPetRenderer } from "../renderer/CanvasPetRenderer";
import { PointerController } from "../interaction/PointerController";
import type { PetModel, PetPersistState, PetState, Settings } from "../types/pet";
import type { AnimationKey, PetPackageManifest } from "../types/pet-package";

const INITIAL_SIZE = 220;
const SAVE_INTERVAL_MS = 5000;
const PREVIEW_WALK_DURATION_MS = 6000;
const PREVIEW_WALK_SPEED_PX_PER_SECOND = 60;
const AUTONOMOUS_DESKTOP_WALK_SPEED_PX_PER_SECOND = 28;
const IDLE_LOOP_START_FRAME = 6;
const IDLE_LOOP_END_FRAME = 59;
const WALK_LEFT_LOOP_START_FRAME = 39;
const WALK_LEFT_LOOP_END_FRAME = 86;
const WALK_RIGHT_LOOP_START_FRAME = 39;
const WALK_RIGHT_LOOP_END_FRAME = 86;
const TAURI_AVAILABLE = "__TAURI_INTERNALS__" in window;
const DEFAULT_STATIC_IMAGE_URL = new URL(
  "../../assets/pets/default/preview/cat_static.png",
  import.meta.url
).href;
const DEFAULT_PET_PREVIEW_ASSETS = import.meta.glob("../../assets/pets/default/preview/*", {
  eager: true,
  query: "?url",
  import: "default"
}) as Record<string, string>;
const DEFAULT_PET_FRAME_ASSETS = import.meta.glob(
  "../../assets/pets/default/actions/*/frames/*.png",
  {
    eager: true,
    query: "?url",
    import: "default"
  }
) as Record<string, string>;

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
  private readonly packageLoader = new PetPackageLoader();
  private readonly pet: PetModel;
  private petPackage: PetPackageManifest | null = null;
  private settings: Settings = DEFAULT_SETTINGS;
  private lastFrame = performance.now();
  private lastSavedState: PetState;
  private previewStateUntilMs = 0;
  private windowWalkAnimation: {
    startedAt: number;
    durationMs: number;
    fromX: number;
    fromY: number;
    toX: number;
    toY: number;
    returnToIdleOnDone: boolean;
  } | null = null;
  private saveTimerId = 0;
  private rafId = 0;
  private desktopDragOrigin: {
    pointerX: number;
    pointerY: number;
    windowX: number;
    windowY: number;
  } | null = null;
  private desktopDragBounds: {
    minX: number;
    maxX: number;
    minY: number;
    maxY: number;
  } | null = null;
  private pendingDesktopWindowPosition: { x: number; y: number } | null = null;
  private desktopWindowMoveInFlight = false;
  private desktopAutonomousWalkStarting = false;

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
    this.pointer = new PointerController(canvas, this.pet, this.behavior, {
      onDesktopDragStart: TAURI_AVAILABLE ? this.beginDesktopDrag : undefined,
      onDesktopDragMove: TAURI_AVAILABLE ? this.updateDesktopDrag : undefined,
      onDesktopDragEnd: TAURI_AVAILABLE ? this.endDesktopDrag : undefined,
      windowDragHitRadius: TAURI_AVAILABLE ? 96 : undefined
    });
  }

  async start(): Promise<void> {
    this.resize();
    this.petPackage = await this.packageLoader.loadDefault();
    await this.applyPetPackage();
    await this.restoreDesktopState();

    window.addEventListener("resize", () => this.resize());
    window.addEventListener("keydown", this.onPreviewKeyDown);
    this.attachTrayEvents();
    this.pointer.attach();
    this.canvas.addEventListener("pointerup", this.onPointerPersist);
    this.saveTimerId = window.setInterval(() => {
      void this.savePetState();
    }, SAVE_INTERVAL_MS);
    this.loop(this.lastFrame);
    await this.showDesktopWindow();
  }

  stop(): void {
    window.cancelAnimationFrame(this.rafId);
    window.clearInterval(this.saveTimerId);
    window.removeEventListener("keydown", this.onPreviewKeyDown);
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

  private async restoreDesktopState(): Promise<void> {
    try {
      await this.loadPersistedState();
      await this.applySettings();
    } catch (error) {
      console.warn("Failed to restore desktop pet state", error);
    }
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
    await this.safeTauri(() => window.setAlwaysOnTop(this.settings.alwaysOnTop));
    await this.safeTauri(() =>
      window.setSize(new LogicalSize(this.getScaledSize(), this.getScaledSize()))
    );
  }

  private async applyPetPackage(): Promise<void> {
    if (!this.petPackage) {
      return;
    }

    document.title = `${this.petPackage.name} - MomoDesk`;
    this.canvas.dataset.petPackage = this.petPackage.id;

    if (this.petPackage.preview?.staticImage) {
      this.renderer.setStaticImage(
        this.resolveDefaultPetAsset(this.petPackage.preview.staticImage) ?? DEFAULT_STATIC_IMAGE_URL
      );
    }

    for (const [animationKey, animation] of Object.entries(this.petPackage.animations) as Array<
      [AnimationKey, PetPackageManifest["animations"][AnimationKey]]
    >) {
      const frameUrls = this.resolveDefaultPetFrameAssets(animation.frames);
      if (frameUrls.length === 0) {
        continue;
      }

      this.renderer.setFrameAnimation(animationKey, {
        fps: animation.fps,
        loop: animation.loop,
        frameUrls,
        frameWidth: this.petPackage.frameWidth,
        frameHeight: this.petPackage.frameHeight,
        anchor: this.petPackage.anchor,
        loopStartFrame: this.getAnimationLoopStartFrame(animationKey, animation),
        loopEndFrame: this.getAnimationLoopEndFrame(animationKey, animation)
      });
    }
    await this.renderer.preloadFrameAnimations();
  }

  private getAnimationLoopStartFrame(
    animationKey: AnimationKey,
    animation: PetPackageManifest["animations"][AnimationKey]
  ): number | undefined {
    if (animation.loopStartFrame !== undefined) {
      return animation.loopStartFrame;
    }

    if (animationKey === "idle") {
      return IDLE_LOOP_START_FRAME;
    }

    if (animationKey === "walk_left") {
      return WALK_LEFT_LOOP_START_FRAME;
    }

    if (animationKey === "walk_right") {
      return WALK_RIGHT_LOOP_START_FRAME;
    }

    return undefined;
  }

  private getAnimationLoopEndFrame(
    animationKey: AnimationKey,
    animation: PetPackageManifest["animations"][AnimationKey]
  ): number | undefined {
    if (animation.loopEndFrame !== undefined) {
      return animation.loopEndFrame;
    }

    if (animationKey === "idle") {
      return IDLE_LOOP_END_FRAME;
    }

    if (animationKey === "walk_left") {
      return WALK_LEFT_LOOP_END_FRAME;
    }

    if (animationKey === "walk_right") {
      return WALK_RIGHT_LOOP_END_FRAME;
    }

    return undefined;
  }

  private resolveDefaultPetAsset(path: string): string | null {
    const normalizedPath = path.replace(/\\/g, "/").replace(/^\.?\//, "");
    return DEFAULT_PET_PREVIEW_ASSETS[`../../assets/pets/default/${normalizedPath}`] ?? null;
  }

  private resolveDefaultPetFrameAssets(pattern: string): string[] {
    const normalizedPattern = pattern.replace(/\\/g, "/").replace(/^\.?\//, "");
    const [prefix, suffix = ""] = normalizedPattern.split("*");
    const assetPrefix = `../../assets/pets/default/${prefix}`;
    const assetSuffix = suffix;

    return Object.entries(DEFAULT_PET_FRAME_ASSETS)
      .filter(([path]) => path.startsWith(assetPrefix) && path.endsWith(assetSuffix))
      .sort(([a], [b]) => a.localeCompare(b, undefined, { numeric: true }))
      .map(([, url]) => url);
  }

  private async savePetState(): Promise<void> {
    if (!TAURI_AVAILABLE) {
      return;
    }

    const state: PetPersistState = {
      position: this.behavior.getPosition(this.pet),
      lastState: this.previewStateUntilMs > 0 ? "idle" : this.pet.state,
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
      this.cancelDesktopMotion();
      this.behavior.restorePosition(this.pet, {
        x: INITIAL_SIZE / 2,
        y: INITIAL_SIZE * 0.74
      });
      this.behavior.setState(this.pet, "idle");
      void this.savePetState();
    });

    void window.listen("tray-feed", () => {
      this.cancelDesktopMotion();
      this.behavior.feed(this.pet);
      void this.savePetState();
    });

    void window.listen("tray-sleep", () => {
      this.cancelDesktopMotion();
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

    if (this.isPreviewStateActive(now)) {
      this.pet.stateElapsedMs += deltaMs;
      void this.updateWindowWalk(now);
    } else {
      if (this.previewStateUntilMs > 0) {
        this.previewStateUntilMs = 0;
        this.windowWalkAnimation = null;
        this.behavior.setState(this.pet, "idle");
      }

      if (TAURI_AVAILABLE) {
        void this.updateDesktopAutonomy(deltaMs, now);
      } else {
        this.behavior.update(this.pet, deltaMs);
      }
    }
    this.keepPetAnchoredInDesktopWindow();
    this.keepDesktopPreviewInIdle();
    this.renderer.render(this.pet, now);
    this.saveOnStateChange();

    this.rafId = window.requestAnimationFrame(this.loop);
  };

  private keepPetAnchoredInDesktopWindow(): void {
    if (!TAURI_AVAILABLE) {
      return;
    }

    this.pet.position.x = INITIAL_SIZE / 2;
    this.pet.position.y = INITIAL_SIZE / 2;
    this.pet.target = { ...this.pet.position };
    this.pet.velocity = { x: 0, y: 0 };
  }

  private keepDesktopPreviewInIdle(): void {
    if (!TAURI_AVAILABLE || this.pet.state === "idle" || this.hasAnimationForCurrentState()) {
      return;
    }

    this.behavior.setState(this.pet, "idle");
  }

  private async updateDesktopAutonomy(deltaMs: number, now: number): Promise<void> {
    if (this.windowWalkAnimation?.returnToIdleOnDone && this.pet.state === "walk") {
      this.pet.stateElapsedMs += deltaMs;
      await this.updateWindowWalk(now);
      return;
    }

    if (this.pet.state === "walk") {
      if (!this.desktopAutonomousWalkStarting) {
        await this.startAutonomousDesktopWalk(now);
      }
      return;
    }

    const updatedState = this.updateBehaviorState(deltaMs);

    if (updatedState === "walk") {
      if (!this.desktopAutonomousWalkStarting) {
        await this.startAutonomousDesktopWalk(now);
      }
      return;
    }

    if (this.windowWalkAnimation?.returnToIdleOnDone) {
      this.windowWalkAnimation = null;
    }

    const oneShotDurationMs = this.getDesktopOneShotDurationMs(this.pet.state);
    if (oneShotDurationMs !== null && this.pet.stateElapsedMs >= oneShotDurationMs) {
      this.behavior.setState(this.pet, "idle");
    }
  }

  private updateBehaviorState(deltaMs: number): PetState {
    this.behavior.update(this.pet, deltaMs);
    return this.pet.state;
  }

  private cancelDesktopMotion(): void {
    this.previewStateUntilMs = 0;
    this.windowWalkAnimation = null;
    this.desktopAutonomousWalkStarting = false;
  }

  private getDesktopOneShotDurationMs(state: PetState): number | null {
    if (state === "fall") {
      return this.renderer.getFrameAnimationDurationMs("fall") ?? 1800;
    }

    if (state === "stretch") {
      return this.renderer.getFrameAnimationDurationMs("stretch") ?? 5100;
    }

    if (state === "groom") {
      return this.renderer.getFrameAnimationDurationMs("groom") ?? 5100;
    }

    if (state === "eat") {
      return this.renderer.getFrameAnimationDurationMs("eat") ?? 10050;
    }

    return null;
  }

  private hasAnimationForCurrentState(): boolean {
    if (this.pet.state === "walk") {
      return this.renderer.hasFrameAnimation(this.pet.facing === "left" ? "walk_left" : "walk_right")
        || this.renderer.hasFrameAnimation("walk_left");
    }

    return this.renderer.hasFrameAnimation(this.pet.state);
  }

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

  private onPreviewKeyDown = (event: KeyboardEvent): void => {
    if (event.key === "ArrowLeft") {
      event.preventDefault();
      void this.playPreviewWalk("left");
      return;
    }

    if (event.key === "ArrowRight") {
      event.preventDefault();
      void this.playPreviewWalk("right");
      return;
    }

    if (event.key === " ") {
      event.preventDefault();
      this.behavior.setState(this.pet, "idle");
    }
  };

  private async playPreviewWalk(facing: "left" | "right"): Promise<void> {
    this.pet.facing = facing;
    this.pet.position = {
      x: INITIAL_SIZE / 2,
      y: TAURI_AVAILABLE ? INITIAL_SIZE / 2 : INITIAL_SIZE * 0.74
    };
    this.pet.target = {
      x: this.pet.position.x,
      y: this.pet.position.y
    };
    this.behavior.setState(this.pet, "walk");
    const now = performance.now();
    const durationMs = PREVIEW_WALK_DURATION_MS;
    this.previewStateUntilMs = now + durationMs;

    if (!TAURI_AVAILABLE) {
      return;
    }

    const window = getCurrentWindow();
    try {
      const [position, size, monitor] = await Promise.all([
        window.outerPosition(),
        window.outerSize(),
        currentMonitor()
      ]);
      const distance = (durationMs / 1000) * PREVIEW_WALK_SPEED_PX_PER_SECOND;
      const signedDistance = facing === "left" ? -distance : distance;
      const targetX = position.x + signedDistance;
      const targetY = position.y;
      const bounds = monitor?.workArea ?? monitor;
      this.windowWalkAnimation = {
        startedAt: now,
        durationMs,
        fromX: position.x,
        fromY: position.y,
        toX: bounds
          ? this.clamp(targetX, bounds.position.x, bounds.position.x + bounds.size.width - size.width)
          : targetX,
        toY: bounds
          ? this.clamp(targetY, bounds.position.y, bounds.position.y + bounds.size.height - size.height)
          : targetY,
        returnToIdleOnDone: false
      };
    } catch (error) {
      console.warn("Failed to read desktop pet window position", error);
    }
  }

  private async startAutonomousDesktopWalk(now: number): Promise<void> {
    if (this.desktopAutonomousWalkStarting) {
      return;
    }

    this.desktopAutonomousWalkStarting = true;
    const window = getCurrentWindow();

    try {
      const [position, size, monitor] = await Promise.all([
        window.outerPosition(),
        window.outerSize(),
        currentMonitor()
      ]);
      const bounds = monitor?.workArea ?? monitor;
      const direction = Math.random() < 0.5 ? -1 : 1;
      const distance = 80 + Math.random() * 120;
      const targetX = position.x + direction * distance;
      const clampedX = bounds
        ? this.clamp(targetX, bounds.position.x, bounds.position.x + bounds.size.width - size.width)
        : targetX;
      const actualDistance = Math.abs(clampedX - position.x);

      if (actualDistance < 12) {
        this.behavior.setState(this.pet, "idle");
        return;
      }

      this.pet.facing = clampedX < position.x ? "left" : "right";
      this.windowWalkAnimation = {
        startedAt: now,
        durationMs: this.clamp(
          (actualDistance / AUTONOMOUS_DESKTOP_WALK_SPEED_PX_PER_SECOND) * 1000,
          2800,
          6200
        ),
        fromX: position.x,
        fromY: position.y,
        toX: clampedX,
        toY: position.y,
        returnToIdleOnDone: true
      };
    } catch (error) {
      console.warn("Failed to start autonomous desktop walk", error);
      this.behavior.setState(this.pet, "idle");
    } finally {
      this.desktopAutonomousWalkStarting = false;
    }
  }

  private isPreviewStateActive(now: number): boolean {
    return this.previewStateUntilMs > now && this.pet.state === "walk";
  }

  private async updateWindowWalk(now: number): Promise<void> {
    if (!TAURI_AVAILABLE || !this.windowWalkAnimation) {
      return;
    }

    const walk = this.windowWalkAnimation;
    const progress = Math.min(1, Math.max(0, (now - walk.startedAt) / walk.durationMs));
    const x = Math.round(walk.fromX + (walk.toX - walk.fromX) * progress);
    const y = Math.round(walk.fromY + (walk.toY - walk.fromY) * progress);

    await this.safeTauri(
      () => getCurrentWindow().setPosition(new PhysicalPosition(x, y)),
      "Failed to move desktop pet window"
    );

    if (progress >= 1 && walk.returnToIdleOnDone) {
      this.windowWalkAnimation = null;
      this.behavior.setState(this.pet, "idle");
    }
  }

  private beginDesktopDrag = (screenPoint: { x: number; y: number }): void => {
    this.previewStateUntilMs = 0;
    this.windowWalkAnimation = null;
    this.desktopAutonomousWalkStarting = false;

    void this.safeTauri(async () => {
      const window = getCurrentWindow();
      const [position, size, monitor] = await Promise.all([
        window.outerPosition(),
        window.outerSize(),
        currentMonitor()
      ]);

      const workArea = monitor?.workArea ?? monitor;
      this.desktopDragOrigin = {
        pointerX: screenPoint.x,
        pointerY: screenPoint.y,
        windowX: position.x,
        windowY: position.y
      };

      this.desktopDragBounds = workArea
        ? {
            minX: workArea.position.x,
            maxX: workArea.position.x + workArea.size.width - size.width,
            minY: workArea.position.y,
            maxY: workArea.position.y + workArea.size.height - size.height
          }
        : null;
    }, "Failed to capture desktop pet window position");
  };

  private updateDesktopDrag = (screenPoint: { x: number; y: number }): void => {
    if (!this.desktopDragOrigin) {
      return;
    }

    const nextPosition = {
      x: this.desktopDragOrigin.windowX + (screenPoint.x - this.desktopDragOrigin.pointerX),
      y: this.desktopDragOrigin.windowY + (screenPoint.y - this.desktopDragOrigin.pointerY)
    };

    this.pendingDesktopWindowPosition = this.desktopDragBounds
      ? {
          x: this.clamp(nextPosition.x, this.desktopDragBounds.minX, this.desktopDragBounds.maxX),
          y: this.clamp(nextPosition.y, this.desktopDragBounds.minY, this.desktopDragBounds.maxY)
        }
      : nextPosition;

    if (this.desktopWindowMoveInFlight) {
      return;
    }

    this.desktopWindowMoveInFlight = true;
    void this.flushDesktopWindowMove();
  };

  private endDesktopDrag = (): void => {
    this.desktopDragOrigin = null;
    this.desktopDragBounds = null;
    this.pendingDesktopWindowPosition = null;
  };

  private async flushDesktopWindowMove(): Promise<void> {
    while (this.pendingDesktopWindowPosition) {
      const nextPosition = this.pendingDesktopWindowPosition;
      this.pendingDesktopWindowPosition = null;

      await this.safeTauri(
        () => getCurrentWindow().setPosition(
          new PhysicalPosition(Math.round(nextPosition.x), Math.round(nextPosition.y))
        ),
        "Failed to move desktop pet window"
      );
    }

    this.desktopWindowMoveInFlight = false;
  }

  private toRestorableState(state: PetState): PetState {
    if (!RESTORABLE_STATES.has(state)) {
      return "idle";
    }

    return state === "drag" ? "fall" : state;
  }

  private getScaledSize(): number {
    return Math.max(80, Math.round(INITIAL_SIZE * this.settings.scale));
  }

  private clamp(value: number, min: number, max: number): number {
    if (max < min) {
      return min;
    }

    return Math.min(max, Math.max(min, value));
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

  private async safeTauri(
    operation: () => Promise<unknown>,
    message = "Tauri operation failed"
  ): Promise<void> {
    try {
      await operation();
    } catch (error) {
      console.warn(message, error);
    }
  }

  private async showDesktopWindow(): Promise<void> {
    if (!TAURI_AVAILABLE) {
      return;
    }

    await this.safeTauri(() => getCurrentWindow().show());
  }
}
