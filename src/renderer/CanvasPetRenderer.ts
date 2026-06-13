import type { PetModel } from "../types/pet";
import type { PetPackageAnchor, AnimationKey } from "../types/pet-package";

interface CanvasPetRendererOptions {
  useStaticImageCssFallback?: boolean;
}

interface FrameAnimationDefinition {
  fps: number;
  loop: boolean;
  frameUrls: string[];
  frameWidth: number;
  frameHeight: number;
  anchor: PetPackageAnchor;
  loopStartFrame?: number;
  loopEndFrame?: number;
}

interface LoadedFrameAnimation extends FrameAnimationDefinition {
  frames: HTMLImageElement[];
  lastReadyFrame: HTMLImageElement | null;
  ready: Promise<void[]>;
}

const BODY = "#f59f46";
const BODY_SHADOW = "#d96f35";
const CREAM = "#fff3da";
const DARK = "#3f2b22";
const PINK = "#f59aa6";
const STRIPE = "#a84d2b";
const WALK_LEFT_ANIMATION: AnimationKey = "walk_left";

export class CanvasPetRenderer {
  private ctx: CanvasRenderingContext2D;
  private staticImage: HTMLImageElement | null = null;
  private staticImageLoaded = false;
  private staticImageSrc: string | null = null;
  private readonly frameAnimations = new Map<AnimationKey, LoadedFrameAnimation>();
  private lookFrameIndex = 0;
  private isLookMode = false;
  private width = 0;
  private height = 0;

  constructor(
    private readonly canvas: HTMLCanvasElement,
    private readonly options: CanvasPetRendererOptions = {}
  ) {
    const ctx = canvas.getContext("2d", { alpha: true });
    if (!ctx) {
      throw new Error("Canvas 2D context is unavailable");
    }

    this.ctx = ctx;
  }

  setStaticImage(src: string | null): void {
    this.staticImage = null;
    this.staticImageLoaded = false;
    this.staticImageSrc = src;
    this.canvas.style.backgroundImage =
      src && this.options.useStaticImageCssFallback ? `url("${src}")` : "";
    this.canvas.style.backgroundRepeat =
      src && this.options.useStaticImageCssFallback ? "no-repeat" : "";

    if (!src) {
      return;
    }

    const image = new Image();
    image.onerror = () => {
      if (this.staticImageSrc !== src) {
        return;
      }

      console.warn("Failed to load static pet image", src);
      this.staticImage = null;
      this.staticImageLoaded = false;
    };
    image.src = src;
    this.staticImage = image;

    void image.decode().then(() => {
      if (this.staticImageSrc !== src) {
        return;
      }

      this.staticImageLoaded = true;
    }).catch((error) => {
      if (this.staticImageSrc !== src) {
        return;
      }

      console.warn("Failed to decode static pet image", src, error);
      this.staticImage = null;
      this.staticImageLoaded = false;
    });
  }

  setFrameAnimation(state: AnimationKey, definition: FrameAnimationDefinition): void {
    const decodePromises: Promise<void>[] = [];
    const animation: LoadedFrameAnimation = {
      ...definition,
      frames: definition.frameUrls.map((src) => {
        const image = new Image();
        image.decoding = "async";
        image.src = src;
        const decodePromise = image.decode().catch((error) => {
          console.warn("Failed to decode pet animation frame", src, error);
        });
        decodePromises.push(decodePromise);
        return image;
      }),
      lastReadyFrame: null,
      ready: Promise.all(decodePromises)
    };

    this.frameAnimations.set(state, animation);
  }

  async preloadFrameAnimations(): Promise<void> {
    await Promise.all([...this.frameAnimations.values()].map((animation) => animation.ready));
  }

  hasFrameAnimation(state: AnimationKey): boolean {
    const animation = this.getFrameAnimationForKey(state).animation;
    return Boolean(animation?.frames.length);
  }

  getFrameAnimationDurationMs(state: AnimationKey): number | null {
    const animation = this.getFrameAnimationForKey(state).animation;
    if (!animation || animation.frames.length === 0 || animation.fps <= 0) {
      return null;
    }

    return (animation.frames.length / animation.fps) * 1000;
  }

