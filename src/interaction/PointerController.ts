import { BehaviorEngine } from "../core/BehaviorEngine";
import type { PetModel, Vec2 } from "../types/pet";

export class PointerController {
  private isPointerDown = false;
  private isDragging = false;
  private dragOffset: Vec2 = { x: 0, y: 0 };
  private pointerDownAt = 0;

  constructor(
    private readonly canvas: HTMLCanvasElement,
    private readonly pet: PetModel,
    private readonly behavior: BehaviorEngine
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

    this.isPointerDown = true;
    this.pointerDownAt = performance.now();
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

    const point = this.getCanvasPoint(event);
    const heldMs = performance.now() - this.pointerDownAt;

    if (!this.isDragging && heldMs > 120) {
      this.isDragging = true;
      this.behavior.beginDrag(this.pet);
    }

    if (this.isDragging) {
      this.pet.position.x = point.x - this.dragOffset.x;
      this.pet.position.y = point.y - this.dragOffset.y;
    }
  };

  private onPointerUp = (event: PointerEvent): void => {
    if (!this.isPointerDown) {
      return;
    }

    this.isPointerDown = false;

    if (this.isDragging) {
      this.isDragging = false;
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

  private hitTest(point: Vec2): boolean {
    const dx = point.x - this.pet.position.x;
    const dy = point.y - (this.pet.position.y - 46);
    return dx * dx + dy * dy < 62 * 62;
  }
}
