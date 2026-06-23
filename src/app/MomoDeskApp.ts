import { invoke } from "@tauri-apps/api/core";
import {
  PhysicalPosition,
  LogicalSize,
  availableMonitors,
  currentMonitor,
  cursorPosition,
  getCurrentWindow
} from "@tauri-apps/api/window";
import { emitTo, listen } from "@tauri-apps/api/event";
import { WebviewWindow } from "@tauri-apps/api/webviewWindow";
import { BehaviorEngine } from "../core/BehaviorEngine";
import { PetPackageLoader } from "../pet-package/PetPackageLoader";
import { CanvasPetRenderer } from "../renderer/CanvasPetRenderer";
import { PointerController } from "../interaction/PointerController";
import { ContextMenu } from "../ui/ContextMenu";
import type { ContextMenuItem } from "../ui/ContextMenu";
import type { UnlistenFn } from "@tauri-apps/api/event";
import type { PetModel, PetPersistState, PetState, Settings } from "../types/pet";
import type { AnimationKey, PetPackageManifest } from "../types/pet-package";
import { DEFAULT_SETTINGS } from "../config/settings";
import { MOOD_STORAGE_KEY, MOOD_UPDATED_EVENT, describeMood } from "../ui/mood";
import { recordPetEvent, readPetEvents } from "../ui/petEvents";
import type { PetEvent } from "../ui/petEvents";
import {
  recordSessionStart,
  incrementCondition,
  setCondition,
  onAchievementUnlocked
} from "../ui/achievements";
import type { AchievementDef } from "../ui/achievements";