  resize(width: number, height: number, displayWidth = width, displayHeight = height): void {
    const ratio = window.devicePixelRatio || 1;
    this.width = width;
    this.height = height;
    this.canvas.width = Math.round(width * ratio);
    this.canvas.height = Math.round(height * ratio);
    this.canvas.style.width = `${displayWidth}px`;
    this.canvas.style.height = `${displayHeight}px`;
    this.ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
  }

  render(pet: PetModel, now: number): void {
    this.ctx.clearRect(0, 0, this.width, this.height);
    this.drawSoftShadow(pet);

    this.ctx.save();
    this.ctx.translate(pet.position.x, pet.position.y);

    // "Look" state: draw a specific look frame instead of normal rendering
    if (this.isLookMode && this.drawLookFrame()) {
      this.ctx.restore();
      return;
    }

    if (this.drawFrameAnimation(pet)) {
      this.clearStaticImageFallback();
      // Frame animation handled the current state.
    } else if (this.staticImage && this.staticImageLoaded) {
      this.updateStaticImageFallback(pet, now);
      if (this.staticImageSrc && this.options.useStaticImageCssFallback) {
        this.ctx.restore();
        return;
      }
      this.ctx.scale(pet.facing === "left" ? -1 : 1, 1);
      this.drawStaticCat(pet, now);
    } else {
      this.clearStaticImageFallback();
      this.ctx.scale(pet.facing === "left" ? -1 : 1, 1);
      this.drawCat(pet, now);
    }
    this.ctx.restore();
  }

  /** Set which look frame to draw, and enable look mode. Pass -1 to disable. */
  setLookFrame(index: number): void {
    if (index < 0) {
      this.isLookMode = false;
      return;
    }
    this.lookFrameIndex = index;
    this.isLookMode = true;
  }

  /** Check if the look animation is loaded. */
  hasLookAnimation(): boolean {
    const anim = this.frameAnimations.get("look");
    return Boolean(anim && anim.frames.length > 0);
  }

  getLookFrameCount(): number {
    return this.frameAnimations.get("look")?.frames.length ?? 0;
  }

  /** Draw the single look frame at the current lookFrameIndex. */
  private drawLookFrame(): boolean {
    const anim = this.frameAnimations.get("look");
    if (!anim || anim.frames.length === 0) {
      return false;
    }

    const idx = Math.max(0, Math.min(this.lookFrameIndex, anim.frames.length - 1));
    const frame = anim.frames[idx];
    if (!frame || !frame.complete || frame.naturalWidth === 0) {
      return false;
    }

    this.drawAnimationFrame(anim, frame, false);
    return true;
  }

