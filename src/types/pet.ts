export type PetState =
  | "idle"
  | "walk"
  | "sit"
  | "sleep"
  | "stretch"
  | "groom"
  | "drag"
  | "fall";

export type Facing = "left" | "right";

export interface Vec2 {
  x: number;
  y: number;
}

export interface PetModel {
  state: PetState;
  facing: Facing;
  position: Vec2;
  velocity: Vec2;
  target: Vec2;
  stateElapsedMs: number;
  nextDecisionMs: number;
}