const INITIAL_SIZE = 220;
const SAVE_INTERVAL_MS = 5000;
const PREVIEW_WALK_DURATION_MS = 6000;
const PREVIEW_WALK_SPEED_PX_PER_SECOND = 60;
const AUTONOMOUS_DESKTOP_WALK_SPEED_PX_PER_SECOND = 28;
/** Window fall physics — matches BehaviorEngine values for consistent feel */
const WINDOW_FALL_GRAVITY = 1500;
const WINDOW_FALL_LANDING_DAMPING = 0.35;
const WINDOW_FALL_STOP_VELOCITY = 85;
const IDLE_LOOP_START_FRAME = 6;
const IDLE_LOOP_END_FRAME = 59;
const WALK_LEFT_LOOP_START_FRAME = 39;
const WALK_LEFT_LOOP_END_FRAME = 86;
const WALK_RIGHT_LOOP_START_FRAME = 39;
const WALK_RIGHT_LOOP_END_FRAME = 86;
const PET_MENU_WINDOW_WIDTH = 176;
const PET_MENU_WINDOW_HEIGHT = 278;
const PET_MENU_WINDOW_OFFSET = 10;
const SETTINGS_WINDOW_WIDTH = 440;
const SETTINGS_WINDOW_HEIGHT = 680;
const CHAT_WINDOW_WIDTH = 218;
const CHAT_WINDOW_HEIGHT = 64;
const CHAT_WINDOW_GAP = 14;
const AUTO_LOOK_MIN_DELAY_MS = 18000;
const AUTO_LOOK_MAX_DELAY_MS = 42000;
const AUTO_LOOK_MIN_DURATION_MS = 2200;
const AUTO_LOOK_MAX_DURATION_MS = 4800;
const MANUAL_LOOK_DURATION_MS = 8000;
const AI_MOOD_MIN_INTERVAL_MS = 180000;
const AI_MOOD_LOOKBACK_MS = 600000;
const AI_MOOD_MIN_EVENTS = 4;
const PROACTIVE_BUBBLE_MIN_INTERVAL_MS = 300_000;
const PROACTIVE_BUBBLE_MIN_SESSION_MS = 90_000;
const PROACTIVE_BUBBLE_CHANCE = 0.003;
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
  private contextMenu: ContextMenu | null = null;
  private contextMenuItems: ContextMenuItem[] = [];
  private menuWindow: WebviewWindow | null = null;
  private chatWindow: WebviewWindow | null = null;
  private settingsWindow: WebviewWindow | null = null;
  private menuActionUnlisten: UnlistenFn | null = null;
  private settingsSyncUnlisten: UnlistenFn | null = null;
  private menuWindowOpening = false;
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
    /** When true, after walk completes the pet sits and looks at the cursor. */
    thenSitAndLook?: boolean;
  } | null = null;
  private saveTimerId = 0;
  private rafId = 0;
  /** Click-through: when true, mouse events pass through the window to the desktop */
  private clickThroughEnabled = false;
  private lastClickThroughCheck = 0;
  private readonly CLICK_THROUGH_POLL_MS = 150;
  private readonly CLICK_THROUGH_HIT_RADIUS = 72;
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
  /** Tracks window-level fall physics after drag release */
  private windowFallState: {
    windowX: number;
    windowY: number;
    velocityY: number;
    floorY: number;
  } | null = null;
  private pendingDesktopWindowPosition: { x: number; y: number } | null = null;
  /** Last window position during drag — independently tracked so
   *  flushDesktopWindowMove consuming pendingDesktopWindowPosition
   *  doesn't lose it before endDesktopDrag reads it. */
  private lastDragWindowPosition: { x: number; y: number } | null = null;
  private desktopWindowMoveInFlight = false;
  private desktopAutonomousWalkStarting = false;
  private mouseCanvasX = 0;
  private mouseCanvasY = 0;
  private mouseInCanvas = false;
  private desktopMouseDx = 0;
  private desktopMouseDy = 0;
  private desktopMouseAvailable = false;
  private desktopMouseUpdateInFlight = false;
  private lookAtMouseUntilMs = 0;
  private nextAutoLookAtMouseMs = performance.now() + 12000;
  private lastPublishedMood = -1;
  private lastPublishedState: PetState | null = null;
  private lastAiMoodEvaluationAtMs = 0;
  private aiMoodEvaluationInFlight = false;
  private startedAtMs = performance.now();
  private lastProactiveBubbleAtMs = 0;
  private proactiveBubbleInFlight = false;
  private lastProactiveTrigger = "";
  private readonly LOOK_RADIUS = 130;
  private readonly LOOK_INNER_DEAD_ZONE = 28;
  // Achievement tracking
  private sessionMinuteTimer = 0;
  private achievementToastTimer = 0;
  private achievementWindow: WebviewWindow | null = null;
  // Petting system
  private pettingStartMs = 0;
  private lastHeartSpawnMs = 0;
  private pettingAnnoyed = false;
  private readonly HEART_SPAWN_INTERVAL_MS = 420;
  private readonly PETTING_THRESHOLD_MS = 1500;
  private readonly PURR_THRESHOLD_MS = 3500;
  private readonly ANNOY_THRESHOLD_MS = 11000;
  // Teaser wand system
  private teaserActive = false;
  private teaserScreenX = 0;
  private teaserScreenY = 0;
  private teaserCatchCount = 0;
  private teaserCooldownUntilMs = 0;
  private teaserWindow: WebviewWindow | null = null;
  private teaserActivationInFlight = false;
  private lastTeaserUpdateMs = 0;
  private teaserUpdateInFlight = false;
  private teaserStartedAtMs = 0;
  private readonly TEASER_UPDATE_MS = 16;
  private readonly TEASER_TIMEOUT_MS = 20_000; // auto-dismiss after 20s
  private readonly TEASER_MAX_CATCHES = 1;
  private readonly TEASER_CATCH_RADIUS = 52;

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
      nextDecisionMs: 1200,
      mood: 50
    };
    this.lastSavedState = this.pet.state;

    this.renderer = new CanvasPetRenderer(canvas, { useStaticImageCssFallback: true });
    this.behavior = new BehaviorEngine({
      width: INITIAL_SIZE,
      height: INITIAL_SIZE,
      floorY
    });
    this.pointer = new PointerController(canvas, this.pet, this.behavior, {
      onDesktopDragStart: TAURI_AVAILABLE ? this.beginDesktopDrag : undefined,
      onDesktopDragMove: TAURI_AVAILABLE ? this.updateDesktopDrag : undefined,
      onDesktopDragEnd: TAURI_AVAILABLE ? this.endDesktopDrag : undefined,
      onDragStart: () => {
            this.recordInteractionEvent("drag_start");
      },
      onDragEnd: () => {
        incrementCondition("drag_count");
        this.recordInteractionEvent("drag_end");
      },
      onNudge: () => {
            this.recordInteractionEvent("nudge");
      },
      windowDragHitRadius: TAURI_AVAILABLE ? 96 : undefined
    });
  }

  async start(): Promise<void> {
    this.resize();
    this.petPackage = await this.packageLoader.loadDefault();
    await this.applyPetPackage();
    await this.restoreDesktopState();
    this.publishMoodStatus(true);

    this.initContextMenu();
    this.attachMenuWindowEvents();

    window.addEventListener("resize", this.onResize);
    window.addEventListener("keydown", this.onPreviewKeyDown);
    window.addEventListener("blur", this.onBlur);
    window.addEventListener("focus", this.onFocus);
    document.addEventListener("visibilitychange", this.onVisibilityChange);
    this.canvas.addEventListener("contextmenu", this.onContextMenu);
    this.canvas.addEventListener("pointermove", this.onPointerMove);
    this.canvas.addEventListener("pointerleave", this.onPointerLeave);
    this.attachTrayEvents();
    this.pointer.attach();
    this.canvas.addEventListener("pointerup", this.onPointerPersist);
    this.saveTimerId = window.setInterval(() => {
      void this.savePetState();
    }, SAVE_INTERVAL_MS);
    this.loop(this.lastFrame);
    // Wait for the first frame to paint before showing the window,
    // avoiding a brief scrollbar/flash during WebView initialization.
    await this.waitForFirstFrame();
    await this.showDesktopWindow();
    // Start with click-through enabled — polling will disable it when mouse is near the cat
    if (TAURI_AVAILABLE) {
      await invoke("set_click_through", { ignore: true }).catch(() => {});
      this.clickThroughEnabled = true;
      await this.ensureWindowOnScreen();
    }

    // Achievement system: record session start and listen for unlocks
    recordSessionStart();
    onAchievementUnlocked((def) => { void this.showAchievementToast(def); });
    // Periodic session minute counter (fires roughly every 60s of loop time)
    this.sessionMinuteTimer = window.setInterval(() => {
      incrementCondition("total_session_minutes", 1);
    }, 60_000);
  }

  stop(): void {
    window.cancelAnimationFrame(this.rafId);
    window.clearInterval(this.saveTimerId);
    window.clearInterval(this.sessionMinuteTimer);
    window.removeEventListener("resize", this.onResize);
    window.removeEventListener("keydown", this.onPreviewKeyDown);
    window.removeEventListener("blur", this.onBlur);
    window.removeEventListener("focus", this.onFocus);
    document.removeEventListener("visibilitychange", this.onVisibilityChange);
    this.canvas.removeEventListener("contextmenu", this.onContextMenu);
    this.canvas.removeEventListener("pointermove", this.onPointerMove);
    this.canvas.removeEventListener("pointerleave", this.onPointerLeave);
    this.canvas.removeEventListener("pointerup", this.onPointerPersist);
    this.pointer.detach();
    this.contextMenu?.destroy();
    this.contextMenu = null;
    this.menuActionUnlisten?.();
    this.menuActionUnlisten = null;
    this.settingsSyncUnlisten?.();
    this.settingsSyncUnlisten = null;
    void this.menuWindow?.hide();
    this.menuWindow = null;
    void this.chatWindow?.hide();
    this.chatWindow = null;
    void this.settingsWindow?.hide();
    this.settingsWindow = null;
    if (this.teaserWindow) {
      void this.teaserWindow.close();
      this.teaserWindow = null;
    }
    // Clean up orphaned teaser window
    void WebviewWindow.getByLabel("teaser-dot").then((w) => w?.close());
    if (this.achievementWindow) {
      void this.achievementWindow.close();
      this.achievementWindow = null;
    }
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
    this.pet.mood = state.mood ?? 50;
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
    if (this.settings.alwaysOnTop) {
      await this.ensurePetWindowAlwaysOnTop();
    }
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
    // Preload frame animations in background — don't block first paint.
    // Static image renders immediately while frames decode asynchronously.
    void this.renderer.preloadFrameAnimations();
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
      lastActiveAt: new Date().toISOString(),
      mood: this.pet.mood
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
      this.recordInteractionEvent("recall");
      void this.savePetState();
    });

    void window.listen("tray-settings", () => {
      void this.openSettingsWindow();
    });

    void window.listen("tray-quit", () => {
      void this.savePetState();
      window.close();
    });

    void window.listen<Settings>("settings-updated", (event) => {
      this.settings = event.payload;
      void this.applySettings();
      this.initContextMenu();
    }).then((unlisten) => {
      this.settingsSyncUnlisten?.();
      this.settingsSyncUnlisten = unlisten;
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
    this.updatePetting(now);
    void this.updateTeaser(now);

    // Always render at full speed — throttling makes the cat look stuttery
    void this.updateLookAtMouse();
    this.renderer.render(this.pet, now);
    this.saveOnStateChange();
    this.publishMoodStatus();
    void this.maybeEvaluateMoodWithAi();
    void this.maybeShowProactiveBubble(now);
    this.updateClickThrough(now);

    this.rafId = window.requestAnimationFrame(this.loop);
  };

  private recordUserInteraction(): void {
    // Reserved for future use (e.g., idle detection)
  }

  private readonly onBlur = (): void => {
    // Window lost focus — no action needed
  };

  private readonly onFocus = (): void => {
    this.lastFrame = performance.now(); // prevent delta spike after backgrounding
  };

  private readonly onVisibilityChange = (): void => {
    if (document.visibilityState === "visible") {
      this.lastFrame = performance.now(); // prevent delta spike after tab backgrounding
    }
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

    // Don't override during teaser chase — walk state is driven by updateTeaser
    if (this.teaserActive) {
      return;
    }

    // sleep_to_idle is a transient one-shot; let it play out
    if (this.pet.state === "sleep_to_idle") {
      return;
    }

    this.behavior.setState(this.pet, "idle");
  }

  private async updateDesktopAutonomy(deltaMs: number, now: number): Promise<void> {
    // When teaser is active, let updateTeaser handle movement — don't interfere
    if (this.teaserActive) {
      // Advance animation timer so walk/stretch/groom frames actually play
      if (this.pet.state === "stretch" || this.pet.state === "groom" || this.pet.state === "walk") {
        this.pet.stateElapsedMs += deltaMs;
      }
      return;
    }

    if ((this.windowWalkAnimation?.returnToIdleOnDone || this.windowWalkAnimation?.thenSitAndLook)
        && this.pet.state === "walk") {
      this.pet.stateElapsedMs += deltaMs;
      await this.updateWindowWalk(now);
      return;
    }

    if (this.pet.state === "walk") {
      // NOTE: during the async gap of startAutonomousDesktopWalk (Tauri IPC),
      // deskAutonomousWalkStarting is true but windowWalkAnimation may not be
      // set yet, so stateElapsedMs freezes for 1-3 frames. Not user-visible
      // at 60fps and a negligible trade-off vs. the cleaner async flow.
      if (!this.desktopAutonomousWalkStarting) {
        if (this.pet.followMouse) {
          await this.startFollowMouseWalk(now);
        } else {
          await this.startAutonomousDesktopWalk(now);
        }
      }
      return;
    }

    // Desktop fall: move the entire window with gravity + bounce physics.
    if (this.pet.state === "fall") {
      // Advance animation timer manually — don't call behavior.update()
      // (its updateFall would fight with the canvas anchor).
      this.pet.stateElapsedMs += deltaMs;

      if (this.windowFallState) {
        // Normal path: physics controls window movement and landing
        await this.updateDesktopFall(deltaMs);
      } else {
        // Safety net: if windowFallState failed to initialize (IPC error, etc.),
        // use the one-shot timer to avoid getting stuck in "fall" forever
        const oneShotMs = this.getDesktopOneShotDurationMs(this.pet.state);
        if (oneShotMs !== null && this.pet.stateElapsedMs >= oneShotMs) {
          this.behavior.setState(this.pet, "idle");
        }
      }

      return;
    }

    const updatedState = this.updateBehaviorState(deltaMs);

    if (updatedState === "walk") {
      if (!this.desktopAutonomousWalkStarting) {
        if (this.pet.followMouse) {
          await this.startFollowMouseWalk(now);
        } else {
          await this.startAutonomousDesktopWalk(now);
        }
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
    this.stopLookAtMouse();
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

    if (state === "sleep_to_idle") {
      return this.renderer.getFrameAnimationDurationMs("sleep_to_idle") ?? 2500;
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

    const previousState = this.lastSavedState;
    this.lastSavedState = this.pet.state;
    recordPetEvent({
      type: "state_change",
      fromState: previousState,
      toState: this.pet.state,
      mood: Math.round(this.pet.mood)
    });
    void this.savePetState();
  }

  private readonly onResize = (): void => {
    this.resize();
  };

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

  private initContextMenu(): void {
    this.contextMenu?.destroy();

    const items = this.getContextMenuItems();
    this.contextMenuItems = items;
    this.contextMenu = new ContextMenu({
      items,
      title: this.getMoodMenuTitle()
    });
  }

  private getContextMenuItems(): ContextMenuItem[] {
    return [
      {
        id: "feed",
        label: "投喂",
        icon: "🐟",
        action: () => {
                this.cancelDesktopMotion();
          this.behavior.feed(this.pet);
          incrementCondition("feed_count");
          this.recordInteractionEvent("feed");
          void this.savePetState();
        }
      },
      {
        id: "sleep",
        label: "哄睡",
        icon: "💤",
        action: () => {
                this.cancelDesktopMotion();
          this.behavior.sleep(this.pet);
          incrementCondition("sleep_count");
          this.recordInteractionEvent("sleep");
          void this.savePetState();
        }
      },
      {
        id: "chat",
        label: "聊天",
        icon: "💬",
        action: () => {
                window.setTimeout(() => {
            void this.openChatBubbleWindow();
          }, 10);
        }
      },
      {
        id: "tease",
        label: "逗猫",
        icon: "🪶",
        action: () => {
          void this.activateTeaser().catch((err) => {
            console.warn("Failed to activate teaser:", err);
          });
        }
      },
      {
        id: "play",
        label: "看我",
        icon: "👋",
        action: () => {
                this.startLookAtMouse(performance.now(), MANUAL_LOOK_DURATION_MS);
          this.recordInteractionEvent("look");
          void this.savePetState();
        }
      }
    ];
  }

  private attachMenuWindowEvents(): void {
    if (!TAURI_AVAILABLE) {
      return;
    }

    void listen<string>("pet-menu-action", (event) => {
      const item = this.contextMenuItems.find((menuItem) => menuItem.id === event.payload);
      item?.action();
    }).then((unlisten) => {
      this.menuActionUnlisten?.();
      this.menuActionUnlisten = unlisten;
    });
  }

  private onContextMenu = (event: MouseEvent): void => {
    event.preventDefault();

    // Only show context menu when clicking on the pet (hit test)
    const rect = this.canvas.getBoundingClientRect();
    const ratio = window.devicePixelRatio || 1;
    const point = {
      x: (event.clientX - rect.left) * (this.canvas.width / ratio / rect.width),
      y: (event.clientY - rect.top) * (this.canvas.height / ratio / rect.height)
    };

    // Check if click is on the pet or nearby
    const dx = point.x - this.pet.position.x;
    const dy = point.y - this.pet.position.y;
    const hitRadius = 72;
    const hit = dx * dx + dy * dy < hitRadius * hitRadius;

    if (!hit) {
      return;
    }

    if (TAURI_AVAILABLE) {
      void this.openDesktopContextMenu(event.clientX, event.clientY);
      return;
    }

    this.contextMenu?.setTitle(this.getMoodMenuTitle());
    this.contextMenu?.open(event.clientX, event.clientY);
  };

  private getMoodMenuTitle(): string {
    const mood = describeMood(this.pet.mood, this.pet.state);
    return `${this.getPetName()} · ${mood.label} ${mood.mood}`;
  }

  private getPetName(): string {
    return this.settings.petName?.trim() || DEFAULT_SETTINGS.petName;
  }

  private publishMoodStatus(force = false): void {
    const snapshot = describeMood(this.pet.mood, this.pet.state);
    if (!force && snapshot.mood === this.lastPublishedMood && snapshot.state === this.lastPublishedState) {
      return;
    }

    const previousMood = this.lastPublishedMood;
    this.lastPublishedMood = snapshot.mood;
    this.lastPublishedState = this.pet.state;
    try {
      window.localStorage.setItem(MOOD_STORAGE_KEY, JSON.stringify(snapshot));
      window.dispatchEvent(new CustomEvent(MOOD_UPDATED_EVENT, { detail: snapshot }));
      if (previousMood >= 0 && previousMood !== snapshot.mood) {
        recordPetEvent({
          type: "mood_change",
          previousMood,
          mood: snapshot.mood,
          state: this.pet.state
        });
        // Track mood extremes for achievements
        setCondition("mood_peak", snapshot.mood);
        setCondition("mood_low", snapshot.mood);
      }
    } catch {
      // localStorage can fail in restricted preview contexts; behavior still works.
    }
  }

  private recordInteractionEvent(type: Parameters<typeof recordPetEvent>[0]["type"]): void {
    recordPetEvent({
      type,
      state: this.pet.state,
      mood: Math.round(this.pet.mood)
    });
  }

  private async maybeEvaluateMoodWithAi(): Promise<void> {
    if (!TAURI_AVAILABLE || !this.settings.aiMoodCalibrationEnabled || this.aiMoodEvaluationInFlight) {
      return;
    }

    const now = Date.now();
    if (now - this.lastAiMoodEvaluationAtMs < AI_MOOD_MIN_INTERVAL_MS) {
      return;
    }

    const events = readPetEvents();
    const recentEvents = events.filter((event) => {
      const timestamp = Date.parse(event.timestamp);
      return Number.isFinite(timestamp)
        && timestamp > this.lastAiMoodEvaluationAtMs
        && now - timestamp <= AI_MOOD_LOOKBACK_MS
        && event.type !== "mood_change"
        && event.type !== "ai_mood_adjustment";
    }).slice(-18);
    const meaningfulEvents = recentEvents.filter((event) =>
      event.type === "nudge"
      || event.type === "feed"
      || event.type === "drag_start"
      || event.type === "drag_end"
      || event.type === "chat_message"
      || event.type === "sleep"
    );

    if (meaningfulEvents.length < AI_MOOD_MIN_EVENTS) {
      return;
    }

    this.aiMoodEvaluationInFlight = true;
    try {
      const response = await invoke<{ delta: number; reason: string }>("evaluate_pet_mood", {
        request: {
          currentMood: Math.round(this.pet.mood),
          currentState: this.pet.state,
          events: recentEvents.map((event) => this.toMoodEvaluationEvent(event)),
          settings: this.settings
        }
      });
      const delta = Math.max(-6, Math.min(6, Number(response.delta) || 0));
      if (Math.abs(delta) >= 0.25) {
        const previousMood = Math.round(this.pet.mood);
        this.behavior.applyExternalMoodAdjustment(this.pet, delta);
        const mood = Math.round(this.pet.mood);
        recordPetEvent({
          type: "ai_mood_adjustment",
          previousMood,
          mood,
          delta,
          reason: response.reason || "AI 校准",
          state: this.pet.state
        });
        this.publishMoodStatus(true);
      }
      this.lastAiMoodEvaluationAtMs = now;
    } catch (error) {
      console.warn("AI mood evaluation failed", error);
      this.lastAiMoodEvaluationAtMs = now;
    } finally {
      this.aiMoodEvaluationInFlight = false;
    }
  }

  private toMoodEvaluationEvent(event: PetEvent): Record<string, unknown> {
    return {
      eventType: event.type,
      timestamp: event.timestamp,
      state: event.state,
      fromState: event.fromState,
      toState: event.toState,
      mood: event.mood,
      previousMood: event.previousMood
    };
  }

  private async maybeShowProactiveBubble(now: number): Promise<void> {
    if (
      !TAURI_AVAILABLE
      || !this.settings.proactiveBubbleEnabled
      || this.proactiveBubbleInFlight
      || now - this.startedAtMs < PROACTIVE_BUBBLE_MIN_SESSION_MS
      || now - this.lastProactiveBubbleAtMs < PROACTIVE_BUBBLE_MIN_INTERVAL_MS
      || Math.random() > PROACTIVE_BUBBLE_CHANCE
    ) {
      return;
    }

    const trigger = this.getProactiveTrigger();
    if (!trigger || trigger === this.lastProactiveTrigger) {
      return;
    }

    this.proactiveBubbleInFlight = true;
    try {
      const message = await this.generateProactiveMessage(trigger);
      if (!message) {
        return;
      }

      await this.showProactiveChatBubble(message);
      this.lastProactiveBubbleAtMs = now;
      this.lastProactiveTrigger = trigger;
      recordPetEvent({
        type: "proactive_bubble",
        state: this.pet.state,
        mood: Math.round(this.pet.mood),
        reason: trigger,
        message
      });
    } catch (error) {
      console.warn("Failed to show proactive bubble", error);
      this.lastProactiveBubbleAtMs = now;
    } finally {
      this.proactiveBubbleInFlight = false;
    }
  }

  private getProactiveTrigger(): string | null {
    const now = new Date();
    const hour = now.getHours();
    const sessionMinutes = Math.floor((performance.now() - this.startedAtMs) / 60_000);

    // Time-of-day triggers
    if (hour >= 6 && hour < 9 && this.pet.state === "idle") {
      return "早上问候";
    }
    if (hour >= 22 || hour < 1) {
      if (this.pet.state !== "sleep" && this.pet.state !== "drag" && this.pet.state !== "fall") {
        return "深夜提醒休息";
      }
    }
    if (hour >= 13 && hour < 15 && this.pet.state === "idle") {
      return "午后犯困";
    }

    // Session-based triggers
    if (sessionMinutes > 120 && this.pet.state === "idle" && this.pet.mood > 40) {
      return "陪伴很久，想被注意到";
    }

    // State-based triggers
    if (this.pet.state === "sleep_to_idle" && this.pet.stateElapsedMs > 3000) {
      return "刚睡醒";
    }
    if (this.pet.state === "sit" && this.pet.stateElapsedMs > 120000) {
      return "坐久了，提醒用户休息";
    }
    if ((this.pet.state === "idle" || this.pet.state === "sit") && this.pet.mood < 28) {
      return "心情低，想要一点陪伴";
    }
    if (this.pet.state === "idle" && this.pet.stateElapsedMs > 180000) {
      return "空闲很久，想轻轻搭话";
    }
    if (this.pet.state === "idle" && this.pet.mood > 78) {
      return "心情很好，想分享小事";
    }
    if (this.pet.state === "idle" && this.pet.mood < 48) {
      return "有点饿，想要小鱼干";
    }

    return null;
  }

  private async generateProactiveMessage(trigger: string): Promise<string> {
    if (this.settings.aiProactiveBubbleEnabled) {
      try {
        const response = await invoke<{ message: string }>("generate_proactive_message", {
          request: {
            currentMood: Math.round(this.pet.mood),
            currentState: this.pet.state,
            trigger,
            settings: this.settings
          }
        });
        const message = this.sanitizeBubbleMessage(response.message);
        if (message) {
          return message;
        }
      } catch (error) {
        console.warn("AI proactive message failed; using local fallback", error);
      }
    }

    return this.getLocalProactiveMessage(trigger);
  }

  private getLocalProactiveMessage(trigger: string): string {
    const messagesByTrigger: Array<[string, string[]]> = [
      ["坐久了", ["坐好久啦，要不要伸个懒腰？", "陪你坐着呢，也记得歇一小会。"]],
      ["心情低", ["今天可以摸摸我吗？", "我有点安静，但还在陪你。"]],
      ["空闲很久", ["刚刚有什么好玩的事吗？", "我在这儿，偷偷陪你一会。"]],
      ["心情很好", ["我今天心情不错，想贴贴。", "刚才像捡到一小块太阳。"]],
      ["有点饿", ["有小鱼干吗？一点点也行。", "肚子好像在小声叫我。"]]
    ];
    const matched = messagesByTrigger.find(([key]) => trigger.includes(key))?.[1]
      ?? ["我在旁边陪你。"];
    return matched[Math.floor(Math.random() * matched.length)];
  }

  private sanitizeBubbleMessage(message: string): string {
    return message.replace(/\s+/g, " ").trim().slice(0, 32);
  }

  private async showProactiveChatBubble(message: string): Promise<void> {
    const chatWindow = await this.getOrCreateChatBubbleWindow();
    const position = await this.getDesktopChatBubblePosition();
    await chatWindow.setPosition(new PhysicalPosition(position.x, position.y));
    await chatWindow.show();
    await emitTo("chat-bubble", "chat-show-proactive", { message });
  }

  private async openDesktopContextMenu(fallbackX: number, fallbackY: number): Promise<void> {
    if (this.menuWindowOpening) {
      return;
    }

    this.menuWindowOpening = true;
    try {
      const menuWindow = await this.getOrCreateMenuWindow();
      await emitTo("pet-menu", "pet-menu-refresh", { petName: this.getPetName() });
      const position = await this.getDesktopMenuPosition();
      await menuWindow.setPosition(new PhysicalPosition(position.x, position.y));
      await menuWindow.show();
      await menuWindow.setFocus();
    } catch (error) {
      console.warn("Failed to open desktop pet menu", error);
      this.contextMenu?.open(fallbackX, fallbackY);
    } finally {
      this.menuWindowOpening = false;
    }
  }

  private async getOrCreateMenuWindow(): Promise<WebviewWindow> {
    const existing = this.menuWindow ?? (await WebviewWindow.getByLabel("pet-menu"));
    if (existing) {
      this.menuWindow = existing;
      return existing;
    }

    const menuWindow = new WebviewWindow("pet-menu", {
      url: this.getMenuWindowUrl(),
      title: `${this.getPetName()} 的小菜单`,
      width: PET_MENU_WINDOW_WIDTH,
      height: PET_MENU_WINDOW_HEIGHT,
      visible: false,
      decorations: false,
      transparent: true,
      backgroundColor: "#00000000",
      alwaysOnTop: true,
      skipTaskbar: true,
      resizable: false,
      maximizable: false,
      minimizable: false,
      focus: false,
      shadow: false
    });
    try {
      await Promise.race([
        new Promise<void>((resolve, reject) => {
          void menuWindow.once("tauri://created", () => resolve());
          void menuWindow.once("tauri://error", (event) => reject(event.payload));
        }),
        new Promise<void>((resolve) => window.setTimeout(resolve, 600))
      ]);
      this.menuWindow = menuWindow;
    } catch (error) {
      this.menuWindow = null;
      throw error;
    }

    return menuWindow;
  }

  private getMenuWindowUrl(): string {
    const url = new URL(window.location.href);
    url.search = `view=pet-menu&petName=${encodeURIComponent(this.getPetName())}`;
    url.hash = "";
    return url.href;
  }

  private async openSettingsWindow(): Promise<void> {
    if (!TAURI_AVAILABLE) {
      return;
    }

    const settingsWindow = await this.getOrCreateSettingsWindow();
    await settingsWindow.show();
    await settingsWindow.setFocus();
  }

  private async getOrCreateSettingsWindow(): Promise<WebviewWindow> {
    const existing = this.settingsWindow ?? (await WebviewWindow.getByLabel("settings"));
    if (existing) {
      this.settingsWindow = existing;
      return existing;
    }

    const settingsWindow = new WebviewWindow("settings", {
      url: this.getSettingsWindowUrl(),
      title: `${this.getPetName()} 设置`,
      width: SETTINGS_WINDOW_WIDTH,
      height: SETTINGS_WINDOW_HEIGHT,
      visible: false,
      decorations: true,
      transparent: false,
      backgroundColor: "#fff8ef",
      alwaysOnTop: false,
      skipTaskbar: false,
      resizable: true,
      maximizable: false,
      minimizable: true,
      focus: true,
      center: true
    });
    try {
      await Promise.race([
        new Promise<void>((resolve, reject) => {
          void settingsWindow.once("tauri://created", () => resolve());
          void settingsWindow.once("tauri://error", (event) => reject(event.payload));
        }),
        new Promise<void>((resolve) => window.setTimeout(resolve, 600))
      ]);
      this.settingsWindow = settingsWindow;
    } catch (error) {
      this.settingsWindow = null;
      throw error;
    }

    return settingsWindow;
  }

  private getSettingsWindowUrl(): string {
    const url = new URL(window.location.href);
    url.search = "view=settings";
    url.hash = "";
    return url.href;
  }

  private async openChatBubbleWindow(): Promise<void> {
    if (!TAURI_AVAILABLE) {
      return;
    }

    try {
      const chatWindow = await this.getOrCreateChatBubbleWindow();
      await emitTo("chat-bubble", "chat-open-input");
      const position = await this.getDesktopChatBubblePosition();
      await chatWindow.setPosition(new PhysicalPosition(position.x, position.y));
      await chatWindow.show();
      await chatWindow.setFocus();
    } catch (error) {
      console.warn("Failed to open chat bubble", error);
    }
  }

  private async getOrCreateChatBubbleWindow(): Promise<WebviewWindow> {
    const existing = this.chatWindow ?? (await WebviewWindow.getByLabel("chat-bubble"));
    if (existing) {
      this.chatWindow = existing;
      return existing;
    }

    const chatWindow = new WebviewWindow("chat-bubble", {
      url: this.getChatBubbleWindowUrl(),
      title: `${this.getPetName()} 聊天气泡`,
      width: CHAT_WINDOW_WIDTH,
      height: CHAT_WINDOW_HEIGHT,
      visible: false,
      decorations: false,
      transparent: true,
      backgroundColor: "#00000000",
      alwaysOnTop: true,
      skipTaskbar: true,
      resizable: false,
      maximizable: false,
      minimizable: false,
      focus: true,
      shadow: false
    });
    try {
      await Promise.race([
        new Promise<void>((resolve, reject) => {
          void chatWindow.once("tauri://created", () => resolve());
          void chatWindow.once("tauri://error", (event) => reject(event.payload));
        }),
        new Promise<void>((_, reject) =>
          window.setTimeout(() => reject(new Error("Window creation timed out after 3s")), 3000)
        )
      ]);
      this.chatWindow = chatWindow;
    } catch (err) {
      this.chatWindow = null;
      console.warn("Chat bubble window ready wait failed", err);
      throw err;
    }

    return chatWindow;
  }

  private getChatBubbleWindowUrl(): string {
    return `/?view=chat-bubble`;
  }

  private async getDesktopMenuPosition(): Promise<{ x: number; y: number }> {
    const cursor = await cursorPosition();
    const monitor = await currentMonitor();
    const bounds = monitor?.workArea ?? monitor;
    let x = cursor.x + PET_MENU_WINDOW_OFFSET;
    let y = cursor.y + PET_MENU_WINDOW_OFFSET;

    if (bounds) {
      const minX = bounds.position.x + PET_MENU_WINDOW_OFFSET;
      const minY = bounds.position.y + PET_MENU_WINDOW_OFFSET;
      const maxX =
        bounds.position.x + bounds.size.width - PET_MENU_WINDOW_WIDTH - PET_MENU_WINDOW_OFFSET;
      const maxY =
        bounds.position.y + bounds.size.height - PET_MENU_WINDOW_HEIGHT - PET_MENU_WINDOW_OFFSET;
      x = this.clamp(x, minX, maxX);
      y = this.clamp(y, minY, maxY);
    }

    return {
      x: Math.round(x),
      y: Math.round(y)
    };
  }

  private async getDesktopChatBubblePosition(): Promise<{
    x: number;
    y: number;
  }> {
    const monitor = await currentMonitor();
    const bounds = monitor?.workArea ?? monitor;
    const petWindow = getCurrentWindow();
    const [windowPosition, windowSize] = await Promise.all([
      petWindow.outerPosition(),
      petWindow.outerSize()
    ]);

    const centerX = windowPosition.x + windowSize.width / 2;
    const preferRight = !bounds || centerX < bounds.position.x + bounds.size.width / 2;

    let x = preferRight
      ? windowPosition.x + windowSize.width + CHAT_WINDOW_GAP
      : windowPosition.x - CHAT_WINDOW_WIDTH - CHAT_WINDOW_GAP;
    let y = windowPosition.y + windowSize.height - CHAT_WINDOW_HEIGHT - 6;

    if (bounds) {
      const minX = bounds.position.x + 8;
      const maxX = bounds.position.x + bounds.size.width - CHAT_WINDOW_WIDTH - 8;
      const minY = bounds.position.y + 8;
      const maxY = bounds.position.y + bounds.size.height - CHAT_WINDOW_HEIGHT - 8;

      if (x < minX || x > maxX) {
        x = preferRight
          ? windowPosition.x - CHAT_WINDOW_WIDTH - CHAT_WINDOW_GAP
          : windowPosition.x + windowSize.width + CHAT_WINDOW_GAP;
        if (x < minX || x > maxX) {
          x = preferRight
          ? windowPosition.x + windowSize.width + CHAT_WINDOW_GAP
          : windowPosition.x - CHAT_WINDOW_WIDTH - CHAT_WINDOW_GAP;
        }
      }

      x = this.clamp(x, minX, maxX);
      y = this.clamp(y, minY, maxY);
    }

    return {
      x: Math.round(x),
      y: Math.round(y)
    };
  }

  private onPointerMove = (event: PointerEvent): void => {
    const point = this.getCanvasPoint(event);
    this.mouseInCanvas = true;
    this.mouseCanvasX = point.x;
    this.mouseCanvasY = point.y;
  };

  private onPointerLeave = (): void => {
    this.mouseInCanvas = false;
  };

  private async updateLookAtMouse(): Promise<void> {
    if (!this.renderer.hasLookAnimation()) {
      return;
    }

    const now = performance.now();
    this.maybeStartAutoLookAtMouse(now);

    if (!this.canLookAtMouse(now)) {
      this.renderer.setLookFrame(-1);
      return;
    }

    let dx: number;
    let dy: number;
    let dist: number;

    if (TAURI_AVAILABLE) {
      await this.updateDesktopMouseCanvasPoint();
      if (!this.desktopMouseAvailable) {
        this.renderer.setLookFrame(-1);
        return;
      }
      dx = this.desktopMouseDx;
      dy = this.desktopMouseDy;
      dist = Math.sqrt(dx * dx + dy * dy);
    } else {
      if (!this.mouseInCanvas) {
        this.renderer.setLookFrame(-1);
        return;
      }

      dx = this.mouseCanvasX - this.pet.position.x;
      dy = this.mouseCanvasY - this.pet.position.y;
      dist = Math.sqrt(dx * dx + dy * dy);

      if (dist > this.LOOK_RADIUS) {
        this.renderer.setLookFrame(-1);
        return;
      }
    }

    if (dist < this.LOOK_INNER_DEAD_ZONE) {
      return;
    }

    const frameCount = this.renderer.getLookFrameCount();
    if (frameCount <= 0) {
      this.renderer.setLookFrame(-1);
      return;
    }

    const angleDeg = this.getClockwiseLookAngleFromUp(dx, dy);
    const frameIndex = Math.round((angleDeg / 360) * frameCount) % frameCount;

    this.renderer.setLookFrame(frameIndex);
  }

  private maybeStartAutoLookAtMouse(now: number): void {
    if (this.lookAtMouseUntilMs > now || now < this.nextAutoLookAtMouseMs) {
      return;
    }

    this.nextAutoLookAtMouseMs = now + this.randomBetween(AUTO_LOOK_MIN_DELAY_MS, AUTO_LOOK_MAX_DELAY_MS);

    if (!this.canStartLookAtMouse()) {
      return;
    }

    if (Math.random() < 0.45) {
      this.startLookAtMouse(now, this.randomBetween(AUTO_LOOK_MIN_DURATION_MS, AUTO_LOOK_MAX_DURATION_MS));
    }
  }

  private startLookAtMouse(now: number, durationMs: number): void {
    if (!this.canStartLookAtMouse()) {
      return;
    }

    this.lookAtMouseUntilMs = now + durationMs;
    this.nextAutoLookAtMouseMs = now + durationMs + this.randomBetween(AUTO_LOOK_MIN_DELAY_MS, AUTO_LOOK_MAX_DELAY_MS);
  }

  private stopLookAtMouse(): void {
    this.lookAtMouseUntilMs = 0;
    this.renderer.setLookFrame(-1);
  }

  private canLookAtMouse(now: number): boolean {
    return this.lookAtMouseUntilMs > now && this.canStartLookAtMouse();
  }

  private canStartLookAtMouse(): boolean {
    return (this.pet.state === "idle" || this.pet.state === "sit") && this.previewStateUntilMs === 0;
  }

  private getClockwiseLookAngleFromUp(dx: number, dy: number): number {
    const angle = (Math.atan2(dy, dx) * 180) / Math.PI;
    return (angle + 90 + 360) % 360;
  }

  private randomBetween(min: number, max: number): number {
    return min + Math.random() * (max - min);
  }

  private getCanvasPoint(event: MouseEvent): { x: number; y: number } {
    const rect = this.canvas.getBoundingClientRect();
    const ratio = window.devicePixelRatio || 1;
    return {
      x: (event.clientX - rect.left) * (this.canvas.width / ratio / rect.width),
      y: (event.clientY - rect.top) * (this.canvas.height / ratio / rect.height)
    };
  }

  private async updateDesktopMouseCanvasPoint(): Promise<void> {
    if (this.desktopMouseUpdateInFlight) {
      return;
    }

    this.desktopMouseUpdateInFlight = true;
    try {
      const window = getCurrentWindow();
      const [mouse, position, size] = await Promise.all([
        cursorPosition(),
        window.outerPosition(),
        window.outerSize()
      ]);
      const displayWidth = Math.max(1, size.width);
      const displayHeight = Math.max(1, size.height);
      const catScreenX = position.x + displayWidth * (this.pet.position.x / INITIAL_SIZE);
      const catScreenY = position.y + displayHeight * (this.pet.position.y / INITIAL_SIZE);

      this.desktopMouseDx = mouse.x - catScreenX;
      this.desktopMouseDy = mouse.y - catScreenY;
      this.desktopMouseAvailable = true;
    } catch (error) {
      this.desktopMouseAvailable = false;
      console.warn("Failed to update desktop cursor position", error);
    } finally {
      this.desktopMouseUpdateInFlight = false;
    }
  }

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
      const [position, size] = await Promise.all([
        window.outerPosition(),
        window.outerSize()
      ]);
      const distance = (durationMs / 1000) * PREVIEW_WALK_SPEED_PX_PER_SECOND;
      const signedDistance = facing === "left" ? -distance : distance;
      const targetX = position.x + signedDistance;
      const targetY = position.y;
      const bounds = await this.getAllMonitorsBounds();
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

  private async startFollowMouseWalk(now: number): Promise<void> {
    if (this.desktopAutonomousWalkStarting) {
      return;
    }
    this.desktopAutonomousWalkStarting = true;
    this.pet.followMouse = false;

    try {
      const [position, size, cursor] = await Promise.all([
        getCurrentWindow().outerPosition(),
        getCurrentWindow().outerSize(),
        cursorPosition()
      ]);
      const bounds = await this.getAllMonitorsBounds();

      // Walk so the cat center ends up ~60px away from the cursor.
      const directionX = position.x + size.width / 2 < cursor.x ? -1 : 1;
      const targetX = cursor.x + directionX * 60 - size.width / 2;
      const targetY = cursor.y - 30 - size.height / 2; // slightly above cursor

      let clampedX = targetX;
      let clampedY = targetY;
      if (bounds) {
        clampedX = this.clamp(targetX, bounds.position.x + 8, bounds.position.x + bounds.size.width - size.width - 8);
        clampedY = this.clamp(targetY, bounds.position.y + 8, bounds.position.y + bounds.size.height - size.height - 8);
      }

      const dx = clampedX - position.x;
      const dy = clampedY - position.y;
      const distance = Math.sqrt(dx * dx + dy * dy);

      if (distance < 12) {
        // Already close enough — just sit and look
        this.behavior.setState(this.pet, "sit");
        this.startLookAtMouse(now, MANUAL_LOOK_DURATION_MS);
        return;
      }

      this.pet.facing = clampedX < position.x ? "left" : "right";
      this.windowWalkAnimation = {
        startedAt: now,
        durationMs: this.clamp(
          (distance / AUTONOMOUS_DESKTOP_WALK_SPEED_PX_PER_SECOND) * 1000,
          1200,
          4000
        ),
        fromX: position.x,
        fromY: position.y,
        toX: clampedX,
        toY: clampedY,
        returnToIdleOnDone: false,
        thenSitAndLook: true
      };
    } catch (error) {
      console.warn("Failed to start follow-mouse walk", error);
      this.behavior.setState(this.pet, "idle");
    } finally {
      this.desktopAutonomousWalkStarting = false;
    }
  }

  private async startAutonomousDesktopWalk(now: number): Promise<void> {
    if (this.desktopAutonomousWalkStarting) {
      return;
    }

    this.desktopAutonomousWalkStarting = true;
    const window = getCurrentWindow();

    try {
      const [position, size] = await Promise.all([
        window.outerPosition(),
        window.outerSize()
      ]);
      const bounds = await this.getAllMonitorsBounds();
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
    } else if (progress >= 1 && walk.thenSitAndLook) {
      this.windowWalkAnimation = null;
      this.behavior.setState(this.pet, "sit");
      this.startLookAtMouse(now, MANUAL_LOOK_DURATION_MS);
    }
  }

  /** Apply gravity + bounce physics to the entire window after drag release */
  private async updateDesktopFall(deltaMs: number): Promise<void> {
    const fall = this.windowFallState;
    if (!fall) {
      return;
    }

    const dt = deltaMs / 1000;
    fall.velocityY += WINDOW_FALL_GRAVITY * dt;
    fall.windowY += fall.velocityY * dt;

    // Floor collision — window bottom hits the work area bottom
    if (fall.windowY >= fall.floorY) {
      fall.windowY = fall.floorY;
      fall.velocityY *= -WINDOW_FALL_LANDING_DAMPING;

      // Stop bouncing when velocity is low enough
      if (Math.abs(fall.velocityY) < WINDOW_FALL_STOP_VELOCITY) {
        this.windowFallState = null;
        this.behavior.setState(this.pet, "idle");
        await this.safeTauri(
          () =>
            getCurrentWindow().setPosition(
              new PhysicalPosition(Math.round(fall.windowX), Math.round(fall.windowY))
            ),
          "Failed to land pet window"
        );
        return;
      }
    }

    // Clamp against top of the monitor so the cat doesn't fly above the screen
    // on the upward bounce
    if (fall.windowY < fall.floorY - 400) {
      fall.windowY = fall.floorY - 400;
      fall.velocityY = 0;
    }

    await this.safeTauri(
      () =>
        getCurrentWindow().setPosition(
          new PhysicalPosition(Math.round(fall.windowX), Math.round(fall.windowY))
        ),
      "Failed to animate pet window fall"
    );
  }

  private beginDesktopDrag = (screenPoint: { x: number; y: number }): void => {
    this.previewStateUntilMs = 0;
    this.windowWalkAnimation = null;
    this.windowFallState = null;
    this.lastDragWindowPosition = null;
    this.desktopAutonomousWalkStarting = false;
    this.stopLookAtMouse();

    void this.safeTauri(async () => {
      const window = getCurrentWindow();
      const [position, size] = await Promise.all([
        window.outerPosition(),
        window.outerSize()
      ]);

      const bounds = await this.getAllMonitorsBounds();
      const workArea = bounds;
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
    // Keep an independent copy so endDesktopDrag can read it even after
    // flushDesktopWindowMove consumes pendingDesktopWindowPosition.
    this.lastDragWindowPosition = { ...this.pendingDesktopWindowPosition };

    if (this.desktopWindowMoveInFlight) {
      return;
    }

    this.desktopWindowMoveInFlight = true;
    void this.flushDesktopWindowMove();
  };

  private endDesktopDrag = (): void => {
    // Use the independently-tracked computed position from the last drag
    // update.  window.screenX/Y is unreliable in Tauri v2 (often 0), so we
    // cannot use it — fall back to the drag-system position which is the
    // best synchronous estimate available.  An async IPC correction follows
    // within 1-2 frames via refineWindowFallFloor.
    const lastDragPosition = this.lastDragWindowPosition;

    this.desktopDragOrigin = null;
    this.desktopDragBounds = null;
    this.pendingDesktopWindowPosition = null;
    this.lastDragWindowPosition = null;

    if (lastDragPosition) {
      // Use monitor work area bottom as floor estimate.
      // The fallback uses screen.availHeight as the total work area height
      // (from top of screen to bottom of taskbar). The window anchor is at
      // the top-left, so floor = workAreaBottom - windowHeight.
      const windowHeight = this.getScaledSize();
      const estimatedFloor = (window.screen?.availHeight ?? 1080) - windowHeight;
      this.windowFallState = {
        windowX: lastDragPosition.x,
        windowY: lastDragPosition.y,
        velocityY: 180,
        floorY: estimatedFloor
      };
      void this.refineWindowFallFloor();
    }
  };

  /** Fetch the real floorY from monitor bounds and correct the fall
   *  start position from the actual window position (Tauri IPC). */
  private async refineWindowFallFloor(): Promise<void> {
    try {
      const [size, bounds] = await Promise.all([
        getCurrentWindow().outerSize(),
        this.getAllMonitorsBounds()
      ]);
      if (this.windowFallState && bounds) {
        // Only correct floorY from actual monitor bounds.
        // Don't overwrite windowX/Y — lastDragPosition is already accurate
        // and overwriting causes a visible position jump.
        this.windowFallState.floorY = bounds.position.y + bounds.size.height - size.height;
      }
    } catch {
      // Fallback: use screen bottom as floor
      if (this.windowFallState) {
        this.windowFallState.floorY = (window.screen?.availHeight ?? 1080) - this.getScaledSize();
      }
    }
  }

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

    return state === "drag" ? "fall"
      : state === "sleep_to_idle" ? "idle"
      : state;
  }

  /** Get the union (bounding box) of all monitor work areas, or fall back to the current monitor. */
  private async getAllMonitorsBounds(): Promise<{
    position: { x: number; y: number };
    size: { width: number; height: number };
  } | null> {
    try {
      const monitors = await availableMonitors();
      if (monitors.length === 0) {
        return null;
      }

      let minX = Infinity;
      let minY = Infinity;
      let maxX = -Infinity;
      let maxY = -Infinity;

      for (const m of monitors) {
        const area = m.workArea ?? m;
        minX = Math.min(minX, area.position.x);
        minY = Math.min(minY, area.position.y);
        maxX = Math.max(maxX, area.position.x + area.size.width);
        maxY = Math.max(maxY, area.position.y + area.size.height);
      }

      return {
        position: { x: minX, y: minY },
        size: { width: maxX - minX, height: maxY - minY }
      };
    } catch {
      // Fall back to current monitor
      const monitor = await currentMonitor();
      if (!monitor) {
        return null;
      }
      return monitor.workArea ?? monitor;
    }
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

  // ── Petting system ──────────────────────────────────────────────────

  private updatePetting(now: number): void {
    // Petting only when mouse hovers over the cat and the cat isn't being dragged
    if (!this.mouseInCanvas || this.pet.state === "drag" || this.pet.state === "fall") {
      this.pettingStartMs = 0;
      this.lastHeartSpawnMs = 0;
      this.pettingAnnoyed = false;
      return;
    }

    // Check if mouse is close enough to the cat for petting
    const dx = this.mouseCanvasX - this.pet.position.x;
    const dy = this.mouseCanvasY - this.pet.position.y;
    const pettingRadius = 52;
    const hovering = dx * dx + dy * dy < pettingRadius * pettingRadius;

    if (!hovering) {
      this.pettingStartMs = 0;
      this.lastHeartSpawnMs = 0;
      return;
    }

    if (this.pettingStartMs === 0) {
      this.pettingStartMs = now;
      this.lastHeartSpawnMs = now;
      return;
    }

    const elapsed = now - this.pettingStartMs;

    // Spawn heart particles at intervals
    if (now - this.lastHeartSpawnMs >= this.HEART_SPAWN_INTERVAL_MS) {
      this.lastHeartSpawnMs = now;
      this.spawnHeart(this.mouseCanvasX, this.mouseCanvasY - 18);
    }

    // Purr reaction after sustained petting
    if (elapsed >= this.PURR_THRESHOLD_MS && !this.pettingAnnoyed) {
      // Subtle mood boost (cap once per petting session)
      if (elapsed < this.PURR_THRESHOLD_MS + 1200) {
        this.behavior.applyExternalMoodAdjustment(this.pet, 1.2);
      }
      // Gentle screen shake
      this.triggerPurrShake();
    }

    // Cat gets annoyed at excessive petting
    if (elapsed >= this.ANNOY_THRESHOLD_MS && !this.pettingAnnoyed) {
      this.pettingAnnoyed = true;
      this.behavior.applyExternalMoodAdjustment(this.pet, -3);
      // Trigger a nudge-like reaction
      this.behavior.nudgeInteraction(this.pet);
      this.recordInteractionEvent("nudge");
    }
  }

  private spawnHeart(cx: number, cy: number): void {
    const rect = this.canvas.getBoundingClientRect();
    const ratio = window.devicePixelRatio || 1;
    const logicalWidth = this.canvas.width / ratio;
    const logicalHeight = this.canvas.height / ratio;
    const screenX = rect.left + (cx / logicalWidth) * rect.width;
    const screenY = rect.top + (cy / logicalHeight) * rect.height;

    const heart = document.createElement("span");
    heart.className = "petting-heart";
    heart.textContent = ["❤️", "💕", "💖", "✨"][Math.floor(Math.random() * 4)];
    heart.style.cssText = `
      position:fixed;pointer-events:none;z-index:9998;font-size:16px;
      left:${screenX - 8}px;top:${screenY}px;
      animation:pet-heart-float .9s ease-out forwards;
    `;
    document.body.appendChild(heart);
    heart.addEventListener("animationend", () => heart.remove());
  }

  private triggerPurrShake(): void {
    // Subtle canvas shake via CSS — self-clearing
    this.canvas.style.animation = "none";
    void this.canvas.offsetHeight; // force reflow
    this.canvas.style.animation = "pet-purr-shake .45s ease-out";
  }

  // ── Teaser wand (floating window) ──────────────────────────────────

  private async activateTeaser(): Promise<void> {
    if (!TAURI_AVAILABLE || this.teaserActivationInFlight) return;

    this.teaserActivationInFlight = true;
    this.teaserActive = false;

    this.teaserCatchCount = 0;
    this.teaserCooldownUntilMs = 0;
    this.lastTeaserUpdateMs = 0;

    try {
      const cursor = await cursorPosition();
      this.teaserScreenX = cursor.x;
      this.teaserScreenY = cursor.y;

      if (!this.teaserWindow) {
        this.teaserWindow = await WebviewWindow.getByLabel("teaser-dot");
      }
      await this.ensureTeaserWindow();

      const teaserWindow = this.teaserWindow;
      if (!teaserWindow) {
        throw new Error("teaser window is unavailable");
      }

      const dotSize = 22;
      await teaserWindow.setPosition(
        new PhysicalPosition(
          Math.round(this.teaserScreenX - dotSize / 2),
          Math.round(this.teaserScreenY - dotSize / 2)
        )
      );
      await teaserWindow.show();
      this.teaserStartedAtMs = performance.now();
      this.teaserActive = true;
    } catch (err) {
      console.warn("activateTeaser failed:", err);
      this.teaserActive = false;
      await this.discardTeaserWindow();
    } finally {
      this.teaserActivationInFlight = false;
    }
  }

  private async updateTeaser(now: number): Promise<void> {
    if (!this.teaserActive || !this.teaserWindow) return;
    if (this.teaserUpdateInFlight) return;
    if (now - this.lastTeaserUpdateMs < this.TEASER_UPDATE_MS) return;

    const elapsedMs = this.lastTeaserUpdateMs > 0
      ? Math.min(now - this.lastTeaserUpdateMs, 100)
      : this.TEASER_UPDATE_MS;
    this.lastTeaserUpdateMs = now;
    this.teaserUpdateInFlight = true;

    const teaserWindow = this.teaserWindow;
    try {
      // Auto-dismiss after timeout
      if (now - this.teaserStartedAtMs > this.TEASER_TIMEOUT_MS) {
        await this.deactivateTeaser();
        return;
      }

      // Fetch independent window values together to keep chase updates close to display refresh rate.
      const petWindow = getCurrentWindow();
      const [cursor, petPos, petSize] = await Promise.all([
        cursorPosition(),
        petWindow.outerPosition(),
        petWindow.outerSize()
      ]);
      if (!this.teaserActive || this.teaserWindow !== teaserWindow) return;

      // Time-based interpolation keeps movement speed stable when IPC latency varies.
      const elapsedSeconds = elapsedMs / 1000;
      const lerp = 1 - Math.exp(-5 * elapsedSeconds);
      this.teaserScreenX += (cursor.x - this.teaserScreenX) * lerp;
      this.teaserScreenY += (cursor.y - this.teaserScreenY) * lerp;

      const dotSize = 22;
      await teaserWindow.setPosition(
        new PhysicalPosition(
          Math.round(this.teaserScreenX - dotSize / 2),
          Math.round(this.teaserScreenY - dotSize / 2)
        )
      );
      if (!this.teaserActive || this.teaserWindow !== teaserWindow) return;

      // Tauri returns physical screen coordinates. Derive the cat center and hit
      // radius from the actual physical window size so high-DPI displays work too.
      const catOffsetX = petSize.width * (this.pet.position.x / INITIAL_SIZE);
      const catOffsetY = petSize.height * (this.pet.position.y / INITIAL_SIZE);
      const catScreenX = petPos.x + catOffsetX;
      const catScreenY = petPos.y + catOffsetY;
      const dx = catScreenX - this.teaserScreenX;
      const dy = catScreenY - this.teaserScreenY;
      const dist = Math.sqrt(dx * dx + dy * dy);
      const physicalScale = Math.min(petSize.width, petSize.height) / INITIAL_SIZE;

      // Catch detection (skip during cooldown)
      if (now >= this.teaserCooldownUntilMs && dist < this.TEASER_CATCH_RADIUS * physicalScale) {
        this.teaserCatchCount++;
        this.behavior.applyExternalMoodAdjustment(this.pet, 2.5);
        this.behavior.setState(this.pet, "stretch");

        const isLastCatch = this.teaserCatchCount >= this.TEASER_MAX_CATCHES;

        if (isLastCatch) {
          // Final catch: deactivate immediately; cleanup hides before closing.
          await this.deactivateTeaser();
          return;
        }

        // Not the last catch: hide briefly, teleport, show again
        this.teaserCooldownUntilMs = now + 1200;
        await teaserWindow.hide();
        await new Promise((r) => setTimeout(r, 150));
        this.teaserScreenX = catScreenX + (Math.random() - 0.5) * 300;
        this.teaserScreenY = catScreenY - 40 - Math.random() * 120;
        await teaserWindow.setPosition(
          new PhysicalPosition(
            Math.round(this.teaserScreenX - 22 / 2),
            Math.round(this.teaserScreenY - 22 / 2)
          )
        );
        await teaserWindow.show();
        return;
      }

      // Chase: walk toward the teaser dot (skip during cooldown)
      if (now >= this.teaserCooldownUntilMs) {
        // Set walk state so the renderer plays walk_left/walk_right animation.
        // dx < 0 means dot is to the right → face right.
        this.pet.facing = dx < 0 ? "right" : "left";
        this.behavior.setState(this.pet, "walk");

        const targetWindowX = this.teaserScreenX - catOffsetX;
        const targetWindowY = this.teaserScreenY - catOffsetY;
        const chaseLerp = 1 - Math.exp(-1.03 * elapsedSeconds);
        const newX = petPos.x + (targetWindowX - petPos.x) * chaseLerp;
        const newY = petPos.y + (targetWindowY - petPos.y) * chaseLerp;

        this.pendingDesktopWindowPosition = { x: Math.round(newX), y: Math.round(newY) };
        if (!this.desktopWindowMoveInFlight) {
          this.desktopWindowMoveInFlight = true;
          void this.flushDesktopWindowMove();
        }
      }
    } catch {
      // Cursor/position calls may fail transiently
    } finally {
      this.teaserUpdateInFlight = false;
    }
  }

  private async ensureTeaserWindow(): Promise<void> {
    if (this.teaserWindow) return;
    const dotSize = 22;
    const win = new WebviewWindow("teaser-dot", {
      url: "/?view=teaser-dot",
      title: "",
      width: dotSize,
      height: dotSize,
      x: Math.round(this.teaserScreenX - dotSize / 2),
      y: Math.round(this.teaserScreenY - dotSize / 2),
      visible: false,
      decorations: false,
      transparent: true,
      alwaysOnTop: true,
      skipTaskbar: true,
      resizable: false,
      maximizable: false,
      minimizable: false,
      focus: false,
      shadow: false
    });

    // Wait for the window to actually be created (same pattern as chat bubble)
    await Promise.race([
      new Promise<void>((resolve, reject) => {
        void win.once("tauri://created", () => resolve());
        void win.once("tauri://error", (e) => reject(new Error(String(e.payload))));
      }),
      new Promise<void>((_, reject) =>
        setTimeout(() => reject(new Error("teaser window creation timed out")), 3000)
      )
    ]);

    this.teaserWindow = win;
  }

  private async deactivateTeaser(): Promise<void> {
    this.teaserActive = false;
    let teaserWindow = this.teaserWindow;
    if (!teaserWindow) {
      try {
        teaserWindow = await WebviewWindow.getByLabel("teaser-dot");
      } catch {
        teaserWindow = null;
      }
    }

    if (!teaserWindow) return;

    try {
      await teaserWindow.hide();
      this.teaserWindow = teaserWindow;
    } catch {
      // If the retained handle is stale, remove it so the next activation can recreate it.
      try { await teaserWindow.close(); } catch { /* ignore */ }
      if (this.teaserWindow === teaserWindow) {
        this.teaserWindow = null;
      }
    }
  }

  private async discardTeaserWindow(): Promise<void> {
    const retainedWindow = this.teaserWindow;
    this.teaserWindow = null;

    if (retainedWindow) {
      try { await retainedWindow.hide(); } catch { /* ignore */ }
      try { await retainedWindow.close(); } catch { /* ignore */ }
    }

    try {
      const orphan = await WebviewWindow.getByLabel("teaser-dot");
      if (orphan) {
        try { await orphan.hide(); } catch { /* ignore */ }
        try { await orphan.close(); } catch { /* ignore */ }
      }
    } catch {
      // Window may already be gone.
    }
  }

  private async updateClickThrough(now: number): Promise<void> {
    if (!TAURI_AVAILABLE) {
      return;
    }
    if (now - this.lastClickThroughCheck < this.CLICK_THROUGH_POLL_MS) {
      return;
    }
    this.lastClickThroughCheck = now;

    try {
      const cursor = await cursorPosition();
      const petWindow = getCurrentWindow();
      const windowPos = await petWindow.outerPosition();
      const scale = this.settings.scale;

      // Cursor position relative to the window
      const relX = cursor.x - windowPos.x;
      const relY = cursor.y - windowPos.y;

      // Cat center in window coordinates (scaled)
      const catCx = this.pet.position.x * scale;
      const catCy = this.pet.position.y * scale;
      const radius = this.CLICK_THROUGH_HIT_RADIUS * scale;

      const dx = relX - catCx;
      const dy = relY - catCy;
      const nearCat = dx * dx + dy * dy < radius * radius;

      // Keep click-through OFF when dragging or cursor is near the cat
      const shouldIgnore = !nearCat && this.pet.state !== "drag";

      if (shouldIgnore !== this.clickThroughEnabled) {
        this.clickThroughEnabled = shouldIgnore;
        await invoke("set_click_through", { ignore: shouldIgnore });
      }
    } catch {
      // Silently ignore — polling may fail transiently
    }
  }

  private async waitForFirstFrame(): Promise<void> {
    return new Promise((resolve) => {
      // Two rAF cycles ensure at least one full paint cycle completes
      requestAnimationFrame(() => {
        requestAnimationFrame(() => resolve());
      });
    });
  }

  private async ensureWindowOnScreen(): Promise<void> {
    try {
      const window = getCurrentWindow();
      const [position, monitors] = await Promise.all([
        window.outerPosition(),
        availableMonitors()
      ]);
      if (monitors.length === 0) {
        return;
      }

      // Check if the window center is within ANY monitor's work area
      const cx = position.x + INITIAL_SIZE / 2;
      const cy = position.y + INITIAL_SIZE / 2;
      const margin = 40;
      const onScreen = monitors.some((m) => {
        const area = m.workArea ?? m;
        return (
          cx >= area.position.x + margin &&
          cx <= area.position.x + area.size.width - margin &&
          cy >= area.position.y + margin &&
          cy <= area.position.y + area.size.height - margin
        );
      });

      if (!onScreen) {
        // Window is off-screen (e.g., monitor was disconnected) — center it
        await window.center();
      }
    } catch {
      // Non-critical — window may just appear in a default position
    }
  }

  private async showDesktopWindow(): Promise<void> {
    if (!TAURI_AVAILABLE) {
      return;
    }

    await this.safeTauri(async () => {
      const window = getCurrentWindow();
      await window.show();
      if (this.settings.alwaysOnTop) {
        await window.setAlwaysOnTop(true);
      }
    });
  }

  private async ensurePetWindowAlwaysOnTop(): Promise<void> {
    await this.safeTauri(async () => {
      const window = getCurrentWindow();
      await window.setAlwaysOnTop(false);
      await window.setAlwaysOnTop(true);
    }, "Failed to refresh pet window always-on-top state");
  }

  // ── Achievement toast (floating window) ───────────────────────────

  private async showAchievementToast(def: AchievementDef): Promise<void> {
    if (!TAURI_AVAILABLE) return;

    try {
      const petWindow = getCurrentWindow();
      const [petPos, petSize] = await Promise.all([
        petWindow.outerPosition(),
        petWindow.outerSize()
      ]);

      // Position above the pet window
      const toastWidth = 210;
      const toastHeight = 44;
      const x = Math.round(petPos.x + petSize.width / 2 - toastWidth / 2);
      const y = Math.round(petPos.y - toastHeight - 10);

      // Close any existing toast
      if (this.achievementWindow) {
        void this.achievementWindow.close();
        this.achievementWindow = null;
      }

      const html = this.buildAchievementToastHtml(def);
      const dataUrl = `data:text/html,${encodeURIComponent(html)}`;

      const toast = new WebviewWindow(`achievement-toast-${Date.now()}`, {
        url: dataUrl,
        title: "成就",
        width: toastWidth,
        height: toastHeight,
        x,
        y,
        visible: true,
        decorations: false,
        transparent: true,
        alwaysOnTop: true,
        skipTaskbar: true,
        resizable: false,
        maximizable: false,
        minimizable: false,
        focus: false,
        shadow: false
      });

      this.achievementWindow = toast;

      // Auto-dismiss after 3.2 seconds
      window.clearTimeout(this.achievementToastTimer);
      this.achievementToastTimer = window.setTimeout(() => {
        void toast.close();
        if (this.achievementWindow === toast) {
          this.achievementWindow = null;
        }
      }, 3200);
    } catch (error) {
      console.warn("Failed to show achievement toast", error);
    }
  }

  private buildAchievementToastHtml(def: AchievementDef): string {
    return `<!DOCTYPE html><html><head><meta charset="utf-8"><style>
      *{margin:0;padding:0;box-sizing:border-box}
      html,body{width:100%;height:100%;background:transparent;overflow:hidden;
        font-family:system-ui,sans-serif;display:grid;place-items:center}
      .toast{display:flex;align-items:center;gap:10px;padding:10px 18px;
        background:rgba(42,31,26,.92);color:#fff3da;border-radius:16px;
        font-size:13px;white-space:nowrap;box-shadow:0 6px 24px rgba(0,0,0,.3);
        animation:pop-in .35s cubic-bezier(.16,1,.3,1)}
      .icon{font-size:20px}
      @keyframes pop-in{0%{opacity:0;transform:scale(.85) translateY(6px)}
        100%{opacity:1;transform:scale(1) translateY(0)}}
    </style></head><body>
      <div class="toast">
        <span class="icon">${def.icon}</span>
        <span><b>${def.name}</b>&nbsp;—&nbsp;${def.description}</span>
      </div>
    </body></html>`;
  }
}