  private drawSoftShadow(pet: PetModel): void {
    const ctx = this.ctx;
    ctx.save();
    ctx.globalAlpha = pet.state === "fall" ? 0.18 : 0.28;
    ctx.fillStyle = "#000";
    ctx.beginPath();
    ctx.ellipse(pet.position.x, 171, 48, 10, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  private drawCat(pet: PetModel, now: number): void {
    const bob = this.getBob(pet, now);
    const sleepSquash = pet.state === "sleep" ? 0.82 : 1;
    const sitSquash = pet.state === "sit" ? 0.92 : 1;

    this.ctx.save();
    this.ctx.translate(0, bob);
    this.ctx.scale(1, sleepSquash * sitSquash);

    if (pet.state === "sleep") {
      this.drawSleepingCat(now);
    } else {
      this.drawTail(pet, now);
      this.drawBody(pet);
      this.drawHead(pet, now);
      this.drawLegs(pet, now);
      if (pet.state === "eat") {
        this.drawFood(now);
      }
    }

    this.ctx.restore();

    if (pet.state === "sleep") {
      this.drawZzz(now);
    }
  }

  private drawStaticCat(pet: PetModel, now: number): void {
    const ctx = this.ctx;
    const placement = this.getStaticImagePlacement(pet, now);

    ctx.save();
    ctx.translate(0, placement.bob + placement.yOffset);
    if (pet.state === "sleep") {
      ctx.rotate(-0.08);
    }

    ctx.drawImage(
      this.staticImage!,
      -placement.anchorX,
      -placement.anchorY,
      placement.imageSize,
      placement.imageSize
    );

    if (pet.state === "eat") {
      this.drawFood(now);
    }
    ctx.restore();

    if (pet.state === "sleep") {
      this.drawZzz(now);
    }
  }

  private updateStaticImageFallback(pet: PetModel, now: number): void {
    if (!this.staticImageSrc || !this.options.useStaticImageCssFallback) {
      return;
    }

    const placement = this.getStaticImagePlacement(pet, now);
    const left = pet.position.x - placement.anchorX;
    const top = pet.position.y + placement.bob + placement.yOffset - placement.anchorY;
    this.canvas.style.backgroundSize = `${placement.imageSize}px ${placement.imageSize}px`;
    this.canvas.style.backgroundPosition = `${left}px ${top}px`;
  }

  private clearStaticImageFallback(): void {
    if (!this.options.useStaticImageCssFallback || !this.canvas.style.backgroundImage) {
      return;
    }

    this.canvas.style.backgroundImage = "";
  }

  private getStaticImagePlacement(pet: PetModel, now: number): {
    anchorX: number;
    anchorY: number;
    bob: number;
    imageSize: number;
    yOffset: number;
  } {
    const bob = this.getBob(pet, now);
    const imageSize = pet.state === "sleep" ? 158 : 190;
    return {
      anchorX: imageSize * 0.5,
      anchorY: imageSize * (pet.state === "sleep" ? 0.86 : 0.85),
      bob,
      imageSize,
      yOffset: pet.state === "sleep" ? 14 : 0
    };
  }

  private drawFrameAnimation(pet: PetModel): boolean {
    const animationKey = this.getAnimationKey(pet);
    const { animation, mirrored } = this.getFrameAnimationForKey(animationKey);
    if (!animation || animation.frames.length === 0) {
      return false;
    }

    const frame = this.getAnimationFrame(animation, pet.stateElapsedMs);
    if (!frame.complete || frame.naturalWidth === 0) {
      if (animation.lastReadyFrame) {
        this.drawAnimationFrame(animation, animation.lastReadyFrame, mirrored);
        return true;
      }

      return false;
    }

    animation.lastReadyFrame = frame;
    this.drawAnimationFrame(animation, frame, mirrored);
    return true;
  }

  private drawAnimationFrame(
    animation: LoadedFrameAnimation,
    frame: HTMLImageElement,
    mirrored: boolean
  ): void {
    const ctx = this.ctx;
    const scale = Math.min(this.width / animation.frameWidth, this.height / animation.frameHeight);
    const width = animation.frameWidth * scale;
    const height = animation.frameHeight * scale;

    ctx.save();
    if (mirrored) {
      ctx.scale(-1, 1);
    }
    ctx.drawImage(frame, -width / 2, -height / 2, width, height);
    ctx.restore();
  }

  private getAnimationFrame(
    animation: LoadedFrameAnimation,
    stateElapsedMs: number
  ): HTMLImageElement {
    const frameCount = animation.frames.length;
    const startFrame = this.clampFrameIndex(animation.loopStartFrame ?? 0, frameCount);
    const endFrame = this.clampFrameIndex(animation.loopEndFrame ?? frameCount - 1, frameCount);
    const rangeStart = Math.min(startFrame, endFrame);
    const rangeEnd = Math.max(startFrame, endFrame);
    const rangeFrameCount = rangeEnd - rangeStart + 1;
    const frameIndex = Math.floor((stateElapsedMs / 1000) * animation.fps);
    let boundedIndex: number;

    if (animation.loop) {
      if (rangeStart > 0 && frameIndex < rangeStart) {
        boundedIndex = frameIndex;
      } else {
        const loopIndex = rangeStart > 0 ? frameIndex - rangeStart : frameIndex;
        boundedIndex = rangeStart + (loopIndex % rangeFrameCount);
      }
    } else {
      boundedIndex = Math.min(rangeStart + frameIndex, rangeEnd);
    }

    return animation.frames[boundedIndex];
  }

  private clampFrameIndex(index: number, frameCount: number): number {
    return Math.min(frameCount - 1, Math.max(0, Math.floor(index)));
  }

  private getAnimationKey(pet: PetModel): AnimationKey {
    if (pet.state === "walk") {
      return pet.facing === "left" ? "walk_left" : "walk_right";
    }

    return pet.state;
  }

  private getFrameAnimationForKey(animationKey: AnimationKey): {
    animation: LoadedFrameAnimation | undefined;
    mirrored: boolean;
  } {
    const animation = this.frameAnimations.get(animationKey);
    if (animation) {
      return { animation, mirrored: false };
    }

    if (animationKey === "walk_right") {
      return {
        animation: this.frameAnimations.get(WALK_LEFT_ANIMATION),
        mirrored: true
      };
    }

    return { animation: undefined, mirrored: false };
  }

  private drawBody(pet: PetModel): void {
    const ctx = this.ctx;
    const bodyY = pet.state === "sit" ? -42 : -38;

    ctx.fillStyle = BODY_SHADOW;
    ctx.beginPath();
    ctx.ellipse(5, bodyY + 6, 48, 38, -0.12, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = BODY;
    ctx.beginPath();
    ctx.ellipse(0, bodyY, 48, 38, -0.12, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = CREAM;
    ctx.beginPath();
    ctx.ellipse(11, bodyY + 10, 22, 26, -0.2, 0, Math.PI * 2);
    ctx.fill();

    ctx.strokeStyle = STRIPE;
    ctx.lineWidth = 5;
    ctx.lineCap = "round";
    ctx.beginPath();
    ctx.moveTo(-21, bodyY - 22);
    ctx.quadraticCurveTo(-9, bodyY - 15, -3, bodyY - 28);
    ctx.moveTo(-35, bodyY - 4);
    ctx.quadraticCurveTo(-19, bodyY + 1, -11, bodyY - 12);
    ctx.stroke();
  }

  private drawHead(pet: PetModel, now: number): void {
    const ctx = this.ctx;
    const headY = pet.state === "stretch" ? -94 : -86;
    const blink = Math.sin(now / 850) > 0.96;

    ctx.fillStyle = BODY;
    ctx.beginPath();
    ctx.moveTo(-28, headY - 19);
    ctx.lineTo(-40, headY - 48);
    ctx.lineTo(-13, headY - 31);
    ctx.lineTo(18, headY - 31);
    ctx.lineTo(43, headY - 49);
    ctx.lineTo(33, headY - 17);
    ctx.closePath();
    ctx.fill();

    ctx.beginPath();
    ctx.ellipse(0, headY, 42, 35, 0, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = CREAM;
    ctx.beginPath();
    ctx.ellipse(8, headY + 12, 21, 16, 0, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = DARK;
    if (blink || pet.state === "groom") {
      ctx.lineWidth = 3;
      ctx.lineCap = "round";
      ctx.beginPath();
      ctx.moveTo(-14, headY - 4);
      ctx.lineTo(-4, headY - 4);
      ctx.moveTo(17, headY - 4);
      ctx.lineTo(27, headY - 4);
      ctx.stroke();
    } else {
      ctx.beginPath();
      ctx.arc(-9, headY - 6, 4, 0, Math.PI * 2);
      ctx.arc(21, headY - 6, 4, 0, Math.PI * 2);
      ctx.fill();
    }

    ctx.fillStyle = PINK;
    ctx.beginPath();
    ctx.moveTo(6, headY + 4);
    ctx.lineTo(13, headY + 4);
    ctx.lineTo(9.5, headY + 9);
    ctx.closePath();
    ctx.fill();

    ctx.strokeStyle = DARK;
    ctx.lineWidth = 2;
    ctx.lineCap = "round";
    ctx.beginPath();
    ctx.moveTo(10, headY + 10);
    ctx.quadraticCurveTo(4, headY + 15, -2, headY + 12);
    ctx.moveTo(10, headY + 10);
    ctx.quadraticCurveTo(17, headY + 16, 25, headY + 12);
    ctx.stroke();

    this.drawWhiskers(headY);
  }

  private drawTail(pet: PetModel, now: number): void {
    const ctx = this.ctx;
    const wag = Math.sin(now / 230) * (pet.state === "walk" ? 10 : 5);

    ctx.strokeStyle = BODY;
    ctx.lineWidth = 17;
    ctx.lineCap = "round";
    ctx.beginPath();
    ctx.moveTo(-39, -45);
    ctx.bezierCurveTo(-78, -78 + wag, -63, -119 + wag, -27, -102 + wag);
    ctx.stroke();

    ctx.strokeStyle = STRIPE;
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.moveTo(-54, -73 + wag);
    ctx.lineTo(-43, -82 + wag);
    ctx.moveTo(-36, -100 + wag);
    ctx.lineTo(-24, -96 + wag);
    ctx.stroke();
  }

  private drawLegs(pet: PetModel, now: number): void {
    const ctx = this.ctx;
    const step = pet.state === "walk" ? Math.sin(now / 95) * 6 : 0;
    const y = pet.state === "sit" ? -11 : -10;

    ctx.fillStyle = BODY_SHADOW;
    this.roundPaw(-20 + step, y, 16, 22);
    this.roundPaw(19 - step, y, 16, 22);

    ctx.fillStyle = CREAM;
    this.roundPaw(-17 + step, y + 4, 13, 15);
    this.roundPaw(22 - step, y + 4, 13, 15);
  }

  private drawSleepingCat(now: number): void {
    const ctx = this.ctx;
    const breathe = Math.sin(now / 550) * 1.8;

    ctx.fillStyle = BODY;
    ctx.beginPath();
    ctx.ellipse(-2, -35 + breathe, 56, 34, -0.08, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = CREAM;
    ctx.beginPath();
    ctx.ellipse(19, -26 + breathe, 27, 17, -0.12, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = BODY;
    ctx.beginPath();
    ctx.ellipse(39, -58 + breathe, 31, 27, 0.16, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = BODY;
    ctx.beginPath();
    ctx.moveTo(21, -72 + breathe);
    ctx.lineTo(30, -99 + breathe);
    ctx.lineTo(43, -72 + breathe);
    ctx.closePath();
    ctx.moveTo(50, -73 + breathe);
    ctx.lineTo(69, -96 + breathe);
    ctx.lineTo(66, -66 + breathe);
    ctx.closePath();
    ctx.fill();

    ctx.strokeStyle = DARK;
    ctx.lineWidth = 3;
    ctx.lineCap = "round";
    ctx.beginPath();
    ctx.moveTo(33, -58 + breathe);
    ctx.lineTo(43, -58 + breathe);
    ctx.moveTo(55, -57 + breathe);
    ctx.lineTo(65, -57 + breathe);
    ctx.stroke();

    ctx.strokeStyle = BODY;
    ctx.lineWidth = 16;
    ctx.beginPath();
    ctx.arc(-35, -48 + breathe, 27, -0.2, Math.PI * 1.35);
    ctx.stroke();
  }

  private drawWhiskers(headY: number): void {
    const ctx = this.ctx;
    ctx.strokeStyle = DARK;
    ctx.lineWidth = 1.6;
    ctx.lineCap = "round";
    ctx.beginPath();
    ctx.moveTo(-2, headY + 8);
    ctx.lineTo(-28, headY + 2);
    ctx.moveTo(-2, headY + 13);
    ctx.lineTo(-31, headY + 15);
    ctx.moveTo(21, headY + 8);
    ctx.lineTo(47, headY + 2);
    ctx.moveTo(21, headY + 13);
    ctx.lineTo(51, headY + 15);
    ctx.stroke();
  }

  private drawZzz(now: number): void {
    const ctx = this.ctx;
    const float = Math.sin(now / 450) * 3;
    ctx.fillStyle = "rgba(63, 43, 34, 0.55)";
    ctx.font = "700 16px system-ui, sans-serif";
    ctx.fillText("Z", 142, 72 + float);
    ctx.font = "700 12px system-ui, sans-serif";
    ctx.fillText("Z", 160, 54 - float);
  }

  private drawFood(now: number): void {
    const ctx = this.ctx;
    const chew = Math.sin(now / 120) * 1.5;

    ctx.save();
    ctx.translate(33, -5 + chew);
    ctx.fillStyle = "#78a85a";
    ctx.beginPath();
    ctx.roundRect(-17, 1, 34, 13, 6);
    ctx.fill();

    ctx.fillStyle = "#f4d77a";
    for (let i = 0; i < 4; i += 1) {
      ctx.beginPath();
      ctx.arc(-10 + i * 7, 2 + Math.sin(now / 160 + i) * 1.2, 2.4, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }

  private roundPaw(x: number, y: number, width: number, height: number): void {
    const ctx = this.ctx;
    ctx.beginPath();
    ctx.roundRect(x - width / 2, y - height / 2, width, height, 7);
    ctx.fill();
  }

  private getBob(pet: PetModel, now: number): number {
    if (pet.state === "walk") {
      return Math.sin(now / 95) * 2.5;
    }

    if (pet.state === "stretch") {
      return -Math.sin(Math.min(pet.stateElapsedMs / 1200, 1) * Math.PI) * 9;
    }

    if (pet.state === "groom") {
      return Math.sin(now / 120) * 1.5;
    }

    return Math.sin(now / 900) * 1.2;
  }
}
