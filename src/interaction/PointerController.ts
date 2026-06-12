import { BehaviorEngine } from "../core/BehaviorEngine";
import type { PetModel, Vec2 } from "../types/pet";

interface PointerControllerOptions {
  onDesktopDragStart?: (screenPoint: Vec2) => void;
  onDesktopDragMove?: (screenPoint: Vec2) => void;
  onDesktopDragEnd?: () => void;
  windowDragHitRadius?: number;
}

const DRAG_START_DISTANCE_PX = 2;

export class PointerController {
  private isPointerDown = false;
  private isDragging = false;
  private dragOffset: Vec2 = { x: 0, y: 0 };
  private pointerDownPoint: Vec2 = { x: 0, y: 0 };

  constructor(
    private readonly canvas: HTMLCanvasElement,
    private readonly pet: PetModel,
    private readonly behavior: BehaviorEngine,
    private readonly options: PointerControllerOptions = {}
  ) {}

  attach(): void {
    this.canvas.addEventListener("pointerdown", this.onPointerDown);
    window.addEventListener("pointermove", this.onPointerMove);
    window.addEventListener("pointerup", this.onPointerUp);
    this.canvas.addEventListener("dblclick", this.onDoubleClick);
  }

  detach(): void {
    this.canvas.removeEventListener("pointerdown", this.onPointerDown);
    window.removeEventListener("pointermove", this.onPointerMove);
    window.removeEventListener("pointerup", this.onPointerUp);
    this.canvas.removeEventListener("dblclick", this.onDoubleClick);
  }

  private onPointerDown = (event: PointerEvent): void => {
    const point = this.getCanvasPoint(event);
    if (!this.hitTest(point)) {
      return;
    }

    event.preventDefault();

    this.isPointerDown = true;
    this.pointerDownPoint = point;
    this.dragOffset = {
      x: point.x - this.pet.position.x,
      y: point.y - this.pet.position.y
    };
    this.canvas.setPointerCapture(event.pointerId);
  };

  private onPointerMove = (event: PointerEvent): void => {
    if (!this.isPointerDown) {
      return;
    }

    event.preventDefault();

    const point = this.getCanvasPoint(event);
    const movedX = point.x - this.pointerDownPoint.x;
    const movedY = point.y - this.pointerDownPoint.y;
    const movedEnough = movedX * movedX + movedY * movedY >= DRAG_START_DISTANCE_PX * DRAG_START_DISTANCE_PX;

    if (!this.isDragging && movedEnough) {
      this.isDragging = true;
      this.behavior.beginDrag(this.pet);
      this.options.onDesktopDragStart?.(this.getScreenPoint(event));
    }

    if (this.isDragging) {
      if (this.options.onDesktopDragMove) {
        this.options.onDesktopDragMove(this.getScreenPoint(event));
      } else {
        this.behavior.dragTo(this.pet, {
          x: point.x - this.dragOffset.x,
          y: point.y - this.dragOffset.y
        });
      }
    }
  };

  private onPointerUp = (event: PointerEvent): void => {
    if (!this.isPointerDown) {
      return;
    }

    event.preventDefault();

    this.isPointerDown = false;

    if (this.isDragging) {
      this.isDragging = false;
      this.options.onDesktopDragEnd?.();
      this.behavior.releaseDrag(this.pet);
    } else {
      this.behavior.nudgeInteraction(this.pet);
    }

    if (this.canvas.hasPointerCapture(event.pointerId)) {
      this.canvas.releasePointerCapture(event.pointerId);
    }
  };

  private onDoubleClick = (): void => {
    this.behavior.nudgeInteraction(this.pet);
  };

  private getCanvasPoint(event: PointerEvent): Vec2 {
    const rect = this.canvas.getBoundingClientRect();
    const ratio = window.devicePixelRatio || 1;
    const logicalWidth = this.canvas.width / ratio;
    const logicalHeight = this.canvas.height / ratio;
    return {
      x: (event.clientX - rect.left) * (logicalWidth / rect.width),
      y: (event.clientY - rect.top) * (logicalHeight / rect.height)
    };
  }

  private getScreenPoint(event: PointerEvent): Vec2 {
    return {
      x: event.screenX,
      y: event.screenY
    };
  }

  private hitTest(point: Vec2): boolean {
    const ctx = this.canvas.getContext("2d", { willReadFrequently: true });
    if (ctx) {
      const ratio = window.devicePixelRatio || 1;
      const x = Math.floor(point.x * ratio);
      const y = Math.floor(point.y * ratio);
      const alpha = ctx.getImageData(x, y, 1, 1).data[3];
      if (alpha > 24) {
        return true;
      }
    }

    const dx = point.x - this.pet.position.x;
    const dy = point.y - this.pet.position.y;
    const radius = this.options.windowDragHitRadius ?? 72;
    return dx * dx + dy * dy < radius * radius;
  }
}
